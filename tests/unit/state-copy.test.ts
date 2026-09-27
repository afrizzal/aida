// Copy table for Phase 12.1 (UI-SPEC Copywriting Contract, Surfaces 1 to 6): one expectation per
// row, each checked against the row text verbatim. Feed rows (Surface 7) live in activity-copy.ts.
import { describe, expect, it } from "vitest";
import { STATE_COLOR_KEYS, STATE_COLORS } from "../../src/lib/tickets/state-colors";
import * as copy from "../../src/lib/tickets/state-copy";

describe("state-copy: groups", () => {
  it("lists the four groups in order with their labels and descriptions", () => {
    expect([...copy.STATE_GROUP_KEYS]).toEqual(["OPEN", "PENDING", "RESOLVED", "CLOSED"]);
    expect(copy.GROUP_LABELS).toEqual({
      OPEN: "Open",
      PENDING: "Pending",
      RESOLVED: "Resolved",
      CLOSED: "Closed",
    });
    expect(copy.GROUP_DESCRIPTIONS.OPEN).toBe("Your team still has work to do. SLA timers run.");
    expect(copy.GROUP_DESCRIPTIONS.PENDING).toBe(
      "Waiting on the customer or someone else. SLA timers pause while a ticket is in one of these statuses.",
    );
    expect(copy.GROUP_DESCRIPTIONS.RESOLVED).toBe(
      "Solved. SLA timers stop. If auto-close is on, these tickets close after the set number of days. A customer reply reopens the ticket.",
    );
    expect(copy.GROUP_DESCRIPTIONS.CLOSED).toBe(
      "Finished. SLA timers stop. A customer reply reopens the ticket.",
    );
  });
});

