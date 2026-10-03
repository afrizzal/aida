// Phase 12.2 copy rows (UI-SPEC Copywriting Contract and amendments A1 to A5). Each string is one
// exported constant, or a function of escaped runtime values, used verbatim; the copy-table unit
// test checks each against its row. Pure and client-safe: server and client components import it.
// Relative imports only.
//
// Rules (UI-SPEC Copywriting Contract, D-03, D-12): every server code maps to exactly one row
// through the mapping functions at the end of this file, each keyed by a contract union so that
// TypeScript enforces totality; raw provider errors, prompts and ids never appear in copy.
// "Nothing was changed." prefixes every returned refusal except the rows that start with
// "Your access" and the rows that describe a terminal state. The Publish error and Reject error
// rows are written without it (the dialog shows them after the callout prefix); their mapping
// functions compose the prefix, so a dialog renders the returned message as is. The Field errors
// rows are inline field messages and are returned exactly as the UI-SPEC row reads.
//
// Amendment A4 (review C6): an UNKNOWN action result is shown with the action's "… outcome
// unknown" row (outcomeUnknownCopy, applied by proposal-outcome.ts); the four "… error: unknown"
// rows stay here verbatim but no code maps to them.

import type {
  MaintenanceRefusalCode,
  ProposalFailureCode,
  ProposalStatus,
  RequestRefusalCode,
  ReviewRefusalCode,
  TicketRefusalReason,
} from "./proposal-contract";

/** The callout prefix of every returned refusal (UI-SPEC rules). */
export const NOTHING_WAS_CHANGED = "Nothing was changed.";

function withPrefix(row: string): string {
  return `${NOTHING_WAS_CHANGED} ${row}`;
}

// --- Primary CTAs and entry (Surface 1a) ---------------------------------------------------------

/** Copywriting "Primary CTA (start)". */
export const GENERATE_PROPOSAL_CTA = "Generate proposal";

/** Copywriting "Primary CTA (edit)". */
export const SAVE_DRAFT_CTA = "Save draft";

/** Copywriting "Primary CTA (publish trigger / confirm)", first half. */
export const APPROVE_AND_PUBLISH_CTA = "Approve and publish…";

/** Copywriting "Primary CTA (publish trigger / confirm)", second half. */
export const PUBLISH_ARTICLE_CTA = "Publish article";

/** Copywriting "Entry button / menu item". */
export const PROPOSE_KB_ARTICLE_ENTRY = "Propose KB article…";

/** Copywriting "Entry unavailable: AI off". */
export const ENTRY_UNAVAILABLE_AI_OFF =
  "AI is turned off for this workspace. An owner or admin can turn it on in Settings.";

/** Copywriting "Entry unavailable: too many". */
export const ENTRY_UNAVAILABLE_TOO_MANY = "Select 1 to 5 tickets to propose an article.";

/** Copywriting "Entry unavailable: not resolved". */
export const ENTRY_UNAVAILABLE_NOT_RESOLVED =
  "Only tickets with a status in the Resolved or Closed group can be used.";

/** Copywriting "Entry unavailable: merged". */
export const ENTRY_UNAVAILABLE_MERGED =
  "This ticket was merged. Use the ticket it was merged into.";

// --- Start dialog (Surface 1b) -------------------------------------------------------------------

/** Copywriting "Start title / description", first half. */
export const START_TITLE = "Propose a KB article";

/** Copywriting "Start title / description", second half. */
export const START_DESCRIPTION =
  "AIDA drafts an article from these tickets. Nothing is published until an owner or admin approves it.";

/** Copywriting "Customer content notice" (Start dialog and review page). */
export const CUSTOMER_CONTENT_NOTICE =
  "These tickets contain your customers' messages. AIDA removes secrets such as API keys and card numbers, but not names, emails or other personal details. Remove them before you publish.";

/** Copywriting "Start inputs line". */
export const START_INPUTS_LINE =
  "Only the subject and public replies are used. Internal notes and attachments are not.";

/** Copywriting "Start pending". */
export const START_PENDING = "Starting…";

/** Copywriting "Start dismiss". */
export const START_DISMISS = "Close without starting";

