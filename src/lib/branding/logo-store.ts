// Logo storage (Phase 9 plan 09-05, AIDA-34, D-07, U-11, review P10).
//
// The logo is an immutable file under the organization's upload directory, referenced by the
// Setting `branding:logo` = JSON { storageKey, mimeType, version } (src/lib/branding/settings.ts).
//
// - replaceLogo validates the bytes (logo-validate.ts), stores them under a NEW key from
//   buildStorageKey with the extension of the sniffed type (saves are exclusive create, D-02(1)),
//   then in one transaction takes the organization's logo lock, reads the current reference, writes
//   the new one with a fresh version and enqueues the previous key in ProjectFileCleanup
//   (enqueueFileCleanupInTx). A refusal stores nothing; a throw after the save discards the staged
//   file (it was never referenced by a committed row, U-13) and rethrows.
// - removeLogo takes the same lock, deletes the reference and enqueues its key in one transaction.
// - Nothing here deletes a referenced file. The fenced queue sweep (src/lib/projects/file-cleanup.ts,
//   plan 09-04) deletes a dequeued key later, never while a backup holds the fence.
// - P10: the lock is pg_advisory_xact_lock(hashtextextended('aida:branding-logo:' || orgId, 0)),
//   taken first in each transaction, so two overlapping replaces (or a replace and a remove) run one
//   after the other: the later one reads the earlier one's reference and enqueues it. The setting
//   therefore always names a stored file, and every key no longer referenced has a queue row
//   committed with the change that dereferenced it.
// - readCurrentLogo is the public route's read: bare prisma (no session exists there), the row is
//   selected by organization id and key only, and the file is read only when the requested version
//   is the current one. The storage key never comes from request input.
//
// Logs carry codes only, never file content.
//
// Relative imports only.
import { randomBytes } from "node:crypto";
import type { Prisma } from "../../generated/prisma/client";
import type { FileStorage } from "../attachments/file-storage";
import { buildStorageKey, localFileStorage } from "../attachments/local-file-storage";
import { saveStagedFiles } from "../attachments/staged-files";
import { prisma } from "../db";
import { TRANSACTION_OPTIONS } from "../projects/contract";
import { enqueueFileCleanupInTx } from "../projects/file-cleanup";
import { LOGO_EXTENSIONS, type LogoRefusalCode, validateLogo } from "./logo-validate";
import { BRANDING_SETTING_KEYS, type LogoMimeType, parseLogoSetting } from "./settings";

/** The text the per-organization lock key is hashed from: this prefix plus the organization id. */
export const LOGO_LOCK_PREFIX = "aida:branding-logo:";

/** Test-only seams: each is awaited at its point and may park the call. */
export interface LogoStoreHooks {
  /** After the new file is stored, before the transaction starts (replace only). */
  afterStaged?: () => Promise<void>;
  /** First statement of the transaction, before the lock. */
  beforeLock?: (tx: Prisma.TransactionClient) => Promise<void>;
  /** Right after the lock is granted, before the current reference is read. */
  afterLock?: (tx: Prisma.TransactionClient) => Promise<void>;
}

export type ReplaceLogoResult =
  | { ok: true; version: string; replaced: boolean }
  | { ok: false; code: LogoRefusalCode };

function newVersion(): string {
  return randomBytes(6).toString("hex");
}

function errorCode(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) return code;
  }
  return "UNKNOWN";
}

async function lockOrganizationLogo(tx: Prisma.TransactionClient, orgId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${LOGO_LOCK_PREFIX}::text || ${orgId}::text, 0))`;
}

async function currentLogoRow(tx: Prisma.TransactionClient, orgId: string) {
  return tx.setting.findFirst({
    where: { organizationId: orgId, key: BRANDING_SETTING_KEYS.logo },
    select: { id: true, value: true },
  });
}

export async function replaceLogo(input: {
  orgId: string;
  bytes: Uint8Array;
  storage?: FileStorage;
  hooks?: LogoStoreHooks;
}): Promise<ReplaceLogoResult> {
  const { orgId, hooks } = input;
  const storage = input.storage ?? localFileStorage;
  const checked = await validateLogo(input.bytes);
  if (!checked.ok) return checked;

  const data = Buffer.from(input.bytes);
  const key = buildStorageKey(`logo.${LOGO_EXTENSIONS[checked.mimeType]}`);
  const staged = await saveStagedFiles(storage, orgId, [{ key, data }]);
  try {
    if (hooks?.afterStaged) await hooks.afterStaged();
    const version = newVersion();
    const value = JSON.stringify({ storageKey: key, mimeType: checked.mimeType, version });
    const replaced = await prisma.$transaction(async (tx) => {
      if (hooks?.beforeLock) await hooks.beforeLock(tx);
      await lockOrganizationLogo(tx, orgId);
      if (hooks?.afterLock) await hooks.afterLock(tx);
      const current = await currentLogoRow(tx, orgId);
      if (!current) {
        await tx.setting.create({
          data: { organizationId: orgId, key: BRANDING_SETTING_KEYS.logo, value },
        });
        return false;
      }
      await tx.setting.updateMany({
        where: { id: current.id, organizationId: orgId },
        data: { value },
      });
      const previous = parseLogoSetting(current.value);
      if (previous && previous.storageKey !== key) {
        await enqueueFileCleanupInTx(tx, orgId, [previous.storageKey]);
      }
      return previous !== null;
    }, TRANSACTION_OPTIONS);
    return { ok: true, version, replaced };
  } catch (err) {
    await staged.discard();
    throw err;
  }
}

export async function removeLogo(input: {
  orgId: string;
  hooks?: LogoStoreHooks;
}): Promise<{ removed: boolean }> {
  const { orgId, hooks } = input;
  return prisma.$transaction(async (tx) => {
    if (hooks?.beforeLock) await hooks.beforeLock(tx);
    await lockOrganizationLogo(tx, orgId);
    if (hooks?.afterLock) await hooks.afterLock(tx);
    const current = await currentLogoRow(tx, orgId);
    if (!current) return { removed: false };
    await tx.setting.deleteMany({ where: { id: current.id, organizationId: orgId } });
    const previous = parseLogoSetting(current.value);
    if (previous) await enqueueFileCleanupInTx(tx, orgId, [previous.storageKey]);
    return { removed: true };
  }, TRANSACTION_OPTIONS);
}

/** The current logo's bytes when `version` is the current version; null otherwise. */
export async function readCurrentLogo(input: {
  orgId: string;
  version: string;
  storage?: FileStorage;
}): Promise<{ bytes: Buffer; mimeType: LogoMimeType } | null> {
  const row = await prisma.setting.findFirst({
    where: { organizationId: input.orgId, key: BRANDING_SETTING_KEYS.logo },
    select: { value: true },
  });
  const logo = parseLogoSetting(row?.value);
  if (!logo || logo.version !== input.version) return null;
  const storage = input.storage ?? localFileStorage;
  try {
    const bytes = await storage.read({ orgId: input.orgId, key: logo.storageKey });
    return { bytes, mimeType: logo.mimeType };
  } catch (err) {
    // A referenced file that is missing is a miss like any other; anything else is a real error.
    if (errorCode(err) === "ENOENT") return null;
    throw err;
  }
}