describe("state-copy: Surface 1 settings page", () => {
  it("page, nav and access rows", () => {
    expect(copy.CREATE_STATUS_CTA).toBe("Create status");
    expect(copy.SAVE_CHANGES_CTA).toBe("Save changes");
    expect(copy.SETTINGS_NAV_LABEL).toBe("Statuses");
    expect(copy.STATUS_PAGE_TITLE).toBe("Ticket statuses");
    expect(copy.STATUS_PAGE_DESCRIPTION).toBe(
      "Each status belongs to one of four groups. The group decides how a ticket behaves; the name and color are for your team. Customers only ever see the group: Open, Pending, Resolved or Closed.",
    );
    expect(copy.MEMBERS_NOTE).toBe("Only workspace owners and admins can change statuses.");
    expect(copy.MEMBERSHIP_ENDED).toBe(
      "Your access to this workspace has ended. Sign out, then sign in again.",
    );
  });

  it("row rows", () => {
    expect(copy.ADD_STATUS_BUTTON).toBe("Add status");
    expect(copy.addStatusAriaLabel("Pending")).toBe("Add a Pending status");
    expect(copy.DEFAULT_BADGE).toBe("Default for new tickets");
    expect(copy.ticketCountLabel(0)).toBe("No tickets");
    expect(copy.ticketCountLabel(1)).toBe("1 ticket");
    expect(copy.ticketCountLabel(7)).toBe("7 tickets");
    expect(copy.moveUpAriaLabel("Waiting")).toBe('Move "Waiting" up');
    expect(copy.moveDownAriaLabel("Waiting")).toBe('Move "Waiting" down');
    expect(copy.rowOptionsAriaLabel("Waiting")).toBe('Options for "Waiting"');
    expect(copy.ROW_MENU_EDIT).toBe("Edit name and color…");
    expect(copy.ROW_MENU_SET_DEFAULT).toBe("Use for new tickets");
    expect(copy.ROW_MENU_DELETE).toBe("Delete status…");
    expect(copy.DEFAULT_UNAVAILABLE_ALREADY_DEFAULT).toBe(
      "New tickets already start in this status.",
    );
    expect(copy.DEFAULT_UNAVAILABLE_NOT_OPEN).toBe(
      "Only Open statuses can be used for new tickets.",
    );
    expect(copy.deleteUnavailableLastInGroup("Closed")).toBe(
      "The Closed group needs at least one status.",
    );
    expect(copy.DELETE_UNAVAILABLE_NO_REPLACEMENT).toBe(
      "Tickets use this status and there is no other Pending status to move them to. Add one first, or change those tickets' status.",
    );
    expect(copy.GROUP_EMPTY_PENDING).toBe(
      "No Pending statuses. Add one to pause SLA timers while you wait on someone else.",
    );
    expect(copy.PAGE_EMPTY_HEADING).toBe("This workspace has no statuses");
    expect(copy.PAGE_EMPTY_BODY).toBe(
      "Every workspace should have its default statuses. Refresh the page. If this message stays, check the server logs.",
    );
  });

  it("add and edit dialog rows", () => {
    expect(copy.addStatusTitle("Pending")).toBe("Add a Pending status");
    expect(copy.EDIT_STATUS_TITLE).toBe("Edit status");
    expect(copy.GROUP_FIXED_ADD).toBe("The group can't be changed later.");
    expect(copy.groupFixedEdit("Resolved")).toBe(
      "In the Resolved group. The group can't be changed.",
    );
    expect(copy.NAME_LABEL).toBe("Name");
    expect(copy.nameHelp("Open")).toBe(
      'Up to 40 characters. Customers never see this name; they see "Open".',
    );
    expect(copy.COLOR_LEGEND).toBe("Color");
    expect(STATE_COLOR_KEYS.map((k) => STATE_COLORS[k].displayName)).toEqual([
      "Indigo, filled",
      "Indigo",
      "Blue",
      "Teal",
      "Green",
      "Amber",
      "Orange",
      "Red",
      "Pink",
      "Purple",
      "Gray",
    ]);
    expect(copy.PREVIEW_TEAM_LABEL).toBe("Your team sees");
    expect(copy.PREVIEW_CUSTOMER_LABEL).toBe("Customers see");
    expect(copy.PREVIEW_PLACEHOLDER_NAME).toBe("Status name");
    expect(copy.FORM_CLOSE).toBe("Close");
    expect(copy.FORM_PENDING_CREATE).toBe("Creating…");
    expect(copy.FORM_PENDING_SAVE).toBe("Saving…");
    expect(copy.createdToast("Waiting")).toBe('Status "Waiting" added.');
    expect(copy.savedToast("Waiting")).toBe('Status "Waiting" saved.');
  });

  it("status form error and outcome rows", () => {
    expect(copy.STATUS_FORM_ERROR_NAME).toBe("Enter a name from 1 to 40 characters.");
    expect(copy.statusFormErrorDuplicate("Waiting")).toBe(
      'A status named "Waiting" already exists. Choose another name.',
    );
    expect(copy.STATUS_FORM_ERROR_INVALID_COLOR).toBe("Pick one of the colors shown.");
    expect(copy.STATUS_FORM_ERROR_DELETED).toBe(
      "This status was deleted. Close this dialog to see the current list.",
    );
    expect(copy.STATUS_FORM_ERROR_NOT_ALLOWED).toBe(
      "Only workspace owners and admins can change statuses.",
    );
    expect(copy.STATUS_FORM_ERROR_MEMBERSHIP_ENDED).toBe(
      "Your access to this workspace has ended. Sign out, then sign in again.",
    );
    expect(copy.STATUS_FORM_ERROR_UNKNOWN).toBe(
      "The status could not be saved. Wait a moment and try again.",
    );
    expect(copy.CREATE_OUTCOME_UNKNOWN).toBe(
      "The result is not known. The status may have been added. Refresh the page to check before you try again.",
    );
    expect(copy.EDIT_OUTCOME_UNKNOWN).toBe(
      "The result is not known. The change may have been saved. Refresh the page to check before you try again.",
    );
  });

  it("delete dialog rows", () => {
    expect(copy.deleteTitle("Waiting")).toBe('Delete "Waiting"?');
    expect(copy.DELETE_UNUSED_DESCRIPTION).toBe(
      "No tickets use this status. This can't be undone.",
    );
    expect(copy.deleteInUseDescription(3)).toBe(
      "3 tickets use this status now. Every ticket in it moves to the status you pick, and then the status is deleted.",
    );
    expect(copy.deleteInUseDescription(1)).toBe(
      "1 ticket uses this status now. Every ticket in it moves to the status you pick, and then the status is deleted.",
    );
    expect(copy.deleteRolesOnlyDescription("Closed")).toBe(
      "No tickets use this status, but AIDA still uses it in the cases below. Pick another Closed status to take them over, and then the status is deleted.",
    );
    expect(copy.ROLES_INTRO).toBe(
      "AIDA also uses this status in these cases. The status you pick takes them over:",
    );
    expect(copy.ROLE_NAMES).toEqual({
      newStateId: "new tickets start here",
      reopenStateId: "a customer reply reopens a ticket here",
      resolveStateId: "tickets are resolved here",
      autoCloseStateId: "auto-close closes tickets here",
      mergeCloseStateId: "merged tickets are closed here",
    });
    expect(copy.REPLACEMENT_LABEL).toBe("Move its tickets to");
    expect(copy.replacementPlaceholder("Pending")).toBe("Pick a Pending status");
    expect(copy.REPLACEMENT_NOT_CHOSEN).toBe("the status you pick");
    expect(copy.deleteConsequences("A", "B", "Open")).toEqual([
      'Every ticket in "A" moves to "B".',
      "Their SLA timers, resolved time and flags don't change, because both statuses are in the Open group.",
      "Each move is recorded in the ticket's activity.",
      'Saved views that filter on "A" will show it as a status that no longer exists.',
    ]);
    expect(copy.deleteConsequencesRolesOnly("A", "B")).toEqual([
      'AIDA uses "B" in the cases listed above instead of "A".',
      'No ticket changes, because no ticket uses "A".',
      'Saved views that filter on "A" will show it as a status that no longer exists.',
    ]);
    expect(copy.DELETE_CANNOT_BE_UNDONE).toBe("Deleting a status can't be undone.");
    expect(copy.KEEP_STATUS).toBe("Keep status");
    expect(copy.DELETE_STATUS_BUTTON).toBe("Delete status");
    expect(copy.MOVE_AND_DELETE_BUTTON).toBe("Move tickets and delete");
    expect(copy.REPLACE_AND_DELETE_BUTTON).toBe("Replace and delete");
    expect(copy.DELETING).toBe("Deleting…");
    expect(copy.deletedToast("A")).toBe('Status "A" deleted.');
    expect(copy.deletedAndMovedToast("A", 4, "B")).toBe(
      'Status "A" deleted. 4 tickets moved to "B".',
    );
    expect(copy.deletedAndMovedToast("A", 1, "B")).toBe(
      'Status "A" deleted. 1 ticket moved to "B".',
    );
    expect(copy.deletedAndReplacedToast("A", "B")).toBe(
      'Status "A" deleted. AIDA now uses "B" in its place.',
    );
  });

  it("delete error rows", () => {
    expect(copy.DELETE_ERROR_PREFIX).toBe("Nothing was changed.");
    expect(copy.deleteErrorLastInGroup("Open")).toBe("The Open group needs at least one status.");
    expect(copy.DELETE_ERROR_REPLACEMENT_REQUIRED).toBe(
      "Tickets or AIDA's settings started using this status after you opened this dialog. Close it and open it again to pick a status to move them to.",
    );
    expect(copy.DELETE_ERROR_REPLACEMENT_INVALID).toBe(
      "The status you picked no longer exists or is in another group. Pick another one.",
    );
    expect(copy.DELETE_ERROR_ALREADY_DELETED).toBe(
      "This status was already deleted. Refresh the page to see the current list.",
    );
    expect(copy.DELETE_ERROR_NOT_ALLOWED).toBe(
      "Only workspace owners and admins can change statuses.",
    );
    expect(copy.DELETE_ERROR_MEMBERSHIP_ENDED).toBe(
      "Your access to this workspace has ended. Sign out, then sign in again.",
    );
    expect(copy.DELETE_ERROR_UNKNOWN).toBe(
      "The status could not be deleted. Wait a moment and try again.",
    );
    expect(copy.DELETE_OUTCOME_UNKNOWN).toBe(
      "The result is not known. The status may have been deleted and its tickets moved. Refresh the page to check before you try again.",
    );
  });

  it("reorder and default rows", () => {
    expect(copy.reorderAnnouncement("Waiting", 2, 3, "Pending")).toBe(
      'Moved "Waiting" to position 2 of 3 in Pending.',
    );
    expect(copy.REORDER_ERROR_DELETED).toBe(
      "Nothing was changed. This status no longer exists. Refresh the page to see the current list.",
    );
    expect(copy.REORDER_ERROR_NOT_ALLOWED).toBe(
      "Nothing was changed. Only workspace owners and admins can change statuses.",
    );
    expect(copy.REORDER_ERROR_MEMBERSHIP_ENDED).toBe(
      "Nothing was changed. Your access to this workspace has ended. Sign out, then sign in again.",
    );
    expect(copy.REORDER_ERROR_UNKNOWN).toBe(
      "Nothing was changed. The order could not be saved. Wait a moment and try again.",
    );
    expect(copy.REORDER_OUTCOME_UNKNOWN).toBe(
      "The result is not known. The order may have changed. Refresh the page to check before you try again.",
    );
    expect(copy.defaultToast("Triage")).toBe('New tickets now start as "Triage".');
    expect(copy.DEFAULT_ERROR_NOT_OPEN).toBe(
      "Nothing was changed. Only Open statuses can be used for new tickets.",
    );
    expect(copy.DEFAULT_ERROR_DELETED).toBe(
      "Nothing was changed. This status no longer exists. Refresh the page to see the current list.",
    );
    expect(copy.DEFAULT_ERROR_NOT_ALLOWED).toBe(
      "Nothing was changed. Only workspace owners and admins can change statuses.",
    );
    expect(copy.DEFAULT_ERROR_MEMBERSHIP_ENDED).toBe(
      "Nothing was changed. Your access to this workspace has ended. Sign out, then sign in again.",
    );
    expect(copy.DEFAULT_ERROR_UNKNOWN).toBe(
      "Nothing was changed. The default could not be saved. Wait a moment and try again.",
    );
    expect(copy.DEFAULT_OUTCOME_UNKNOWN).toBe(
      "The result is not known. The default may have changed. Refresh the page to check before you try again.",
    );
  });
});

