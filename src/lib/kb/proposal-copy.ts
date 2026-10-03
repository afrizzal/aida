// Phase 12.2 copy rows (UI-SPEC Copywriting Contract and amendments A1 to A5). Each string is one
// exported constant, or a function of escaped runtime values, used verbatim; the copy-table unit
// test checks each against its row. Pure and client-safe: server and client components import it.
// Relative imports only.

import type { ProposalStatus } from "./proposal-contract";

// --- Status labels -------------------------------------------------------------------------------

/** Copywriting "Status labels". */
export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  GENERATING: "Generating",
  DRAFT: "Draft",
  REJECTED: "Rejected",
  PUBLISHED: "Published",
  FAILED: "Failed",
};
