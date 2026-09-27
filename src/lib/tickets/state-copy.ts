// Phase 12.1 copy rows (UI-SPEC Copywriting Contract, Surfaces 1 to 6). Each string is one
// exported constant used verbatim, and the copy-table unit test checks each against its row.
// The feed rows (Surface 7) live in activity-copy.ts. Pure and client-safe: server and client
// components import it. Relative imports only.

export {
  BULK_STATUS_REFUSED_MERGED_SOURCE,
  MERGED_SOURCE_REASON,
  STATUS_REFUSED_MERGED_SOURCE,
} from "./lifecycle-copy";

// --- Groups -------------------------------------------------------------------------------------

/** The four state groups in display order; structurally equal to Prisma's TicketStateGroup. */
export const STATE_GROUP_KEYS = ["OPEN", "PENDING", "RESOLVED", "CLOSED"] as const;

export type StateGroupKey = (typeof STATE_GROUP_KEYS)[number];

/** Copywriting "Group labels". */
export const GROUP_LABELS: Record<StateGroupKey, string> = {
  OPEN: "Open",
  PENDING: "Pending",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};

/** Copywriting "Group description: Open / Pending / Resolved / Closed". */
export const GROUP_DESCRIPTIONS: Record<StateGroupKey, string> = {
  OPEN: "Your team still has work to do. SLA timers run.",
  PENDING:
    "Waiting on the customer or someone else. SLA timers pause while a ticket is in one of these statuses.",
  RESOLVED:
    "Solved. SLA timers stop. If auto-close is on, these tickets close after the set number of days. A customer reply reopens the ticket.",
  CLOSED: "Finished. SLA timers stop. A customer reply reopens the ticket.",
};

// --- Surface 1: settings page -------------------------------------------------------------------

/** Copywriting "Primary CTA (add)". */
export const CREATE_STATUS_CTA = "Create status";

/** Copywriting "Primary CTA (edit)". */
export const SAVE_CHANGES_CTA = "Save changes";

/** Copywriting "Settings nav item". */
export const SETTINGS_NAV_LABEL = "Statuses";

/** Copywriting "Page title". */
export const STATUS_PAGE_TITLE = "Ticket statuses";

/** Copywriting "Page description". */
export const STATUS_PAGE_DESCRIPTION =
  "Each status belongs to one of four groups. The group decides how a ticket behaves; the name and color are for your team. Customers only ever see the group: Open, Pending, Resolved or Closed.";

/** Copywriting "Members note". */
export const MEMBERS_NOTE = "Only workspace owners and admins can change statuses.";

/** Copywriting "Membership ended". */
export const MEMBERSHIP_ENDED =
  "Your access to this workspace has ended. Sign out, then sign in again.";

/** Copywriting "Add status button". */
export const ADD_STATUS_BUTTON = "Add status";

/** Copywriting "Add status aria-label": `Add a {Group} status`. */
export function addStatusAriaLabel(group: string): string {
  return `Add a ${group} status`;
}

/** Copywriting "Default badge". */
export const DEFAULT_BADGE = "Default for new tickets";

/** Copywriting "Ticket count": No tickets / 1 ticket / {n} tickets. */
export function ticketCountLabel(n: number): string {
  if (n === 0) return "No tickets";
  return n === 1 ? "1 ticket" : `${n} tickets`;
}

/** Copywriting "Move up (aria-label)". */
export function moveUpAriaLabel(name: string): string {
  return `Move "${name}" up`;
}

/** Copywriting "Move down (aria-label)". */
export function moveDownAriaLabel(name: string): string {
  return `Move "${name}" down`;
}

/** Copywriting "Row options (aria-label)". */
export function rowOptionsAriaLabel(name: string): string {
  return `Options for "${name}"`;
}

/** Copywriting "Row menu items" (first). */
export const ROW_MENU_EDIT = "Edit name and color…";

/** Copywriting "Row menu items" (second). */
export const ROW_MENU_SET_DEFAULT = "Use for new tickets";

/** Copywriting "Row menu items" (third). */
export const ROW_MENU_DELETE = "Delete status…";

/** Copywriting "Default unavailable: already default". */
export const DEFAULT_UNAVAILABLE_ALREADY_DEFAULT = "New tickets already start in this status.";

/** Copywriting "Default unavailable: not Open". */
export const DEFAULT_UNAVAILABLE_NOT_OPEN = "Only Open statuses can be used for new tickets.";