/** Copywriting "Started toast". */
export const STARTED_TOAST = "Proposal started. AIDA is drafting it now.";

/** Copywriting "Selection refused intro" (shown after "Nothing was changed."). */
export const SELECTION_REFUSED_INTRO =
  "Some tickets can't be used. Close this dialog, change the selection, and try again.";

/** Copywriting "Ticket refusal: not resolved". */
export const TICKET_REFUSAL_NOT_RESOLVED = "Its status is not in the Resolved or Closed group.";

/** Copywriting "Ticket refusal: merged" in parts, so the dialog can render `#{targetNumber}` as a link. */
export function ticketRefusalMergedParts(targetNumber: number): {
  before: string;
  target: string;
  after: string;
} {
  return { before: "Merged into ", target: `#${targetNumber}`, after: ". Use that ticket." };
}

/** Copywriting "Ticket refusal: merged": `Merged into #{targetNumber}. Use that ticket.` */
export function ticketRefusalMerged(targetNumber: number): string {
  const { before, target, after } = ticketRefusalMergedParts(targetNumber);
  return `${before}${target}${after}`;
}

/** Copywriting "Ticket refusal: not found". */
export const TICKET_REFUSAL_NOT_FOUND = "No longer available.";

/** Copywriting "Ticket refusal: duplicate". */
export const TICKET_REFUSAL_DUPLICATE = "Selected twice.";

/** Copywriting "Start error: AI off". */
export const START_ERROR_AI_OFF = "Nothing was changed. AI is turned off for this workspace.";

/** Copywriting "Start error: count". */
export const START_ERROR_COUNT = "Nothing was changed. Select 1 to 5 tickets.";

/** Copywriting "Start error: not allowed". */
export const START_ERROR_NOT_ALLOWED =
  "Nothing was changed. Only workspace owners and admins can propose articles.";

/** Copywriting "Start error: membership ended". */
export const START_ERROR_MEMBERSHIP_ENDED =
  "Your access to this workspace has ended. Sign out, then sign in again.";

/** Copywriting "Start error: unknown". Mapped from no code (amendment A4). */
export const START_ERROR_UNKNOWN =
  "Nothing was changed. The proposal could not be started. Wait a moment and try again.";

/** Copywriting "Start outcome unknown". */
export const START_OUTCOME_UNKNOWN =
  "The result is not known. A proposal may have been started. Open Proposals to check before you try again.";

// --- Proposal list (Surface 2) -------------------------------------------------------------------

/** Copywriting "Proposals link / page title", first half. */
export const PROPOSALS_LINK = "Proposals";

/** Copywriting "Proposals link / page title", second half. */
export const PROPOSALS_PAGE_TITLE = "Article proposals";

/** Copywriting "Proposals page description". */
export const PROPOSALS_PAGE_DESCRIPTION =
  "Drafts AIDA wrote from resolved tickets. Only owners and admins see them, and none is in the knowledge base until it is published.";

/** Copywriting "Back link". */
export const BACK_TO_ARTICLES = "Back to articles";

/** Copywriting "List AI off notice". */
export const LIST_AI_OFF_NOTICE =
  "AI is off, so no new proposals can be started. Existing drafts can still be reviewed, edited, rejected and published.";

/** Copywriting "Status labels". */
export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  GENERATING: "Generating",
  DRAFT: "Draft",
  REJECTED: "Rejected",
  PUBLISHED: "Published",
  FAILED: "Failed",
};

/** Copywriting "Untitled while generating". */
export const UNTITLED_WHILE_GENERATING = "Untitled (drafting…)";

/** Copywriting "Source count": `1 ticket` / `{n} tickets`. */
export function sourceCount(n: number): string {
  return n === 1 ? "1 ticket" : `${n} tickets`;
}

/** Copywriting "List empty heading / body", first half. */
export const LIST_EMPTY_HEADING = "No proposals yet";

/** Copywriting "List empty heading / body", second half. */
export const LIST_EMPTY_BODY =
  'Select resolved tickets in the inbox and choose "Propose KB article…" to have AIDA draft one.';

/** Copywriting "Generation finished announcement". */
export const GENERATION_FINISHED_ANNOUNCEMENT = "A proposal finished drafting.";