describe("state-copy: Surface 3 pickers", () => {
  it("top-bar and bulk rows", () => {
    expect(copy.STATUS_MENU_TRIGGER_LABEL).toBe("Change status");
    expect(copy.MERGED_SOURCE_REASON).toBe("This ticket was already merged.");
    expect(copy.STATUS_REFUSED_MERGED_SOURCE).toBe(
      "Nothing was changed. This ticket was already merged, so its status can't change.",
    );
    expect(copy.STATUS_CHANGE_ERROR_STATE_DELETED).toBe(
      "Nothing was changed. That status no longer exists. Pick another status.",
    );
    expect(copy.STATUS_CHANGE_ERROR_TICKET_UNAVAILABLE).toBe(
      "This ticket is no longer available. Refresh the page.",
    );
    expect(copy.STATUS_CHANGE_ERROR_MEMBERSHIP_ENDED).toBe(
      "Your access to this workspace has ended. Sign out, then sign in again.",
    );
    expect(copy.STATUS_CHANGE_ERROR_UNKNOWN).toBe(
      "Nothing was changed. The status could not be saved. Wait a moment and try again.",
    );
    expect(copy.STATUS_CHANGE_OUTCOME_UNKNOWN).toBe(
      "The result is not known. The status may have changed. Refresh the page to check before you try again.",
    );
    expect(copy.BULK_PICKER_SEARCH_PLACEHOLDER).toBe("Find a status…");
    expect(copy.bulkPickerNoMatch("wait")).toBe('No status matches "wait".');
    expect(copy.BULK_ERROR_STATE_DELETED).toBe(
      "That status no longer exists. Pick another status.",
    );
    expect(copy.BULK_STATUS_REFUSED_MERGED_SOURCE).toBe(
      "One of the selected tickets was already merged into another ticket, so its status can't change. Unselect it and try again.",
    );
  });
});