/** Copywriting "Delete unavailable: last in group". */
export function deleteUnavailableLastInGroup(group: string): string {
  return `The ${group} group needs at least one status.`;
}

/** Copywriting "Delete unavailable: no replacement". */
export const DELETE_UNAVAILABLE_NO_REPLACEMENT =
  "Tickets use this status and there is no other Pending status to move them to. Add one first, or change those tickets' status.";

/** Copywriting "Group empty: Pending". */
export const GROUP_EMPTY_PENDING =
  "No Pending statuses. Add one to pause SLA timers while you wait on someone else.";

/** Copywriting "Page empty heading". */
export const PAGE_EMPTY_HEADING = "This workspace has no statuses";

/** Copywriting "Page empty body". */
export const PAGE_EMPTY_BODY =
  "Every workspace should have its default statuses. Refresh the page. If this message stays, check the server logs.";

// --- Surface 1d: add and edit dialog ------------------------------------------------------------

/** Copywriting "Add title": `Add a {Group} status`. */
export function addStatusTitle(group: string): string {
  return `Add a ${group} status`;
}

/** Copywriting "Edit title". */
export const EDIT_STATUS_TITLE = "Edit status";

/** Copywriting "Group fixed (add)". */
export const GROUP_FIXED_ADD = "The group can't be changed later.";

/** Copywriting "Group fixed (edit)". */
export function groupFixedEdit(group: string): string {
  return `In the ${group} group. The group can't be changed.`;
}

/** Copywriting "Name label". */
export const NAME_LABEL = "Name";

/** Copywriting "Name help". */
export function nameHelp(group: string): string {
  return `Up to 40 characters. Customers never see this name; they see "${group}".`;
}

/** Copywriting "Color legend" (option names are the displayName of state-colors.ts). */
export const COLOR_LEGEND = "Color";

/** Copywriting "Preview labels" (first). */
export const PREVIEW_TEAM_LABEL = "Your team sees";

/** Copywriting "Preview labels" (second). */
export const PREVIEW_CUSTOMER_LABEL = "Customers see";

/** Copywriting "Preview placeholder name". */
export const PREVIEW_PLACEHOLDER_NAME = "Status name";

/** Copywriting "Form dismiss". */
export const FORM_CLOSE = "Close";

/** Copywriting "Form pending" (add). */
export const FORM_PENDING_CREATE = "Creating…";

/** Copywriting "Form pending" (edit). */
export const FORM_PENDING_SAVE = "Saving…";

/** Copywriting "Created toast". */
export function createdToast(name: string): string {
  return `Status "${name}" added.`;
}

/** Copywriting "Saved toast". */
export function savedToast(name: string): string {
  return `Status "${name}" saved.`;
}

/** Copywriting "Status form error: name empty or too long (field)". */
export const STATUS_FORM_ERROR_NAME = "Enter a name from 1 to 40 characters.";

/** Copywriting "Status form error: duplicate name (field)". */
export function statusFormErrorDuplicate(name: string): string {
  return `A status named "${name}" already exists. Choose another name.`;
}

/** Copywriting "Status form error: invalid color". */
export const STATUS_FORM_ERROR_INVALID_COLOR = "Pick one of the colors shown.";

/** Copywriting "Status form error: deleted (edit)". */
export const STATUS_FORM_ERROR_DELETED =
  "This status was deleted. Close this dialog to see the current list.";

/** Copywriting "Status form error: not allowed". */
export const STATUS_FORM_ERROR_NOT_ALLOWED =
  "Only workspace owners and admins can change statuses.";

/** Copywriting "Status form error: membership ended". */
export const STATUS_FORM_ERROR_MEMBERSHIP_ENDED =
  "Your access to this workspace has ended. Sign out, then sign in again.";

/** Copywriting "Status form error: unknown". */
export const STATUS_FORM_ERROR_UNKNOWN =
  "The status could not be saved. Wait a moment and try again.";

/** Copywriting "Create outcome unknown". */
export const CREATE_OUTCOME_UNKNOWN =
  "The result is not known. The status may have been added. Refresh the page to check before you try again.";

/** Copywriting "Edit outcome unknown". */
export const EDIT_OUTCOME_UNKNOWN =
  "The result is not known. The change may have been saved. Refresh the page to check before you try again.";

// --- Surface 1e: delete dialog ------------------------------------------------------------------

/** Copywriting "Delete title". */
export function deleteTitle(name: string): string {
  return `Delete "${name}"?`;
}

/** Copywriting "Delete unused description". */
export const DELETE_UNUSED_DESCRIPTION = "No tickets use this status. This can't be undone.";