/** Copywriting "Not allowed heading / body", first half. */
export const NOT_ALLOWED_HEADING = "Owners and admins only";

/** Copywriting "Not allowed heading / body", second half. */
export const NOT_ALLOWED_BODY = "Only workspace owners and admins can review article proposals.";

/** Copywriting "Membership ended". */
export const MEMBERSHIP_ENDED =
  "Your access to this workspace has ended. Sign out, then sign in again.";

/** Copywriting "Not found heading / body", first half. */
export const NOT_FOUND_HEADING = "Proposal not found";

/** Copywriting "Not found heading / body", second half. */
export const NOT_FOUND_BODY =
  "It may have been removed. Go back to Proposals to see the current list.";

// --- Review page (Surface 3a to 3d) --------------------------------------------------------------

/** Copywriting "Review page title". */
export const REVIEW_PAGE_TITLE = "Review proposal";

/** Copywriting "Requested by line": `Requested by {name} · {time}`. */
export function requestedByLine(name: string, time: string): string {
  return `Requested by ${name} · ${time}`;
}

/** Copywriting "AI notice". */
export const AI_NOTICE =
  "AI-generated draft. Review every fact before publishing. AIDA may get details wrong.";

/** Copywriting "Source changed notice": `{list} changed after this draft was written. …` */
export function sourceChangedNotice(list: string): string {
  return `${list} changed after this draft was written. Check the draft still matches. It is never updated on its own.`;
}

/** Copywriting "Truncation notice". */
export const TRUNCATION_NOTICE =
  "Some messages were too long or too many and were left out of the draft. Read the source tickets for the full picture.";

/** Copywriting "Title label / help", first half. */
export const TITLE_LABEL = "Title";

/** Copywriting "Title label / help", second half. */
export const TITLE_HELP = "3 to 120 characters.";

/** Copywriting "Body label / help", first half. */
export const BODY_LABEL = "Body (Markdown)";

/** Copywriting "Body label / help", second half, with the sentence of amendment A2 last. */
export const BODY_HELP =
  "Source references such as [T1] are not allowed in the body; AIDA refuses to save or publish a body that contains them. Remove customer names, emails and other personal details. Links to tickets are not allowed.";

/** Copywriting "Preview toggle". */
export const PREVIEW_TOGGLE = "Preview";

/** UI-SPEC 3e action bar: the outline button that opens the Reject dialog. */
export const REJECT_TRIGGER = "Reject…";

/** Copywriting "Citation marker error" (Body field). */
export const CITATION_MARKER_ERROR =
  "Nothing was changed. The body contains source references such as [T1]. Remove them, then save again.";

/** Amendment A2 "Title citation marker error"; also a ticket link in the title (K51, K52). */
export const TITLE_CITATION_MARKER_ERROR =
  "Nothing was changed. The title contains source references such as [T1]. Remove them, then save again.";

/** Amendment A2 "Ticket link error" (Body field). */
export const TICKET_LINK_ERROR =
  "Nothing was changed. The body links to a ticket. Remove ticket links, then save again.";

/** Copywriting "Field errors", first part. */
export const TITLE_TOO_SHORT_ERROR = "Title must be at least 3 characters.";

/** Copywriting "Field errors", second part. */
export const TITLE_TOO_LONG_ERROR = "Title must be at most 120 characters.";

/** Copywriting "Field errors", third part. */
export const BODY_REQUIRED_ERROR = "Body is required.";

/** Copywriting "Sources heading". */
export const SOURCES_HEADING = "Sources";

/** Copywriting "Source changed short". */
export const SOURCE_CHANGED_SHORT = "Changed since drafting";

/** Copywriting "Cited in / Not cited", first half: `Cited in: {markers}`. */
export function citedIn(markers: string): string {
  return `Cited in: ${markers}`;
}

/** Copywriting "Cited in / Not cited", second half. */
export const NOT_CITED = "Not cited";

/** Copywriting "Source unavailable". */
export const SOURCE_UNAVAILABLE = "This ticket is no longer available.";

/** Copywriting "Sources internal note". */
export const SOURCES_INTERNAL_NOTE = "Sources are internal and are never shown in the article.";

