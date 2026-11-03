// ---------------------------------------------------------------------------
// tenant-guard.ts — the one guard in front of every demo write (Phase 9 plan 09-02, AIDA-37,
// D-15 to D-17, U-04, U-17). Shared by `pnpm db:seed` (prisma/seed.ts) and the DEMO_MODE boot
// (bootstrap-demo.ts) so the two paths cannot drift.
//
// Owner decision 2026-11-11 item 3: the seed refuses and never deletes demo data. Nothing here
// deletes, renames or modifies an organization, user, membership or demo row; a refusal
// writes nothing.
//
// Order, all under the tenant seed lock (src/lib/tenant-seed-lock.ts):
//   1. classify the tenant data (reads organization ids, user emails and the marker row only);
//   2. empty -> create the demo identities, seed the domain data, and write the completion
//      marker LAST, through the lock's transaction;
//   3. anything else -> return without a write.
//
// The seed's writes are not one transaction: Better Auth and createTicket commit their own
// work. A crash at any stage therefore leaves rows and no marker, and every later run of
// either path classifies that as demo-partial and refuses (the manual recovery is documented
// in docs/OPERATIONS.md, "Demo mode").
// ---------------------------------------------------------------------------
import type { Prisma } from "@/generated/prisma/client";
import {
  createDemoIdentities,
  DEMO_ADMIN_EMAIL_DEFAULT,
  DEMO_AGENT_EMAIL_DEFAULT,
} from "@/lib/demo/identities";
import { type SeedDemoSummary, seedDemoData } from "@/lib/demo/seed-demo-data";
import { TenantSeedLockTimeout, withTenantSeedLock } from "@/lib/tenant-seed-lock";

/** The Setting key, in the demo organization, that marks a complete demo dataset. */
export const DEMO_SEED_COMPLETE_KEY = "demo:seed-complete";

/** The marker's value. Only the key's presence is read; the value names the dataset. */
export const DEMO_SEED_COMPLETE_VALUE = JSON.stringify({ dataset: "aida-demo", version: 1 });

/**
 * Infrastructure data never counts as tenant data (D-15). Documentation constant: the
 * classifier reads none of these; it reads only `organization`, `user` and the marker row.
 * - `_prisma_migrations`: written by `prisma migrate deploy`.
 * - `SystemSetting`: global rows (heartbeat, setupComplete, backup status).
 * - `RateLimitHit`: limiter rows, written by anonymous requests.
 * - the `pgboss` schema: the job queue.
 * Not infrastructure: `ProjectFileCleanup` (the deletion queue, plan 09-04) is org-scoped and
 * cascades with its organization. `TicketState` and `TicketStateConfig` rows are written by
 * the organization-insert trigger `aida_organization_ticket_states` with every organization,
 * so they exist exactly when an organization does and need no separate check.
 */
export const INFRASTRUCTURE_TABLES = {
  tables: ["_prisma_migrations", "SystemSetting", "RateLimitHit"],
  schemas: ["pgboss"],
} as const;

/** Each committed write of a demo seed, in order (W1 to W6 in the 09-02 SUMMARY). */
export type DemoSeedStage =
  | "admin-user"
  | "organization"
  | "setup-complete"
  | "agent-user"
  | "agent-member"
  | "first-ticket"
  | "domain-data";

export const DEMO_SEED_STAGES: readonly DemoSeedStage[] = [
  "admin-user",
  "organization",
  "setup-complete",
  "agent-user",
  "agent-member",
  "first-ticket",
  "domain-data",
];

export interface DemoSeedHooks {
  /**
   * Awaited after each stage has committed. Only tests pass it (to stop a seed between two
   * writes); production code passes none and reads no environment variable for it.
   */
  afterStage?: (stage: DemoSeedStage) => Promise<void> | void;
}

export type TenantClassification = "empty" | "demo-complete" | "demo-partial" | "foreign";

type Env = Record<string, string | undefined>;

/** The configured demo identities, lower-cased, with the documented defaults. */
export function demoIdentityEmails(env: Env = process.env): string[] {
  const admin = (env.DEMO_ADMIN_EMAIL || DEMO_ADMIN_EMAIL_DEFAULT).toLowerCase();
  const agent = (env.DEMO_AGENT_EMAIL || DEMO_AGENT_EMAIL_DEFAULT).toLowerCase();
  return admin === agent ? [admin] : [admin, agent];
}