/**
 * Copywriting "Delete in-use description" with the "1 ticket" / "{n} tickets" count rule; the verb
 * agrees with the count ("1 ticket uses", "{n} tickets use").
 */
export function deleteInUseDescription(n: number): string {
  const subject = n === 1 ? "1 ticket uses" : `${n} tickets use`;
  return `${subject} this status now. Every ticket in it moves to the status you pick, and then the status is deleted.`;
}

/** Copywriting "Delete roles-only description". */
export function deleteRolesOnlyDescription(group: string): string {
  return `No tickets use this status, but AIDA still uses it in the cases below. Pick another ${group} status to take them over, and then the status is deleted.`;
}

/** Copywriting "Roles intro". */
export const ROLES_INTRO =
  "AIDA also uses this status in these cases. The status you pick takes them over:";

/**
 * Copywriting "Role names", keyed by the TicketStateConfig role column. `resolveStateId` keeps the
 * generic UI-SPEC wording (Assumption 12: no reader of that role exists after D-11).
 */
export const ROLE_NAMES = {
  newStateId: "new tickets start here",
  reopenStateId: "a customer reply reopens a ticket here",
  resolveStateId: "tickets are resolved here",
  autoCloseStateId: "auto-close closes tickets here",
  mergeCloseStateId: "merged tickets are closed here",
} as const;

export type StateRoleKey = keyof typeof ROLE_NAMES;

/** Copywriting "Replacement label". */
export const REPLACEMENT_LABEL = "Move its tickets to";

/** Copywriting "Replacement placeholder". */
export function replacementPlaceholder(group: string): string {
  return `Pick a ${group} status`;
}

/** Copywriting "Replacement not chosen (fills {replacement})". */
export const REPLACEMENT_NOT_CHOSEN = "the status you pick";

/** Copywriting "Delete consequences" (four rows). */
export function deleteConsequences(name: string, replacement: string, group: string): string[] {
  return [
    `Every ticket in "${name}" moves to "${replacement}".`,
    `Their SLA timers, resolved time and flags don't change, because both statuses are in the ${group} group.`,
    "Each move is recorded in the ticket's activity.",
    `Saved views that filter on "${name}" will show it as a status that no longer exists.`,
  ];
}

/** Copywriting "Delete consequences (roles only)" (three rows). */
export function deleteConsequencesRolesOnly(name: string, replacement: string): string[] {
  return [
    `AIDA uses "${replacement}" in the cases listed above instead of "${name}".`,
    `No ticket changes, because no ticket uses "${name}".`,
    `Saved views that filter on "${name}" will show it as a status that no longer exists.`,
  ];
}

/** Copywriting "Delete cannot be undone". */
export const DELETE_CANNOT_BE_UNDONE = "Deleting a status can't be undone.";

/** Copywriting "Destructive confirmation: Delete status" (dismiss button). */
export const KEEP_STATUS = "Keep status";

/** Copywriting "Destructive confirmation: Delete status" (case A). */
export const DELETE_STATUS_BUTTON = "Delete status";

/** Copywriting "Destructive confirmation: Delete status" (case B). */
export const MOVE_AND_DELETE_BUTTON = "Move tickets and delete";

/** Copywriting "Destructive button (roles only)" (case C). */
export const REPLACE_AND_DELETE_BUTTON = "Replace and delete";

/** Copywriting "Destructive confirmation: Delete status" (pending). */
export const DELETING = "Deleting…";

/** Copywriting "Deleted toast". */
export function deletedToast(name: string): string {
  return `Status "${name}" deleted.`;
}

/** Copywriting "Deleted and moved toast" with the "1 ticket" / "{n} tickets" count rule. */
export function deletedAndMovedToast(name: string, n: number, replacement: string): string {
  const count = n === 1 ? "1 ticket" : `${n} tickets`;
  return `Status "${name}" deleted. ${count} moved to "${replacement}".`;
}

/** Copywriting "Deleted and replaced toast". */
export function deletedAndReplacedToast(name: string, replacement: string): string {
  return `Status "${name}" deleted. AIDA now uses "${replacement}" in its place.`;
}

/** Copywriting "Delete error prefix". */
export const DELETE_ERROR_PREFIX = "Nothing was changed.";

/** Copywriting "Delete error: last in group" (after the prefix). */
export function deleteErrorLastInGroup(group: string): string {
  return `The ${group} group needs at least one status.`;
}

