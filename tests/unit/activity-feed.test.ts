import { describe, expect, it } from "vitest";
import { TicketAuditAction } from "../../src/generated/prisma/enums";
import {
  ACTIVITY_COPY,
  ACTOR_FORMER_MEMBER_MID_SENTENCE,
  type ActivityContext,
  type ActivityEventInput,
  DELETED_STATUS_MARKER,
  DELETED_STATUS_NO_NAME,
  describeEvent,
  MISSING_VALUE,
  partsToText,
} from "../../src/lib/tickets/activity-copy";
import { buildActivityFeed, referencedIds } from "../../src/lib/tickets/activity-feed";
import {
  BULK_STATUS_REFUSED_MERGED_SOURCE,
  LINK_REMOVE_OUTCOME_UNKNOWN,
  MERGE_CONFIRM_DESCRIPTION,
  MERGE_ERROR_LINK_CHANGED,
  MERGED_BANNER_DATE_UNKNOWN,
  MERGED_COMPOSER_TARGET_UNAVAILABLE,
  MERGED_SOURCE_REASON,
  mergeRecheckFailedText,
  mergeReplacesLinkText,
  PICKER_REASON_MERGED,
  STATUS_REFUSED_MERGED_SOURCE,
} from "../../src/lib/tickets/lifecycle-copy";

const THIS = "t-this";
const OTHER = "t-other";
const context: ActivityContext = {
  ticketId: THIS,
  tickets: { [THIS]: { id: THIS, number: 10 }, [OTHER]: { id: OTHER, number: 42 } },
  tags: { "tag-1": "billing" },
  members: { "u-ann": "Ann", "u-bo": "Bo" },
  states: {
    "s-triage": { name: "Triage", deleted: false },
    "s-vendor": { name: "Waiting on vendor", deleted: true },
    "s-done": { name: "Done", deleted: false },
  },
};

function event(partial: Partial<ActivityEventInput>): ActivityEventInput {
  return {
    action: "STATUS_CHANGED",
    actorType: "USER",
    actorUserId: "u-ann",
    batchId: null,
    before: {},
    after: {},
    ...partial,
  };
}

function say(partial: Partial<ActivityEventInput>): string {
  return partsToText(describeEvent(event(partial), context).parts);
}