// --- Save (3e DRAFT, 3h) -------------------------------------------------------------------------

/** Copywriting "Save pending / Saved toast", first half. */
export const SAVE_PENDING = "Saving…";

/** Copywriting "Save pending / Saved toast", second half. */
export const SAVED_TOAST = "Draft saved. It is not published.";

/** Copywriting "Save error: not draft". */
export const SAVE_ERROR_NOT_DRAFT =
  "Nothing was changed. This proposal is no longer a draft. Reload it to see its status.";

/** Copywriting "Save error: not allowed". */
export const SAVE_ERROR_NOT_ALLOWED =
  "Nothing was changed. Only workspace owners and admins can edit proposals.";

/** Copywriting "Save error: unknown". Mapped from no code (amendment A4). */
export const SAVE_ERROR_UNKNOWN =
  "Nothing was changed. The draft could not be saved. Wait a moment and try again.";

/** Copywriting "Save outcome unknown". */
export const SAVE_OUTCOME_UNKNOWN =
  "The result is not known. The draft may have been saved. Reload the proposal to check before you try again.";

/** Copywriting "Conflict" (save, publish and reject). */
export const CONFLICT =
  "Nothing was changed. Someone else changed this proposal after you opened it. Reload it to see their version. Your edits are still in the form; copy them first if you need them.";

/** Copywriting "Reload button". */
export const RELOAD_BUTTON = "Reload proposal";

/** Copywriting "Publish unavailable: unsaved". */
export const PUBLISH_UNAVAILABLE_UNSAVED = "Save your changes first.";

// --- Approve and publish dialog (3f) -------------------------------------------------------------

/** Copywriting "Publish title". */
export const PUBLISH_TITLE = "Publish this article?";

/** Copywriting "Publish description": `"{title}" will be added to the knowledge base, …` */
export function publishDescription(title: string): string {
  return `"${title}" will be added to the knowledge base, where AIDA uses it to draft replies.`;
}

/** Copywriting "Publish checklist", one item per entry. */
export const PUBLISH_CHECKLIST: readonly string[] = [
  "Facts are correct.",
  "Customer names, emails and other personal details are removed.",
  "Nothing in it is private to one customer.",
];

/** Copywriting "Publish cannot be undone". */
export const PUBLISH_CANNOT_BE_UNDONE =
  "Publishing can't be undone here. To change the article later, edit it in the knowledge base.";

/** Copywriting "Publish confirm checkbox". */
export const PUBLISH_CONFIRM_CHECKBOX = "I reviewed this draft and it is ready to publish.";

/** Copywriting "Destructive confirmation: Publish": the outline dismiss button. */
export const KEEP_REVIEWING = "Keep reviewing";

/** Copywriting "Destructive confirmation: Publish": the pending label. */
export const PUBLISH_PENDING = "Publishing…";

/** Copywriting "Published toast". */
export const PUBLISHED_TOAST = "Article published. AIDA is indexing it now.";

/** Amendment A1 "Published toast: indexing not started" (toast.warning). */
export const PUBLISHED_TOAST_INDEXING_NOT_STARTED =
  "Article published, but indexing did not start. Open the proposal and use Retry indexing.";

/** Copywriting "Publish error: not draft" (shown after the callout prefix). */
export const PUBLISH_ERROR_NOT_DRAFT =
  "This proposal is no longer a draft. Reload it to see its status.";

/** Copywriting "Publish error: not allowed" (shown after the callout prefix). */
export const PUBLISH_ERROR_NOT_ALLOWED = "Only workspace owners and admins can publish.";

/** Copywriting "Publish error: unknown". Mapped from no code (amendment A4). */
export const PUBLISH_ERROR_UNKNOWN =
  "The article could not be published. Wait a moment and try again.";

/** Copywriting "Publish outcome unknown". */
export const PUBLISH_OUTCOME_UNKNOWN =
  "The result is not known. The article may have been published. Reload the proposal to check before you try again.";

// --- Reject dialog (3g) --------------------------------------------------------------------------

/** Copywriting "Reject title / description", first half. */
export const REJECT_TITLE = "Reject this proposal?";