/** Copywriting "Delete error: replacement required" (after the prefix). */
export const DELETE_ERROR_REPLACEMENT_REQUIRED =
  "Tickets or AIDA's settings started using this status after you opened this dialog. Close it and open it again to pick a status to move them to.";

/** Copywriting "Delete error: replacement invalid" (after the prefix). */
export const DELETE_ERROR_REPLACEMENT_INVALID =
  "The status you picked no longer exists or is in another group. Pick another one.";

/** Copywriting "Delete error: already deleted (full row, no prefix)". */
export const DELETE_ERROR_ALREADY_DELETED =
  "This status was already deleted. Refresh the page to see the current list.";

/** Copywriting "Delete error: not allowed" (after the prefix). */
export const DELETE_ERROR_NOT_ALLOWED = "Only workspace owners and admins can change statuses.";

/** Copywriting "Delete error: membership ended" (after the prefix). */
export const DELETE_ERROR_MEMBERSHIP_ENDED =
  "Your access to this workspace has ended. Sign out, then sign in again.";

/** Copywriting "Delete error: unknown" (after the prefix). */
export const DELETE_ERROR_UNKNOWN = "The status could not be deleted. Wait a moment and try again.";

/** Copywriting "Delete outcome unknown". */
export const DELETE_OUTCOME_UNKNOWN =
  "The result is not known. The status may have been deleted and its tickets moved. Refresh the page to check before you try again.";

// --- Surface 1f: reorder and set default --------------------------------------------------------

/** Copywriting "Reorder announcement (live region)". */
export function reorderAnnouncement(
  name: string,
  position: number,
  total: number,
  group: string,
): string {
  return `Moved "${name}" to position ${position} of ${total} in ${group}.`;
}

/** Copywriting "Reorder error: deleted". */
export const REORDER_ERROR_DELETED =
  "Nothing was changed. This status no longer exists. Refresh the page to see the current list.";

/** Copywriting "Reorder error: not allowed". */
export const REORDER_ERROR_NOT_ALLOWED =
  "Nothing was changed. Only workspace owners and admins can change statuses.";

/** Copywriting "Reorder error: membership ended". */
export const REORDER_ERROR_MEMBERSHIP_ENDED =
  "Nothing was changed. Your access to this workspace has ended. Sign out, then sign in again.";

/** Copywriting "Reorder error: unknown". */
export const REORDER_ERROR_UNKNOWN =
  "Nothing was changed. The order could not be saved. Wait a moment and try again.";

/** Copywriting "Reorder outcome unknown". */
export const REORDER_OUTCOME_UNKNOWN =
  "The result is not known. The order may have changed. Refresh the page to check before you try again.";

/** Copywriting "Default toast". */
export function defaultToast(name: string): string {
  return `New tickets now start as "${name}".`;
}

/** Copywriting "Default error: not Open". */
export const DEFAULT_ERROR_NOT_OPEN =
  "Nothing was changed. Only Open statuses can be used for new tickets.";

/** Copywriting "Default error: deleted". */
export const DEFAULT_ERROR_DELETED =
  "Nothing was changed. This status no longer exists. Refresh the page to see the current list.";

/** Copywriting "Default error: not allowed". */
export const DEFAULT_ERROR_NOT_ALLOWED =
  "Nothing was changed. Only workspace owners and admins can change statuses.";

/** Copywriting "Default error: membership ended". */
export const DEFAULT_ERROR_MEMBERSHIP_ENDED =
  "Nothing was changed. Your access to this workspace has ended. Sign out, then sign in again.";

/** Copywriting "Default error: unknown". */
export const DEFAULT_ERROR_UNKNOWN =
  "Nothing was changed. The default could not be saved. Wait a moment and try again.";

/** Copywriting "Default outcome unknown". */
export const DEFAULT_OUTCOME_UNKNOWN =
  "The result is not known. The default may have changed. Refresh the page to check before you try again.";

// --- Surface 3: pickers -------------------------------------------------------------------------

/** Copywriting "Status menu trigger (aria-label, unchanged)". */
export const STATUS_MENU_TRIGGER_LABEL = "Change status";

/** Copywriting "Status change error: state deleted". */
export const STATUS_CHANGE_ERROR_STATE_DELETED =
  "Nothing was changed. That status no longer exists. Pick another status.";

/** Copywriting "Status change error: ticket unavailable". */
export const STATUS_CHANGE_ERROR_TICKET_UNAVAILABLE =
  "This ticket is no longer available. Refresh the page.";