/**
 * Classifies the tenant data (any organization or user row, D-15):
 * - empty: no organization and no user row;
 * - demo-complete: exactly one organization, it holds the marker, and every user email is a
 *   configured demo identity;
 * - demo-partial: at most one organization, every user a demo identity, no marker;
 * - foreign: anything else.
 * The organization slug is never read (the real bootstrap and the demo share slug `aida`).
 */
export async function classifyTenantData(
  tx: Prisma.TransactionClient,
  env: Env = process.env,
): Promise<TenantClassification> {
  const demoEmails = new Set(demoIdentityEmails(env));
  const organizations = await tx.organization.findMany({ select: { id: true }, take: 2 });
  // One more than the demo identities is enough to see a non-demo user (emails are unique).
  const users = await tx.user.findMany({ select: { email: true }, take: demoEmails.size + 1 });

  if (organizations.length === 0 && users.length === 0) return "empty";

  const everyUserIsDemo = users.every((u) => demoEmails.has(u.email.toLowerCase()));
  if (!everyUserIsDemo || organizations.length > 1) return "foreign";

  if (organizations.length === 1) {
    const marker = await tx.setting.findFirst({
      where: { organizationId: organizations[0].id, key: DEMO_SEED_COMPLETE_KEY },
      select: { id: true },
    });
    if (marker) return "demo-complete";
  }
  return "demo-partial";
}

export type DemoSeedCaller = "seed-cli" | "demo-boot";

export type GuardedDemoSeedOutcome =
  | {
      kind: "seeded";
      caller: DemoSeedCaller;
      summary: SeedDemoSummary;
      adminEmail: string;
      durationMs: number;
    }
  | { kind: "already-seeded"; caller: DemoSeedCaller }
  | { kind: "refused-partial"; caller: DemoSeedCaller }
  | { kind: "refused-foreign"; caller: DemoSeedCaller }
  | { kind: "lock-timeout"; caller: DemoSeedCaller };

export interface GuardedDemoSeedOptions {
  caller: DemoSeedCaller;
  hooks?: DemoSeedHooks;
  /** Overrides the lock wait (tests); defaults to the lock module's 120 s. */
  lockTimeoutMs?: number;
}

/**
 * Classifies, then seeds only an empty database. Returns without a write for every other
 * classification. Errors from the seed itself propagate (no marker is written then).
 */
export async function runGuardedDemoSeed(
  opts: GuardedDemoSeedOptions,
): Promise<GuardedDemoSeedOutcome> {
  const { caller, hooks } = opts;
  try {
    return await withTenantSeedLock(
      async (tx): Promise<GuardedDemoSeedOutcome> => {
        const state = await classifyTenantData(tx);
        if (state === "demo-complete") return { kind: "already-seeded", caller };
        if (state === "demo-partial") return { kind: "refused-partial", caller };
        if (state === "foreign") return { kind: "refused-foreign", caller };

        const started = Date.now();
        const ids = await createDemoIdentities(hooks);
        const summary = await seedDemoData({
          orgId: ids.orgId,
          adminUserId: ids.adminUserId,
          agentUserId: ids.agentUserId,
          onStage: async (stage) => {
            await hooks?.afterStage?.(stage);
          },
        });
        await hooks?.afterStage?.("domain-data");

        // Last write: the marker commits together with the lock release.
        await tx.setting.create({
          data: {
            organizationId: ids.orgId,
            key: DEMO_SEED_COMPLETE_KEY,
            value: DEMO_SEED_COMPLETE_VALUE,
          },
        });
        return {
          kind: "seeded",
          caller,
          summary,
          adminEmail: process.env.DEMO_ADMIN_EMAIL || DEMO_ADMIN_EMAIL_DEFAULT,
          durationMs: Date.now() - started,
        };
      },
      opts.lockTimeoutMs === undefined ? {} : { lockTimeoutMs: opts.lockTimeoutMs },
    );
  } catch (err) {
    if (err instanceof TenantSeedLockTimeout) return { kind: "lock-timeout", caller };
    throw err;
  }
}
