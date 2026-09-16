// Saved views (Phase 11, AIDA-47, D-03 to D-05). Every authorization decision for a saved view
// is made here, on the server; the sidebar, the strip, the save dialog and the palette only call
// these functions (through the server actions in src/app/(app)/tickets/saved-view-actions.ts).
//
// Rules (D-04):
//   - Any active member creates a PRIVATE or a SHARED view.
//   - A PRIVATE view is read, edited and deleted only by its owner. To anyone else it does not
//     exist: NOT_FOUND / not_available, exactly like an unknown id (T-11-12).
//   - A SHARED view is read by every member; it is edited or deleted by its owner or by an
//     admin or owner of the organization. Only the view's owner changes its visibility.
//   - Order: position, then name, then id. A new view (or one whose visibility changes) gets
//     the next position in its target group: the owner's PRIVATE views, or the organization's
//     SHARED views.
//   - Names are trimmed and 1 to 80 characters; unique (ignoring case) per owner among PRIVATE
//     views and per organization among SHARED views. The partial unique indexes decide, never
//     a pre-check, so a concurrent duplicate is refused too.
//   - Filters are validated with the one inbox grammar (src/lib/tickets/list-filters.ts). Tag
//     and custom-field references are refused on save (MISSING_REFERENCE) and reported, but
//     kept, on open (D-05).
//
// Membership (D-01): every function reads the actor's member row first and refuses with
// MEMBERSHIP_ENDED when it is gone. Writes read it inside their transaction.
//
// Error contract: a SavedViewError rolls the transaction back and is RETURNED as
// { ok: false, error: code } by the write functions (the reads throw it, see below). A unique
// violation from the write is mapped to DUPLICATE_PRIVATE_NAME or DUPLICATE_SHARED_NAME from
// the error the transaction rejects with. Any other error (database, or one thrown by a test
// hook) rolls the transaction back and is RETHROWN unchanged.
//
// Every read uses an explicit organizationId predicate (T-11-13). Relative imports only and no
// Next.js import: cache revalidation belongs to the server actions.
import type { Prisma, PrismaClient, SavedViewVisibility } from "../../generated/prisma/client";
import { findActiveMembership } from "../membership";
import {
  filtersToSearchParams,
  type InboxFiltersInput,
  parseStoredFilters,
  type StoredViewFilters,
  ticketListFiltersSchema,
  toStoredFilters,
} from "../tickets/list-filters";

export const MAX_VIEW_NAME_LENGTH = 80;

const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

export type SavedViewErrorCode =
  | "INVALID_NAME"
  | "INVALID_FILTERS"
  | "DUPLICATE_PRIVATE_NAME"
  | "DUPLICATE_SHARED_NAME"
  | "MISSING_REFERENCE"
  | "NOT_ALLOWED"
  | "NOT_FOUND"
  | "MEMBERSHIP_ENDED";

/** A refusal by the service. Write functions return its code; read functions throw it. */
export class SavedViewError extends Error {
  readonly code: SavedViewErrorCode;

  constructor(code: SavedViewErrorCode) {
    super(`Saved view refused: ${code}`);
    this.name = "SavedViewError";
    this.code = code;
  }
}

export interface SavedViewActor {
  userId: string;
  orgId: string;
}

export interface SavedViewInput {
  name: string;
  visibility: SavedViewVisibility;
  filters: InboxFiltersInput;
}

export type SavedViewWriteResult =
  | { ok: true; id: string; href: string }
  | { ok: false; error: SavedViewErrorCode };

/** Test seams. Production callers never pass them. */
export interface SavedViewHooks {
  /** Awaited as the very first step inside the transaction. */
  onTransactionStart?(tx: Prisma.TransactionClient): Promise<void> | void;
  /** Awaited as the last step before the transaction returns (and commits). */
  beforeCommit?(tx: Prisma.TransactionClient): Promise<void> | void;
}

