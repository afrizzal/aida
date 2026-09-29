import "./test-env";
import { prisma } from "../../../src/lib/db";
import { createTicket } from "../../../src/lib/tickets/create-ticket";
import { type LegacyStatusKey, readLegacyStateIds } from "../../../src/lib/tickets/ticket-states";
import { autoCloseHandler } from "../../../src/lib/worker/jobs/auto-close";
import { orgId } from "./test-env";

export type { LegacyStatusKey };
export { autoCloseHandler, createTicket, orgId, prisma };

let legacyStateIds: Promise<Record<LegacyStatusKey, string | null>> | undefined;

/**
 * The id of the E2E organization's migrated state for a legacy status key (Phase 12.1, D-09).
 * Specs seed tickets in a state through this id; the old status column no longer exists. The
 * mapping is read once per worker. Throws when the key has no active migrated state.
 */
export async function stateIdFor(key: LegacyStatusKey): Promise<string> {
  legacyStateIds ??= readLegacyStateIds(prisma, orgId);
  const id = (await legacyStateIds)[key];
  if (!id)
    throw new Error(`No active migrated state for legacy key ${key} in the E2E organization`);
  return id;
}