describe("state-copy: Surface 4 filter and saved views", () => {
  it("filter and notice rows", () => {
    expect(copy.MISSING_GROUP_LABEL).toBe("No longer exists");
    expect(copy.MISSING_STATUS_ITEM).toBe("A deleted status");
    expect(copy.URL_MISSING_STATUS_NOTICE).toBe(
      "This list filters on a status that no longer exists, so that part of the filter matches no tickets.",
    );
    expect(copy.removeDeletedStatusesLabel(1)).toBe("Remove deleted status");
    expect(copy.removeDeletedStatusesLabel(2)).toBe("Remove deleted statuses");
    expect(copy.SUMMARY_NO_STATUS).toBe("Any status");
    expect(copy.REMOVE_DELETED_STATUSES_ARIA_LABEL).toBe(
      "Remove the deleted statuses from the Status filter",
    );
    expect(copy.SAVED_VIEW_ERROR_MISSING_REFERENCE).toBe(
      "A status, tag or custom field in these filters no longer exists. Remove it from the filters, then save again.",
    );
  });

  it("strip missing sentence for every combination", () => {
    expect(copy.stripMissingSentence({ tag: true })).toBe(
      "This view filters on a tag that no longer exists.",
    );
    expect(copy.stripMissingSentence({ customField: true })).toBe(
      "This view filters on a custom field that no longer exists.",
    );
    expect(copy.stripMissingSentence({ tag: true, customField: true })).toBe(
      "This view filters on a tag and a custom field that no longer exist.",
    );
    expect(copy.stripMissingSentence({ state: true })).toBe(
      "This view filters on a status that no longer exists.",
    );
    expect(copy.stripMissingSentence({ state: true, tag: true })).toBe(
      "This view filters on a status and a tag that no longer exist.",
    );
    expect(copy.stripMissingSentence({ state: true, customField: true })).toBe(
      "This view filters on a status and a custom field that no longer exist.",
    );
    expect(copy.stripMissingSentence({ state: true, tag: true, customField: true })).toBe(
      "This view filters on a status, a tag and a custom field that no longer exist.",
    );
  });
});