/** Copywriting "Reject title / description", second half. */
export const REJECT_DESCRIPTION =
  "It stays in the list as rejected and can never be published. To try again, start a new proposal.";

/** Copywriting "Destructive confirmation: Reject": the outline dismiss button. */
export const KEEP_PROPOSAL = "Keep proposal";

/** Copywriting "Destructive confirmation: Reject": the destructive confirm button. */
export const REJECT_PROPOSAL = "Reject proposal";

/** Copywriting "Destructive confirmation: Reject": the pending label. */
export const REJECT_PENDING = "Rejecting…";

/** Copywriting "Rejected toast". */
export const REJECTED_TOAST = "Proposal rejected.";

/** Copywriting "Reject error: not draft" (shown after the callout prefix). */
export const REJECT_ERROR_NOT_DRAFT =
  "This proposal is no longer a draft. Reload it to see its status.";

/** Copywriting "Reject error: not allowed" (shown after the callout prefix). */
export const REJECT_ERROR_NOT_ALLOWED = "Only workspace owners and admins can reject proposals.";

/** Copywriting "Reject error: unknown". Mapped from no code (amendment A4). */
export const REJECT_ERROR_UNKNOWN =
  "The proposal could not be rejected. Wait a moment and try again.";

/** Copywriting "Reject outcome unknown". */
export const REJECT_OUTCOME_UNKNOWN =
  "The result is not known. The proposal may have been rejected. Reload it to check before you try again.";

// --- Generation and terminal states (3e) ---------------------------------------------------------

/** Copywriting "Generating body". */
export const GENERATING_BODY = "AIDA is drafting this article. This page updates on its own.";

/** Copywriting "Stuck notice / button", first half. */
export const STUCK_NOTICE =
  "This draft is taking longer than expected. You can restart it; this may call your AI provider again.";

/** Copywriting "Stuck notice / button", second half. */
export const RESTART_GENERATION = "Restart generation";

/** Copywriting "Failure short / full: AI off", full half (terminal state, no prefix). */
export const FAILURE_AI_OFF =
  "AI was turned off before drafting started. Turn it on, then start a new proposal.";

/** Copywriting "Failure: source changed". */
export const FAILURE_SOURCE_CHANGED =
  "A source ticket was reopened or merged before drafting. Start a new proposal with the current tickets.";

/** Copywriting "Failure: provider". */
export const FAILURE_PROVIDER =
  "Your AI provider did not answer. Check Settings → AI, then start a new proposal.";

/** Copywriting "Failure: invalid output". */
export const FAILURE_INVALID_OUTPUT =
  "The AI answer could not be used. Start a new proposal; a different selection may help.";

/** Copywriting "Failure: configuration". */
export const FAILURE_CONFIGURATION =
  "AI is not set up correctly. Check Settings → AI, then start a new proposal.";

/** Copywriting "Failure: unknown". */
export const FAILURE_UNKNOWN = "Drafting failed. Start a new proposal.";

/** Copywriting "Failure short (list)", first entry. */
export const FAILURE_SHORT_PROVIDER = "Provider error";

/** Copywriting "Failure short (list)", second entry. */
export const FAILURE_SHORT_INVALID_OUTPUT = "Unusable answer";

/** Copywriting "Failure short (list)", third entry. */
export const FAILURE_SHORT_CONFIGURATION = "Setup problem";

/** Copywriting "Failure short (list)", fourth entry. */
export const FAILURE_SHORT_SOURCE_CHANGED = "Source changed";

/** Copywriting "Failure short (list)" fifth entry, equal to "Failure short / full: AI off". */
export const FAILURE_SHORT_AI_OFF = "AI was off";

/** Copywriting "Failure short (list)", last entry. */
export const FAILURE_SHORT_UNKNOWN = "Failed";

/** Copywriting "New proposal button". */
export const NEW_PROPOSAL_BUTTON = "Start a new proposal";

/** Copywriting "Rejected notice": `Rejected by {name} · {time}. This proposal can't be published.` */
export function rejectedNotice(name: string, time: string): string {
  return `Rejected by ${name} · ${time}. This proposal can't be published.`;
}