export interface SavedViewListItem {
  id: string;
  name: string;
  visibility: SavedViewVisibility;
  href: string;
}

/** Client for plain reads: the global prisma client or an interactive transaction client. */
type ReadClient = Prisma.TransactionClient;
/** Client for writes: needs $transaction, so the global prisma client. */
type WriteClient = Pick<PrismaClient, "$transaction">;

const VISIBILITIES: readonly SavedViewVisibility[] = ["PRIVATE", "SHARED"];

/** /tickets?sv={id} followed by the stored filters as URL parameters (never limit). */
export function savedViewHref(id: string, filters: StoredViewFilters | InboxFiltersInput): string {
  const params = new URLSearchParams({ sv: id });
  for (const [key, value] of filtersToSearchParams(filters)) params.append(key, value);
  return `/tickets?${params.toString()}`;
}

async function requireMembership(client: ReadClient, actor: SavedViewActor) {
  const membership = await findActiveMembership(client, actor?.userId, actor?.orgId);
  if (!membership) throw new SavedViewError("MEMBERSHIP_ENDED");
  return membership;
}

/** Trims and checks 1..80 characters (D-03). */
function validateName(raw: unknown): string {
  if (typeof raw !== "string") throw new SavedViewError("INVALID_NAME");
  const name = raw.trim();
  if (name.length < 1 || name.length > MAX_VIEW_NAME_LENGTH) {
    throw new SavedViewError("INVALID_NAME");
  }
  return name;
}

function validateVisibility(raw: unknown): SavedViewVisibility {
  if (!VISIBILITIES.includes(raw as SavedViewVisibility)) {
    throw new SavedViewError("INVALID_FILTERS");
  }
  return raw as SavedViewVisibility;
}

/** Validates with the one inbox grammar and returns the stored shape (limit dropped). */
function validateFilters(raw: unknown): StoredViewFilters {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new SavedViewError("INVALID_FILTERS");
  }
  const { limit: _limit, ...rest } = raw as Record<string, unknown>;
  const parsed = ticketListFiltersSchema.safeParse(rest);
  if (!parsed.success) throw new SavedViewError("INVALID_FILTERS");
  return toStoredFilters(parsed.data);
}

/** Which references of the filters no longer exist in the organization (D-05). */
async function findMissingReferences(
  client: ReadClient,
  orgId: string,
  filters: StoredViewFilters,
): Promise<{ tag: boolean; customField: boolean }> {
  const [tag, definition] = await Promise.all([
    filters.tagId
      ? client.tag.findFirst({
          where: { id: filters.tagId, organizationId: orgId },
          select: { id: true },
        })
      : null,
    filters.cf
      ? client.customFieldDefinition.findFirst({
          where: { id: filters.cf.definitionId, organizationId: orgId },
          select: { id: true },
        })
      : null,
  ]);
  return {
    tag: filters.tagId !== undefined && tag === null,
    customField: filters.cf !== undefined && definition === null,
  };
}

async function requireReferences(client: ReadClient, orgId: string, filters: StoredViewFilters) {
  const missing = await findMissingReferences(client, orgId, filters);
  if (missing.tag || missing.customField) throw new SavedViewError("MISSING_REFERENCE");
}

/** The largest position in the target group plus one (D-04); 0 for an empty group. */
async function nextPosition(
  client: ReadClient,
  orgId: string,
  ownerUserId: string,
  visibility: SavedViewVisibility,
): Promise<number> {
  const agg = await client.savedView.aggregate({
    where:
      visibility === "PRIVATE"
        ? { organizationId: orgId, ownerUserId, visibility: "PRIVATE" }
        : { organizationId: orgId, visibility: "SHARED" },
    _max: { position: true },
  });
  const max = agg._max.position;
  return max === null ? 0 : max + 1;
}

/** Postgres 23505 as surfaced by Prisma (P2002), with or without the pg driver adapter. */
function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; meta?: unknown; name?: unknown };
  if (e.code === "P2002") return true;
  if (e.code === "23505") return true;
  const meta = JSON.stringify(e.meta ?? {});
  return /"originalCode":"23505"|UniqueConstraintViolation/.test(meta);
}