describe("state-copy: Surfaces 5 and 6", () => {
  it("paused chip and public labels", () => {
    expect(copy.SLA_PAUSED_CHIP).toBe("SLA paused");
    expect(copy.SLA_PAUSED_OVERDUE_CHIP).toBe("SLA paused, overdue");
    expect(copy.PUBLIC_GROUP_LABELS).toEqual({
      OPEN: "Open",
      PENDING: "Pending",
      RESOLVED: "Resolved",
      CLOSED: "Closed",
    });
    expect(copy.PUBLIC_MERGED_LABEL).toBe("Combined");
  });
});

describe("state-copy: paused chip helpers (Surface 5, D-18)", () => {
  it("pausedChipLabel picks the overdue row only when the breach flag is set", () => {
    expect(copy.pausedChipLabel(false)).toBe("SLA paused");
    expect(copy.pausedChipLabel(true)).toBe("SLA paused, overdue");
  });

  it("slaPausedTitle formats the pause start with the chip's title formatter options", () => {
    const pausedAt = new Date("2026-11-09T08:30:00.000Z");
    const time = pausedAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
    expect(copy.slaPausedTitle(pausedAt)).toBe(
      `SLA timers are paused while this ticket is in a Pending status. Paused since ${time}.`,
    );
    expect(copy.slaPausedTitle(pausedAt.toISOString())).toBe(copy.slaPausedTitle(pausedAt));
    expect(time).toMatch(/^Nov \d+, 2026, \d+:\d{2}\s?[AP]M$/);
  });
});
