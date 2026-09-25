// Phase 12 copy rows that a code review found without a UI-SPEC Copywriting row, or that more
// than one component shows (review UI-WR-05, UI-WR-06 and run decision K34). Each string is one
// exported constant used verbatim, and the copy-table unit test checks each against its row.
// Pure and client-safe: server and client components import it. Relative imports only.

/**
 * Copywriting "Merge unavailable: merged source", "Link unavailable: merged source" (K34) and
 * "Status unavailable: merged source" (Codex diff round 1, D1).
 */
export const MERGED_SOURCE_REASON = "This ticket was already merged.";

/** Copywriting "Status error: merged source": the ticket page's refused status change (D1). */
export const STATUS_REFUSED_MERGED_SOURCE =
  "Nothing was changed. This ticket was already merged, so its status can't change.";

/**
 * Copywriting "Bulk error: merged source": the reason under the bulk bar's "Nothing was
 * changed." when a selected ticket is a merged source (D1).
 */
export const BULK_STATUS_REFUSED_MERGED_SOURCE =
  "One of the selected tickets was already merged into another ticket, so its status can't change. Unselect it and try again.";

/** Copywriting "Picker reason: merged", in the merge dialog and, since K34, the link dialog. */
export const PICKER_REASON_MERGED = "Already merged into another ticket";

/** Copywriting "Merged banner, date unknown": fills {date} when the merge time is not stored. */
export const MERGED_BANNER_DATE_UNKNOWN = "an earlier date";

/** Copywriting "Merged composer line, target unavailable". */
export const MERGED_COMPOSER_TARGET_UNAVAILABLE =
  "Replies go on the ticket this one was merged into.";

/** Copywriting "Merge confirm description (sr)". */
export const MERGE_CONFIRM_DESCRIPTION = "Review what happens before you merge these tickets.";

/**
 * Copywriting "Merge error: link changed", shown after the "Nothing was changed." prefix: the
 * link between the pair is not the one the confirm step named (Codex diff round 2, R2-1).
 */
export const MERGE_ERROR_LINK_CHANGED =
  "The link between these tickets changed. Review the merge again.";

/**
 * Copywriting "Merge re-check failed": "Review merge" could not read the chosen ticket again
 * (the read failed, access ended, or the ticket is no longer found), so the confirm step stays
 * closed and the choice is kept (Codex diff round 2, R2-1).
 */
export function mergeRecheckFailedText(target: number): string {
  return `Could not check #${target} again. Try again.`;
}

/** Copywriting "Link remove outcome unknown": a rejected removal call (P11 D2). */
export const LINK_REMOVE_OUTCOME_UNKNOWN =
  "The result is not known. The link may have been removed. Refresh the page to check before you try again.";

/**
 * Copywriting "Merge replaces link" with the current label from this ticket's side, or
 * "Merge replaces link, label unknown" when no label is known. Never a guessed link type
 * (review UI-WR-06).
 */
export function mergeReplacesLinkText(label: string | null): string {
  return label === null
    ? 'The current link between these tickets is replaced by "Duplicate of".'
    : `The current link "${label}" between these tickets is replaced by "Duplicate of".`;
}