function duplicateCode(visibility: SavedViewVisibility): SavedViewErrorCode {
  return visibility === "PRIVATE" ? "DUPLICATE_PRIVATE_NAME" : "DUPLICATE_SHARED_NAME";
}

/**
 * Creates a PRIVATE or SHARED view owned by the actor. Membership, validation, reference
 * checks, the position read and the insert run in one transaction (hooks are test seams).
 */
export async function createSavedView(
  client: WriteClient,
  actor: SavedViewActor,
  input: SavedViewInput,
  hooks: SavedViewHooks = {},
): Promise<SavedViewWriteResult> {
  // The visibility being written decides which partial unique index a violation came from.
  const target = VISIBILITIES.includes(input?.visibility) ? input.visibility : null;
  try {
    return await client.$transaction(async (tx) => {
      if (hooks.onTransactionStart) await hooks.onTransactionStart(tx);
      await requireMembership(tx, actor);

      const name = validateName(input?.name);
      const visibility = validateVisibility(input?.visibility);
      const filters = validateFilters(input?.filters);
      await requireReferences(tx, actor.orgId, filters);
      const position = await nextPosition(tx, actor.orgId, actor.userId, visibility);

      const created = await tx.savedView.create({
        data: {
          organizationId: actor.orgId,
          ownerUserId: actor.userId,
          name,
          visibility,
          filters,
          position,
        },
        select: { id: true },
      });

      if (hooks.beforeCommit) await hooks.beforeCommit(tx);
      return { ok: true as const, id: created.id, href: savedViewHref(created.id, filters) };
    }, TRANSACTION_OPTIONS);
  } catch (err) {
    if (err instanceof SavedViewError) return { ok: false, error: err.code };
    if (target !== null && isUniqueViolation(err)) {
      return { ok: false, error: duplicateCode(target) };
    }
    throw err;
  }
}

interface ViewRow {
  id: string;
  name: string;
  visibility: SavedViewVisibility;
  filters: unknown;
}

function toListItems(rows: readonly ViewRow[]): SavedViewListItem[] {
  const items: SavedViewListItem[] = [];
  for (const row of rows) {
    const filters = parseStoredFilters(row.filters);
    if (!filters) {
      // Only the id: never a name or filter text in a log line.
      console.warn(`[saved-views] skipped view ${row.id}: stored filters are not valid`);
      continue;
    }
    items.push({
      id: row.id,
      name: row.name,
      visibility: row.visibility,
      href: savedViewHref(row.id, filters),
    });
  }
  return items;
}

const LIST_ORDER = [{ position: "asc" }, { name: "asc" }, { id: "asc" }] as const;

/**
 * The viewer's own PRIVATE views and every SHARED view of the organization, each ordered by
 * position, then name, then id (D-04). Nothing else: another member's PRIVATE view never
 * appears (T-11-12). Throws SavedViewError("MEMBERSHIP_ENDED") for a removed member.
 */
export async function listSavedViewsForViewer(
  client: ReadClient,
  actor: SavedViewActor,
): Promise<{ private: SavedViewListItem[]; shared: SavedViewListItem[] }> {
  await requireMembership(client, actor);
  const select = { id: true, name: true, visibility: true, filters: true } as const;
  const [privateRows, sharedRows] = await Promise.all([
    client.savedView.findMany({
      where: { organizationId: actor.orgId, ownerUserId: actor.userId, visibility: "PRIVATE" },
      orderBy: [...LIST_ORDER],
      select,
    }),
    client.savedView.findMany({
      where: { organizationId: actor.orgId, visibility: "SHARED" },
      orderBy: [...LIST_ORDER],
      select,
    }),
  ]);
  return { private: toListItems(privateRows), shared: toListItems(sharedRows) };
}
