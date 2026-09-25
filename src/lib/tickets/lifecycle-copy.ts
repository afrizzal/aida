// Phase 12 copy rows that a code review found without a UI-SPEC Copywriting row, or that more
// than one component shows (review UI-WR-05). Each string is one exported constant used
// verbatim, and the copy-table unit test checks each against its row. Pure and client-safe:
// server and client components import it. Relative imports only.

/** Copywriting "Merged banner, date unknown": fills {date} when the merge time is not stored. */
export const MERGED_BANNER_DATE_UNKNOWN = "an earlier date";

/** Copywriting "Merged composer line, target unavailable". */
export const MERGED_COMPOSER_TARGET_UNAVAILABLE =
  "Replies go on the ticket this one was merged into.";

/** Copywriting "Merge confirm description (sr)". */
export const MERGE_CONFIRM_DESCRIPTION = "Review what happens before you merge these tickets.";

/** Copywriting "Link remove outcome unknown": a rejected removal call (P11 D2). */
export const LINK_REMOVE_OUTCOME_UNKNOWN =
  "The result is not known. The link may have been removed. Refresh the page to check before you try again.";
