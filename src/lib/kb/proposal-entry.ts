// Phase 12.2 entry points (UI-SPEC Surface 1a, AIDA-18, D-07, D-09): why "Propose KB article…" is
// unavailable in the ticket's "More ticket actions" menu and in the inbox bulk bar. Both entries
// are shown to owners and admins only; for them the entry is never hidden but disabled with one
// of the "Entry unavailable" rows below. The entries are a convenience: requestProposal checks
// the role, AI, the count and every ticket on the server (plan 12.2-04) and refuses anyway.
//
// Pure and client-safe: client components import it. Relative imports only.

import type { StateGroupKey } from "../tickets/state-copy";
import {
  ELIGIBLE_SOURCE_GROUPS,
  MAX_PROPOSAL_SOURCES,
  MIN_PROPOSAL_SOURCES,
} from "./proposal-contract";
import {
  ENTRY_UNAVAILABLE_AI_OFF,
  ENTRY_UNAVAILABLE_MERGED,
  ENTRY_UNAVAILABLE_NOT_RESOLVED,
  ENTRY_UNAVAILABLE_TOO_MANY,
} from "./proposal-copy";

export interface ProposalMenuEntryInput {
  /** The organization's aiEnabled setting (D-09). */
  aiEnabled: boolean;
  /** The ticket's state group; a state name is never judged (D-07). */
  group: StateGroupKey;
  /** The ticket was merged into another one (D-07). */
  merged: boolean;
}

/**
 * The reason the menu item is disabled, or null when it is offered. In order: AI off, a merged
 * source, a group other than RESOLVED or CLOSED.
 */
export function proposalMenuUnavailableReason({
  aiEnabled,
  group,
  merged,
}: ProposalMenuEntryInput): string | null {
  if (!aiEnabled) return ENTRY_UNAVAILABLE_AI_OFF;
  if (merged) return ENTRY_UNAVAILABLE_MERGED;
  if (!(ELIGIBLE_SOURCE_GROUPS as readonly string[]).includes(group)) {
    return ENTRY_UNAVAILABLE_NOT_RESOLVED;
  }
  return null;
}

export interface ProposalBulkEntryInput {
  /** The organization's aiEnabled setting (D-09). */
  aiEnabled: boolean;
  /** The number of selected tickets. */
  count: number;
  /**
   * The bulk bar's own lock reason while its call lock or unknown-outcome lock is on (the bar's
   * existing text, UI-SPEC 1a), or null when the bar is not locked.
   */
  locked: string | null;
}

/**
 * The reason the bulk button is disabled, or null when it opens the Start dialog. In order: AI
 * off, a selection outside 1 to MAX_PROPOSAL_SOURCES (the bar shows nothing for an empty one, so
 * in practice more than five), the bar's lock. Eligibility of each ticket is not judged here; the
 * Start dialog shows it.
 */
export function proposalBulkUnavailableReason({
  aiEnabled,
  count,
  locked,
}: ProposalBulkEntryInput): string | null {
  if (!aiEnabled) return ENTRY_UNAVAILABLE_AI_OFF;
  if (count > MAX_PROPOSAL_SOURCES || count < MIN_PROPOSAL_SOURCES) {
    return ENTRY_UNAVAILABLE_TOO_MANY;
  }
  if (locked !== null) return locked;
  return null;
}