/** Copywriting "Published notice / link", first half: `Published by {name} · {time}.` */
export function publishedNotice(name: string, time: string): string {
  return `Published by ${name} · ${time}.`;
}

/** Copywriting "Published notice / link", second half. */
export const OPEN_ARTICLE = "Open article";

// --- Restart and retry indexing (3e, 3i) ---------------------------------------------------------

/** Copywriting "Retry indexing / pending / result", first part. */
export const RETRY_INDEXING = "Retry indexing";

/** Copywriting "Retry indexing / pending / result", second part. */
export const RETRY_INDEXING_PENDING_LABEL = "Retrying…";

/** Copywriting "Retry indexing / pending / result", third part (only for queued: true, A5). */
export const INDEXING_RESTARTED = "Indexing restarted.";

/** Amendment A1: the 12px muted line above "Retry indexing" while the embedding is PENDING. */
export const RETRY_INDEXING_PENDING_HINT = "Indexing has not finished. If it stays Pending, retry.";

/** Copywriting "Restart / Retry error". */
export const RESTART_RETRY_ERROR = "Nothing was changed. Wait a moment and try again.";

/** Copywriting "Restart outcome unknown". */
export const RESTART_OUTCOME_UNKNOWN =
  "The result is not known. Generation may have restarted. Reload the proposal to check before you try again.";

/** Copywriting "Retry indexing outcome unknown". */
export const RETRY_INDEXING_OUTCOME_UNKNOWN =
  "The result is not known. Indexing may have restarted. Reload the proposal to check before you try again.";

/** Amendment A3 "Restart recorded, generation not started" (restart status line). */
export const RESTART_RECORDED_NOT_STARTED =
  "Restart was recorded, but generation did not start. You can restart again in 10 minutes.";

/** Amendment A5 "Retry recorded, indexing not started" (retry status line, warning tone). */
export const RETRY_RECORDED_NOT_STARTED =
  "Retry was recorded, but indexing did not start. Try Retry indexing again in a moment.";

// --- Code-to-row mappings ------------------------------------------------------------------------

/** The editor fields a field refusal names (equal to DraftField of proposal-schema.ts). */
export const PROPOSAL_FIELDS = ["title", "bodyMarkdown"] as const;

export type ProposalField = (typeof PROPOSAL_FIELDS)[number];

/** The review refusal codes that name a field (equal to DraftFieldCode of proposal-schema.ts). */
export const PROPOSAL_FIELD_CODES = [
  "CITATION_MARKER",
  "TICKET_LINK",
  "TITLE_TOO_SHORT",
  "TITLE_TOO_LONG",
  "BODY_REQUIRED",
] as const satisfies readonly ReviewRefusalCode[];

export type ProposalFieldCode = (typeof PROPOSAL_FIELD_CODES)[number];

/** True when a review refusal code is one of the field codes. */
export function isProposalFieldCode(code: string): code is ProposalFieldCode {
  return (PROPOSAL_FIELD_CODES as readonly string[]).includes(code);
}

/** True for "title" and "bodyMarkdown". */
export function isProposalField(field: unknown): field is ProposalField {
  return field === "title" || field === "bodyMarkdown";
}

/** The field a field code belongs to when the refusal names none. */
const DEFAULT_FIELD: Record<ProposalFieldCode, ProposalField> = {
  CITATION_MARKER: "bodyMarkdown",
  TICKET_LINK: "bodyMarkdown",
  TITLE_TOO_SHORT: "title",
  TITLE_TOO_LONG: "title",
  BODY_REQUIRED: "bodyMarkdown",
};

/** The actions whose outcome a proposal UI shows (amendment A4). */
export const PROPOSAL_ACTIONS = [
  "start",
  "save",
  "publish",
  "reject",
  "restart",
  "retryIndexing",
] as const;

export type ProposalAction = (typeof PROPOSAL_ACTIONS)[number];

const REQUEST_REFUSAL_ROWS: Record<RequestRefusalCode, string> = {
  AI_OFF: START_ERROR_AI_OFF,
  COUNT: START_ERROR_COUNT,
  NOT_ALLOWED: START_ERROR_NOT_ALLOWED,
  MEMBERSHIP_ENDED: START_ERROR_MEMBERSHIP_ENDED,
  SELECTION: withPrefix(SELECTION_REFUSED_INTRO),
};