describe("activity copy (UI-SPEC Copywriting, Feed events)", () => {
  it("has a copy row for every TicketAuditAction value of the generated enum", () => {
    const actions = Object.values(TicketAuditAction);
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) expect(Object.hasOwn(ACTIVITY_COPY, action)).toBe(true);
    expect(Object.keys(ACTIVITY_COPY).sort()).toEqual([...actions].sort());
  });

  it("renders status, priority, assignee and tag rows with header labels", () => {
    expect(say({ before: { status: "OPEN" }, after: { status: "PENDING" } })).toBe(
      "Ann changed the status from Open to Pending.",
    );
    expect(
      say({
        action: "PRIORITY_CHANGED",
        before: { priority: "LOW" },
        after: { priority: "URGENT" },
      }),
    ).toBe("Ann changed the priority from Low to Urgent.");
    expect(say({ action: "ASSIGNEE_CHANGED", after: { assigneeId: "u-bo" } })).toBe(
      "Ann assigned this ticket to Bo.",
    );
    expect(say({ action: "ASSIGNEE_CHANGED", after: { assigneeId: null } })).toBe(
      "Ann removed the assignee.",
    );
    expect(say({ action: "ASSIGNEE_CHANGED", after: { assigneeId: "u-gone" } })).toBe(
      "Ann assigned this ticket to a former member.",
    );
    expect(say({ action: "TAG_ADDED", after: { tagId: "tag-1", present: true } })).toBe(
      "Ann added the tag billing.",
    );
    expect(say({ action: "TAG_REMOVED", before: { tagId: "tag-gone", present: true } })).toBe(
      "Ann removed the tag a deleted tag.",
    );
    expect(say({ action: "AUTO_CLOSED", actorType: "SYSTEM", actorUserId: null })).toBe(
      "Closed automatically by the auto-close setting.",
    );
  });

  it("labels relations from this ticket's side and links the other ticket", () => {
    const child = { type: "CHILD_OF", fromTicketId: THIS, toTicketId: OTHER };
    expect(say({ action: "RELATION_ADDED", after: child })).toBe("Ann added a link: Child of #42.");
    const parent = { type: "CHILD_OF", fromTicketId: OTHER, toTicketId: THIS };
    expect(say({ action: "RELATION_REMOVED", before: parent })).toBe(
      "Ann removed a link: Parent of #42.",
    );
    const gone = { type: "RELATED_TO", fromTicketId: THIS, toTicketId: "t-gone" };
    expect(say({ action: "RELATION_ADDED", after: gone })).toBe(
      "Ann added a link: Related to a ticket that is no longer available.",
    );
    const parts = describeEvent(event({ action: "RELATION_ADDED", after: child }), context).parts;
    expect(parts).toContainEqual({ type: "ticket", id: OTHER, number: 42 });
  });

  it("renders merges both ways, snooze with a time token and both wake rows", () => {
    const merge = { sourceTicketId: THIS, targetTicketId: OTHER };
    expect(say({ action: "MERGED_INTO", after: merge })).toBe("Ann merged this ticket into #42.");
    expect(
      say({ action: "MERGED_FROM", after: { sourceTicketId: OTHER, targetTicketId: THIS } }),
    ).toBe("Ann merged #42 into this ticket.");
    const iso = "2026-11-10T02:00:00.000Z";
    const snoozed = describeEvent(
      event({ action: "SNOOZED", after: { snoozedUntil: iso } }),
      context,
    );
    expect(snoozed.icon).toBe("AlarmClock");
    expect(snoozed.parts).toContainEqual({ type: "time", iso });
    expect(partsToText(snoozed.parts)).toBe(`Ann snoozed this ticket until ${iso}.`);
    expect(say({ action: "WOKEN" })).toBe("Ann woke this ticket.");
    expect(say({ action: "WOKEN", actorType: "SYSTEM", actorUserId: null })).toBe(
      "The snooze ended.",
    );
  });

  it("names actors only among members, uses the system and the unknown-action row", () => {
    expect(
      say({ actorUserId: "u-gone", before: { status: "NEW" }, after: { status: "OPEN" } }),
    ).toBe("A former member changed the status from New to Open.");
    expect(
      say({
        actorType: "SYSTEM",
        actorUserId: null,
        before: { status: "RESOLVED" },
        after: { status: "CLOSED" },
      }),
    ).toBe("The system changed the status from Resolved to Closed.");
    const unknown = describeEvent(event({ action: "SOMETHING_NEW" }), context);
    expect(unknown.icon).toBe("History");
    expect(partsToText(unknown.parts)).toBe("Ann changed this ticket.");
  });

  it("appends (bulk change) only when the row carries a batchId", () => {
    const base = { before: { status: "OPEN" }, after: { status: "RESOLVED" } };
    expect(say({ ...base, batchId: "b-1" })).toBe(
      "Ann changed the status from Open to Resolved. (bulk change)",
    );
    expect(say({ ...base, batchId: null })).not.toContain("(bulk change)");
  });
});

describe("copy rows added by Codex diff round 1, D1 (UI-SPEC Copywriting)", () => {
  it("the status refusals on a merged source are exported constants with the rows' exact text", () => {
    expect(STATUS_REFUSED_MERGED_SOURCE).toBe(
      "Nothing was changed. This ticket was already merged, so its status can't change.",
    );
    expect(BULK_STATUS_REFUSED_MERGED_SOURCE).toBe(
      "One of the selected tickets was already merged into another ticket, so its status can't change. Unselect it and try again.",
    );
    // "Status unavailable: merged source" reuses the one merged-source reason.
    expect(MERGED_SOURCE_REASON).toBe("This ticket was already merged.");
  });
});

describe("copy rows added by Codex diff round 2, R2-1 (UI-SPEC Copywriting)", () => {
  it("the link-changed merge refusal is an exported constant with the row's exact text", () => {
    // Shown after the "Nothing was changed." prefix, as every "Merge error" row.
    expect(MERGE_ERROR_LINK_CHANGED).toBe(
      "The link between these tickets changed. Review the merge again.",
    );
  });

  it("the failed re-read names the ticket with the row's exact text", () => {
    expect(mergeRecheckFailedText(42)).toBe("Could not check #42 again. Try again.");
  });
});