/** Copywriting "Status change error: membership ended". */
export const STATUS_CHANGE_ERROR_MEMBERSHIP_ENDED =
  "Your access to this workspace has ended. Sign out, then sign in again.";

/** Copywriting "Status change error: unknown". */
export const STATUS_CHANGE_ERROR_UNKNOWN =
  "Nothing was changed. The status could not be saved. Wait a moment and try again.";

/** Copywriting "Status change outcome unknown". */
export const STATUS_CHANGE_OUTCOME_UNKNOWN =
  "The result is not known. The status may have changed. Refresh the page to check before you try again.";

/** Copywriting "Bulk picker search placeholder". */
export const BULK_PICKER_SEARCH_PLACEHOLDER = "Find a status…";

/** Copywriting "Bulk picker no match". */
export function bulkPickerNoMatch(query: string): string {
  return `No status matches "${query}".`;
}

/** Copywriting "Bulk error: state deleted (after 'Nothing was changed.')". */
export const BULK_ERROR_STATE_DELETED = "That status no longer exists. Pick another status.";

// --- Surface 4: filter, saved views and missing references --------------------------------------

/** Copywriting "Missing group label (filter menu)". */
export const MISSING_GROUP_LABEL = "No longer exists";

/** Copywriting "Missing status item (filter menu)". */
export const MISSING_STATUS_ITEM = "A deleted status";

/** Copywriting "URL missing status notice". */
export const URL_MISSING_STATUS_NOTICE =
  "This list filters on a status that no longer exists, so that part of the filter matches no tickets.";

/** Copywriting "Remove deleted statuses (button)": one missing id or more than one. */
export function removeDeletedStatusesLabel(count: number): string {
  return count === 1 ? "Remove deleted status" : "Remove deleted statuses";
}

/**
 * Copywriting "Strip missing sentence": the missing kinds in the order a status, a tag, a custom
 * field, joined with ", " and a final " and "; "exists" for one kind, "exist" for more. The three
 * pre-12.1 outputs (tag, custom field, tag and custom field) are byte-identical.
 */
export function stripMissingSentence(missing: {
  state?: boolean;
  tag?: boolean;
  customField?: boolean;
}): string {
  const kinds: string[] = [];
  if (missing.state) kinds.push("a status");
  if (missing.tag) kinds.push("a tag");
  if (missing.customField) kinds.push("a custom field");
  const list =
    kinds.length <= 1 ? (kinds[0] ?? "") : `${kinds.slice(0, -1).join(", ")} and ${kinds.at(-1)}`;
  const verb = kinds.length === 1 ? "exists" : "exist";
  return `This view filters on ${list} that no longer ${verb}.`;
}

/** Copywriting "Summary: no status". */
export const SUMMARY_NO_STATUS = "Any status";

/** Copywriting "Remove deleted statuses (aria-label)". */
export const REMOVE_DELETED_STATUSES_ARIA_LABEL =
  "Remove the deleted statuses from the Status filter";

/** Copywriting "Saved view error: missing reference (replaces the existing row)". */
export const SAVED_VIEW_ERROR_MISSING_REFERENCE =
  "A status, tag or custom field in these filters no longer exists. Remove it from the filters, then save again.";

// --- Surface 5: SLA paused chip -----------------------------------------------------------------

/** Copywriting "SLA paused chip". */
export const SLA_PAUSED_CHIP = "SLA paused";

/** Copywriting "SLA paused chip, overdue". */
export const SLA_PAUSED_OVERDUE_CHIP = "SLA paused, overdue";

/** The paused chip text: overdue when the breach flag was set before the pause (Assumption 8). */
export function pausedChipLabel(isBreached: boolean): string {
  return isBreached ? SLA_PAUSED_OVERDUE_CHIP : SLA_PAUSED_CHIP;
}

/**
 * Copywriting "SLA paused title", the pause start formatted with the chip's existing title
 * formatter options (explicit en-US so server and client render the same text).
 */
export function slaPausedTitle(pausedAt: Date | string): string {
  const time = new Date(pausedAt).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return `SLA timers are paused while this ticket is in a Pending status. Paused since ${time}.`;
}

// --- Surface 6: public status page --------------------------------------------------------------

/** Copywriting "Public group labels": the only status text a customer sees (D-13). */
export const PUBLIC_GROUP_LABELS: Record<StateGroupKey, string> = GROUP_LABELS;

/** Copywriting "Public merged label (unchanged)". */
export const PUBLIC_MERGED_LABEL = "Combined";