/** The Start dialog callout for a refused request (UI-SPEC 1b). */
export function requestRefusalCopy(code: RequestRefusalCode): string {
  return REQUEST_REFUSAL_ROWS[code];
}

const TICKET_REFUSAL_ROWS: Record<Exclude<TicketRefusalReason, "MERGED">, string> = {
  NOT_RESOLVED: TICKET_REFUSAL_NOT_RESOLVED,
  NOT_FOUND: TICKET_REFUSAL_NOT_FOUND,
  DUPLICATE: TICKET_REFUSAL_DUPLICATE,
};

/**
 * The per-ticket reason line under a failing ticket of a SELECTION refusal (D-07). MERGED names
 * its target; without a target number it falls back to the "Entry unavailable: merged" row.
 */
export function ticketRefusalCopy(reason: TicketRefusalReason, mergedIntoNumber?: number): string {
  if (reason === "MERGED") {
    return mergedIntoNumber === undefined
      ? ENTRY_UNAVAILABLE_MERGED
      : ticketRefusalMerged(mergedIntoNumber);
  }
  return TICKET_REFUSAL_ROWS[reason];
}

const FIELD_REFUSAL_ROWS: Record<ProposalField, Record<ProposalFieldCode, string>> = {
  title: {
    CITATION_MARKER: TITLE_CITATION_MARKER_ERROR,
    // Run decisions K51 and K52: a ticket link in the title is a source reference, and the
    // UI-SPEC has no separate row for it, so the title marker row is reused (review R2-2).
    TICKET_LINK: TITLE_CITATION_MARKER_ERROR,
    TITLE_TOO_SHORT: TITLE_TOO_SHORT_ERROR,
    TITLE_TOO_LONG: TITLE_TOO_LONG_ERROR,
    BODY_REQUIRED: BODY_REQUIRED_ERROR,
  },
  bodyMarkdown: {
    CITATION_MARKER: CITATION_MARKER_ERROR,
    TICKET_LINK: TICKET_LINK_ERROR,
    TITLE_TOO_SHORT: TITLE_TOO_SHORT_ERROR,
    TITLE_TOO_LONG: TITLE_TOO_LONG_ERROR,
    BODY_REQUIRED: BODY_REQUIRED_ERROR,
  },
};

/** The message of a field refusal, by field and code (amendment A2, reviews C7 and R2-2). */
export function fieldRefusalCopy(field: ProposalField, code: ProposalFieldCode): string {
  return FIELD_REFUSAL_ROWS[field][code];
}

type NonFieldReviewCode = Exclude<ReviewRefusalCode, ProposalFieldCode>;

function reviewRefusalCopy(
  rows: Record<NonFieldReviewCode, string>,
  code: ReviewRefusalCode,
  field?: ProposalField,
): string {
  if (isProposalFieldCode(code)) return fieldRefusalCopy(field ?? DEFAULT_FIELD[code], code);
  return rows[code];
}

const SAVE_REFUSAL_ROWS: Record<NonFieldReviewCode, string> = {
  NOT_ALLOWED: SAVE_ERROR_NOT_ALLOWED,
  MEMBERSHIP_ENDED,
  NOT_FOUND: withPrefix(NOT_FOUND_BODY),
  NOT_DRAFT: SAVE_ERROR_NOT_DRAFT,
  CONFLICT,
};

/** The message of a refused save; a field code gives its field row (UI-SPEC 3c, 3h). */
export function saveRefusalCopy(code: ReviewRefusalCode, field?: ProposalField): string {
  return reviewRefusalCopy(SAVE_REFUSAL_ROWS, code, field);
}

const PUBLISH_REFUSAL_ROWS: Record<NonFieldReviewCode, string> = {
  NOT_ALLOWED: withPrefix(PUBLISH_ERROR_NOT_ALLOWED),
  MEMBERSHIP_ENDED,
  NOT_FOUND: withPrefix(NOT_FOUND_BODY),
  NOT_DRAFT: withPrefix(PUBLISH_ERROR_NOT_DRAFT),
  CONFLICT,
};