describe("copy rows added by the review (UI-SPEC Copywriting, review UI-WR-05, UI-WR-06, K34)", () => {
  it("each new row is one exported constant with the row's exact text", () => {
    expect(ACTOR_FORMER_MEMBER_MID_SENTENCE).toBe("a former member");
    expect(MISSING_VALUE).toBe("no value");
    expect(MERGED_BANNER_DATE_UNKNOWN).toBe("an earlier date");
    expect(MERGED_COMPOSER_TARGET_UNAVAILABLE).toBe(
      "Replies go on the ticket this one was merged into.",
    );
    expect(MERGE_CONFIRM_DESCRIPTION).toBe("Review what happens before you merge these tickets.");
    expect(LINK_REMOVE_OUTCOME_UNKNOWN).toBe(
      "The result is not known. The link may have been removed. Refresh the page to check before you try again.",
    );
    expect(MERGED_SOURCE_REASON).toBe("This ticket was already merged.");
    expect(PICKER_REASON_MERGED).toBe("Already merged into another ticket");
  });

  it("names the replaced link when its label is known, and never makes one up (UI-WR-06)", () => {
    expect(mergeReplacesLinkText("Child of")).toBe(
      'The current link "Child of" between these tickets is replaced by "Duplicate of".',
    );
    expect(mergeReplacesLinkText(null)).toBe(
      'The current link between these tickets is replaced by "Duplicate of".',
    );
  });

  it("the former member mid-sentence comes from its constant", () => {
    expect(say({ action: "ASSIGNEE_CHANGED", after: { assigneeId: "u-gone" } })).toBe(
      `Ann assigned this ticket to ${ACTOR_FORMER_MEMBER_MID_SENTENCE}.`,
    );
  });

  it("a missing status or priority reads as the missing-value row (UI-WR-05 item 2)", () => {
    expect(say({ action: "PRIORITY_CHANGED", before: {}, after: { priority: "HIGH" } })).toBe(
      "Ann changed the priority from no value to High.",
    );
    expect(say({ before: { status: "OPEN" }, after: { status: null } })).toBe(
      "Ann changed the status from Open to no value.",
    );
  });

  it("an unknown status or priority value uses the other row, never the raw key (UI-WR-05 item 2)", () => {
    const status = say({ before: { status: "ARCHIVED" }, after: { status: "OPEN" } });
    expect(status).toBe("Ann changed this ticket.");
    expect(status).not.toContain("ARCHIVED");
    const priority = say({
      action: "PRIORITY_CHANGED",
      before: { priority: "LOW" },
      after: { priority: "CRITICAL" },
    });
    expect(priority).toBe("Ann changed this ticket.");
    expect(priority).not.toContain("CRITICAL");
    expect(say({ before: { status: 3 }, after: { status: "OPEN" } })).toBe(
      "Ann changed this ticket.",
    );
  });
});

