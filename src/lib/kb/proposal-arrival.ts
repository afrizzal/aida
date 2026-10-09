// Phase 12.2, review b-WR-05 (UI-SPEC 3i "Start success → the review page <h1> (tabIndex -1)
// after navigation"). Client-safe; relative imports only.
//
// The Start dialog marks the proposal it started right before router.push; the review page takes
// the mark once, on mount, and focuses its h1. Client-side navigation keeps this module's state,
// so no URL parameter or storage is needed. A normal visit (a link, a reload) finds no mark and
// the page keeps normal document order (3i "Review page load: no autofocus").

let startedProposalId: string | null = null;

/** Called by the Start dialog after a successful start, before it navigates. */
export function markStartedProposal(proposalId: string): void {
  startedProposalId = proposalId;
}

/**
 * True once for the page of the proposal that was just started. Any call clears the mark, so a
 * mark is never applied later by another page.
 */
export function takeStartedProposal(proposalId: string): boolean {
  const marked = startedProposalId === proposalId;
  startedProposalId = null;
  return marked;
}