/** The Publish dialog callout for a refused publish, prefix included (UI-SPEC 3f). */
export function publishRefusalCopy(code: ReviewRefusalCode, field?: ProposalField): string {
  return reviewRefusalCopy(PUBLISH_REFUSAL_ROWS, code, field);
}

const REJECT_REFUSAL_ROWS: Record<NonFieldReviewCode, string> = {
  NOT_ALLOWED: withPrefix(REJECT_ERROR_NOT_ALLOWED),
  MEMBERSHIP_ENDED,
  NOT_FOUND: withPrefix(NOT_FOUND_BODY),
  NOT_DRAFT: withPrefix(REJECT_ERROR_NOT_DRAFT),
  CONFLICT,
};

/** The Reject dialog callout for a refused reject, prefix included (UI-SPEC 3g). */
export function rejectRefusalCopy(code: ReviewRefusalCode, field?: ProposalField): string {
  return reviewRefusalCopy(REJECT_REFUSAL_ROWS, code, field);
}

const MAINTENANCE_REFUSAL_ROWS: Record<MaintenanceRefusalCode, string> = {
  NOT_ALLOWED: RESTART_RETRY_ERROR,
  MEMBERSHIP_ENDED,
  NOT_FOUND: RESTART_RETRY_ERROR,
  NOT_STUCK: RESTART_RETRY_ERROR,
  NOT_RETRYABLE: RESTART_RETRY_ERROR,
  CONFLICT: RESTART_RETRY_ERROR,
};

/** The line under "Restart generation" or "Retry indexing" for a refusal (UI-SPEC 3i). */
export function maintenanceRefusalCopy(code: MaintenanceRefusalCode): string {
  return MAINTENANCE_REFUSAL_ROWS[code];
}

const FAILURE_FULL_ROWS: Record<ProposalFailureCode, string> = {
  AI_OFF: FAILURE_AI_OFF,
  SOURCE_CHANGED: FAILURE_SOURCE_CHANGED,
  PROVIDER: FAILURE_PROVIDER,
  INVALID_OUTPUT: FAILURE_INVALID_OUTPUT,
  CONFIGURATION: FAILURE_CONFIGURATION,
  REQUESTER_NOT_ALLOWED: FAILURE_UNKNOWN,
  UNKNOWN: FAILURE_UNKNOWN,
};

/** The destructive callout of a FAILED proposal (terminal state, no prefix; UI-SPEC 3e). */
export function failureFullCopy(code: ProposalFailureCode): string {
  return FAILURE_FULL_ROWS[code];
}

const FAILURE_SHORT_ROWS: Record<ProposalFailureCode, string> = {
  AI_OFF: FAILURE_SHORT_AI_OFF,
  SOURCE_CHANGED: FAILURE_SHORT_SOURCE_CHANGED,
  PROVIDER: FAILURE_SHORT_PROVIDER,
  INVALID_OUTPUT: FAILURE_SHORT_INVALID_OUTPUT,
  CONFIGURATION: FAILURE_SHORT_CONFIGURATION,
  REQUESTER_NOT_ALLOWED: FAILURE_SHORT_UNKNOWN,
  UNKNOWN: FAILURE_SHORT_UNKNOWN,
};

/** The short reason of a FAILED row in the proposal list (UI-SPEC 2). */
export function failureShortCopy(code: ProposalFailureCode): string {
  return FAILURE_SHORT_ROWS[code];
}

const OUTCOME_UNKNOWN_ROWS: Record<ProposalAction, string> = {
  start: START_OUTCOME_UNKNOWN,
  save: SAVE_OUTCOME_UNKNOWN,
  publish: PUBLISH_OUTCOME_UNKNOWN,
  reject: REJECT_OUTCOME_UNKNOWN,
  restart: RESTART_OUTCOME_UNKNOWN,
  retryIndexing: RETRY_INDEXING_OUTCOME_UNKNOWN,
};

/** The "… outcome unknown" row of an action: a rejected call or an UNKNOWN result (A4). */
export function outcomeUnknownCopy(action: ProposalAction): string {
  return OUTCOME_UNKNOWN_ROWS[action];
}