// Phase 12.1 (D-11 Feed row as amended by K42, UI-SPEC Surface 7): each side of a STATUS_CHANGED
// row is filled on its own. Legacy sides hold { status }, new sides { stateId, stateGroup }.
describe("status rows over states (UI-SPEC Surface 7)", () => {
  it("the deleted-status copy rows are exported constants with the rows' exact text", () => {
    expect(DELETED_STATUS_MARKER).toBe("(deleted status)");
    expect(DELETED_STATUS_NO_NAME).toBe("a deleted status");
  });

  it("a legacy row keeps the enum labels", () => {
    expect(say({ before: { status: "OPEN" }, after: { status: "PENDING" } })).toBe(
      "Ann changed the status from Open to Pending.",
    );
  });

  it("a new row reads both current names", () => {
    expect(
      say({
        before: { stateId: "s-triage", stateGroup: "OPEN" },
        after: { stateId: "s-done", stateGroup: "RESOLVED" },
      }),
    ).toBe("Ann changed the status from Triage to Done.");
  });

  it("a soft-deleted state reads its name with the marker", () => {
    expect(
      say({
        before: { stateId: "s-vendor", stateGroup: "PENDING" },
        after: { stateId: "s-triage", stateGroup: "OPEN" },
      }),
    ).toBe("Ann changed the status from Waiting on vendor (deleted status) to Triage.");
  });

  it("a state id the organization does not have reads 'a deleted status'", () => {
    const row = say({
      before: { stateId: "s-elsewhere", stateGroup: "OPEN" },
      after: { stateId: "s-done", stateGroup: "RESOLVED" },
    });
    expect(row).toBe("Ann changed the status from a deleted status to Done.");
    expect(row).not.toContain("s-elsewhere");
  });

  it("one legacy side and one new side are each filled by their own rule", () => {
    expect(
      say({ before: { status: "NEW" }, after: { stateId: "s-vendor", stateGroup: "PENDING" } }),
    ).toBe("Ann changed the status from New to Waiting on vendor (deleted status).");
    expect(
      say({ before: { stateId: "s-triage", stateGroup: "OPEN" }, after: { status: "CLOSED" } }),
    ).toBe("Ann changed the status from Triage to Closed.");
  });

  it("a side of neither shape gives the other row, never the raw value", () => {
    expect(
      say({ before: { status: 3 }, after: { stateId: "s-done", stateGroup: "RESOLVED" } }),
    ).toBe("Ann changed this ticket.");
    const numeric = say({
      before: { stateId: 7 },
      after: { stateId: "s-done", stateGroup: "RESOLVED" },
    });
    expect(numeric).toBe("Ann changed this ticket.");
    const badGroup = say({
      before: { stateId: "s-triage", stateGroup: "ARCHIVED" },
      after: { stateId: "s-done", stateGroup: "RESOLVED" },
    });
    expect(badGroup).toBe("Ann changed this ticket.");
    expect(badGroup).not.toContain("ARCHIVED");
  });

  it("a deletion-written row with a batchId keeps the (bulk change) suffix", () => {
    expect(
      say({
        actorUserId: "u-bo",
        batchId: "b-delete",
        before: { stateId: "s-vendor", stateGroup: "PENDING" },
        after: { stateId: "s-triage", stateGroup: "PENDING" },
      }),
    ).toBe(
      "Bo changed the status from Waiting on vendor (deleted status) to Triage. (bulk change)",
    );
  });

  it("referencedIds collects the state ids of both sides, as tag ids are collected", () => {
    const refs = referencedIds([
      {
        before: { stateId: "s-a", stateGroup: "OPEN" },
        after: { stateId: "s-b", stateGroup: "PENDING" },
      },
      { before: { status: "OPEN" }, after: { stateId: "s-a", stateGroup: "OPEN" } },
      { before: { stateId: 7 }, after: {} },
    ]);
    expect(refs.stateIds.sort()).toEqual(["s-a", "s-b"]);
  });
});

describe("buildActivityFeed (D-18 order)", () => {
  const at = (iso: string) => new Date(iso);

  it("orders by time, puts messages before events on a tie, then orders by id", () => {
    const t = "2026-11-08T10:00:00.000Z";
    const feed = buildActivityFeed(
      [
        { id: "m-b", createdAt: at(t), visibility: "PUBLIC" },
        { id: "m-a", createdAt: at(t), visibility: "INTERNAL" },
        { id: "m-0", createdAt: at("2026-11-08T09:00:00.000Z"), visibility: "PUBLIC" },
      ],
      [
        { id: "e-b", createdAt: at(t) },
        { id: "e-a", createdAt: at(t) },
        { id: "e-late", createdAt: at("2026-11-08T11:00:00.000Z") },
      ],
    );
    expect(feed.map((item) => `${item.kind}:${item.id}`)).toEqual([
      "message:m-0",
      "message:m-a",
      "message:m-b",
      "event:e-a",
      "event:e-b",
      "event:e-late",
    ]);
  });

  it("keeps internal notes in the feed", () => {
    const feed = buildActivityFeed(
      [{ id: "note", createdAt: at("2026-11-08T10:00:00.000Z"), visibility: "INTERNAL" }],
      [],
    );
    expect(feed).toHaveLength(1);
    expect(feed[0].kind === "message" && feed[0].message.visibility).toBe("INTERNAL");
  });

  it("gives an empty list for empty input", () => {
    expect(buildActivityFeed([], [])).toEqual([]);
  });
});
