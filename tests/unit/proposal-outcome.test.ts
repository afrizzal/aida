// The one post-action rule of the proposal UIs (UI-SPEC 1b, 3e to 3i, amendments A1 to A5):
// resolveActionOutcome gives the message, tone, disabled submit, reload offer and focus target
// for every action result, and an UNKNOWN result looks and behaves exactly like a rejected call
// (review C6). The repository has no component-test setup, so this test stands in for "UNKNOWN in
// the Start dialog": the dialog only applies the view resolved here.
import { describe, expect, it } from "vitest";
import {
  MAINTENANCE_REFUSAL_CODES,
  REQUEST_REFUSAL_CODES,
  REVIEW_REFUSAL_CODES,
} from "../../src/lib/kb/proposal-contract";
import * as copy from "../../src/lib/kb/proposal-copy";
import {
  PUBLISHED_TOAST_INDEXING_NOT_STARTED,
  RESTART_RECORDED_NOT_STARTED,
  RETRY_RECORDED_NOT_STARTED,
} from "../../src/lib/kb/proposal-copy";
import {
  ACTION_UNKNOWN_CODE,
  type ActionOutcome,
  type ProposalAction,
  resolveActionOutcome,
} from "../../src/lib/kb/proposal-outcome";
import type { ProposalRequestResult } from "../../src/lib/kb/proposal-request";
import type {
  PublishProposalResult,
  RejectProposalResult,
  RestartProposalResult,
  RetryIndexingResult,
  SaveProposalResult,
} from "../../src/lib/kb/proposal-review";

const ACTIONS: ProposalAction[] = [
  "start",
  "save",
  "publish",
  "reject",
  "restart",
  "retryIndexing",
];

describe("resolveActionOutcome: UNKNOWN equals a rejected call (amendment A4, review C6)", () => {
  it("ACTION_UNKNOWN_CODE is the action code UNKNOWN", () => {
    expect(ACTION_UNKNOWN_CODE).toBe("UNKNOWN");
  });

  it("for every action, UNKNOWN deep-equals rejected and shows the outcome-unknown row", () => {
    for (const action of ACTIONS) {
      const unknown = resolveActionOutcome(action, { ok: false, code: ACTION_UNKNOWN_CODE });
      const rejected = resolveActionOutcome(action, { rejected: true });
      expect(unknown).toStrictEqual(rejected);
      expect(unknown.kind).toBe("unknown");
      expect(unknown.tone).toBe("error");
      expect(unknown.message).toBe(copy.outcomeUnknownCopy(action));
      expect(unknown.disableSubmit).toBe(true);
      expect(unknown.message).not.toMatch(/^Nothing was changed\./);
    }
  });

  it("a code outside the action's contract list is treated as an unknown outcome", () => {
    expect(resolveActionOutcome("start", { ok: false, code: "CONFLICT" })).toStrictEqual(
      resolveActionOutcome("start", { rejected: true }),
    );
    expect(resolveActionOutcome("restart", { ok: false, code: "SELECTION" })).toStrictEqual(
      resolveActionOutcome("restart", { rejected: true }),
    );
  });
});

describe("resolveActionOutcome: start (UI-SPEC 1b, 3i)", () => {
  it("unknown outcome keeps submit disabled and focuses 'Close without starting'", () => {
    const view = resolveActionOutcome("start", { rejected: true });
    expect(view).toStrictEqual({
      kind: "unknown",
      tone: "error",
      message: copy.START_OUTCOME_UNKNOWN,
      disableSubmit: true,
      offerReload: false,
      focus: "dismiss",
    });
    expect(copy.START_DISMISS).toBe("Close without starting");
  });

  it("AI_OFF, NOT_ALLOWED, MEMBERSHIP_ENDED and COUNT give their Start error row", () => {
    for (const code of ["AI_OFF", "NOT_ALLOWED", "MEMBERSHIP_ENDED", "COUNT"] as const) {
      expect(resolveActionOutcome("start", { ok: false, code })).toStrictEqual({
        kind: "refusal",
        tone: "error",
        message: copy.requestRefusalCopy(code),
        disableSubmit: true,
        offerReload: false,
        focus: "dismiss",
      });
    }
    expect(resolveActionOutcome("start", { ok: false, code: "AI_OFF" }).message).toBe(
      "Nothing was changed. AI is turned off for this workspace.",
    );
  });

  it("SELECTION gives the selection callout and focuses the callout heading", () => {
    const view = resolveActionOutcome("start", { ok: false, code: "SELECTION" });
    expect(view).toStrictEqual({
      kind: "refusal",
      tone: "error",
      message: `Nothing was changed. ${copy.SELECTION_REFUSED_INTRO}`,
      disableSubmit: true,
      offerReload: false,
      focus: "calloutHeading",
    });
  });

  it("ok gives the Started toast", () => {
    expect(resolveActionOutcome("start", { ok: true })).toStrictEqual({
      kind: "success",
      tone: "success",
      message: copy.STARTED_TOAST,
      disableSubmit: false,
      offerReload: false,
      focus: "heading",
    });
  });

  it("every request refusal code resolves to a refusal with its row", () => {
    for (const code of REQUEST_REFUSAL_CODES) {
      const view = resolveActionOutcome("start", { ok: false, code });
      expect(view.kind).toBe("refusal");
      expect(view.message).toBe(copy.requestRefusalCopy(code));
      expect(view.disableSubmit).toBe(true);
    }
  });
});

describe("resolveActionOutcome: save (UI-SPEC 3c, 3e, 3h, 3i)", () => {
  it("a field refusal names its field, maps by field and code, and focuses the field", () => {
    expect(
      resolveActionOutcome("save", { ok: false, code: "TICKET_LINK", field: "title" }),
    ).toStrictEqual({
      kind: "field",
      tone: "error",
      message: copy.TITLE_CITATION_MARKER_ERROR,
      disableSubmit: false,
      offerReload: false,
      focus: "field",
      field: "title",
    });
    const body = resolveActionOutcome("save", {
      ok: false,
      code: "CITATION_MARKER",
      field: "bodyMarkdown",
    });
    expect(body.message).toBe(copy.CITATION_MARKER_ERROR);
    expect(body.field).toBe("bodyMarkdown");
    // A field code without a field names the field the code belongs to.
    expect(resolveActionOutcome("save", { ok: false, code: "TITLE_TOO_SHORT" }).field).toBe(
      "title",
    );
    expect(resolveActionOutcome("save", { ok: false, code: "TICKET_LINK" })).toMatchObject({
      field: "bodyMarkdown",
      message: copy.TICKET_LINK_ERROR,
    });
  });

  it("IMAGE_NOT_ALLOWED gives the A6 Image error row on the Body field (run decision K54)", () => {
    const expected = {
      kind: "field",
      tone: "error",
      message: copy.IMAGE_ERROR,
      disableSubmit: false,
      offerReload: false,
      focus: "field",
      field: "bodyMarkdown",
    };
    expect(
      resolveActionOutcome("save", { ok: false, code: "IMAGE_NOT_ALLOWED", field: "bodyMarkdown" }),
    ).toStrictEqual(expected);
    // Without a field, the code belongs to the body.
    expect(resolveActionOutcome("save", { ok: false, code: "IMAGE_NOT_ALLOWED" })).toStrictEqual(
      expected,
    );
    // Publish validates the stored body: the dialog shows the same row.
    expect(
      resolveActionOutcome("publish", {
        ok: false,
        code: "IMAGE_NOT_ALLOWED",
        field: "bodyMarkdown",
      }).message,
    ).toBe(copy.IMAGE_ERROR);
  });

  it("BODY_TOO_LONG gives the A8 row on the Body field (review a-IN-02)", () => {
    const expected = {
      kind: "field",
      tone: "error",
      message: copy.BODY_TOO_LONG_ERROR,
      disableSubmit: false,
      offerReload: false,
      focus: "field",
      field: "bodyMarkdown",
    };
    expect(
      resolveActionOutcome("save", { ok: false, code: "BODY_TOO_LONG", field: "bodyMarkdown" }),
    ).toStrictEqual(expected);
    expect(resolveActionOutcome("save", { ok: false, code: "BODY_TOO_LONG" })).toStrictEqual(
      expected,
    );
    expect(
      resolveActionOutcome("publish", { ok: false, code: "BODY_TOO_LONG", field: "bodyMarkdown" })
        .message,
    ).toBe(copy.BODY_TOO_LONG_ERROR);
  });

  it("publish SLUG_UNAVAILABLE is a refusal with the prefixed 'Publish error: unknown' row, never outcome unknown (review a-IN-03)", () => {
    expect(resolveActionOutcome("publish", { ok: false, code: "SLUG_UNAVAILABLE" })).toStrictEqual({
      kind: "refusal",
      tone: "error",
      message: `Nothing was changed. ${copy.PUBLISH_ERROR_UNKNOWN}`,
      disableSubmit: true,
      offerReload: false,
      focus: "dismiss",
    });
    // Only publish knows the code: any other action treats it as outside its contract.
    for (const action of ["save", "reject"] as const) {
      expect(resolveActionOutcome(action, { ok: false, code: "SLUG_UNAVAILABLE" }).kind).toBe(
        "unknown",
      );
    }
  });

  it("CONFLICT offers reload, disables save until reload and focuses the callout", () => {
    expect(resolveActionOutcome("save", { ok: false, code: "CONFLICT" })).toStrictEqual({
      kind: "refusal",
      tone: "error",
      message: copy.CONFLICT,
      disableSubmit: true,
      offerReload: true,
      focus: "callout",
    });
  });

  it("NOT_DRAFT and NOT_ALLOWED give their row and focus the callout", () => {
    // Review b-WR-03: the "Save error: not draft" row asks for a reload, so it is offered.
    expect(resolveActionOutcome("save", { ok: false, code: "NOT_DRAFT" })).toMatchObject({
      kind: "refusal",
      message: copy.SAVE_ERROR_NOT_DRAFT,
      focus: "callout",
      offerReload: true,
    });
    expect(resolveActionOutcome("save", { ok: false, code: "NOT_ALLOWED" })).toMatchObject({
      kind: "refusal",
      message: copy.SAVE_ERROR_NOT_ALLOWED,
      focus: "callout",
    });
  });

  it("an unknown outcome gives 'Save outcome unknown', save disabled, focus on the callout", () => {
    expect(resolveActionOutcome("save", { ok: false, code: ACTION_UNKNOWN_CODE })).toStrictEqual({
      kind: "unknown",
      tone: "error",
      message: copy.SAVE_OUTCOME_UNKNOWN,
      disableSubmit: true,
      offerReload: true,
      focus: "callout",
    });
  });

  it("ok gives the Saved toast and focuses the heading", () => {
    expect(resolveActionOutcome("save", { ok: true })).toStrictEqual({
      kind: "success",
      tone: "success",
      message: copy.SAVED_TOAST,
      disableSubmit: false,
      offerReload: false,
      focus: "heading",
    });
  });

  it("every review refusal code resolves to a field or refusal view with a row", () => {
    for (const code of REVIEW_REFUSAL_CODES) {
      const view = resolveActionOutcome("save", { ok: false, code });
      expect(["field", "refusal"]).toContain(view.kind);
      expect(view.message?.length ?? 0).toBeGreaterThan(0);
    }
  });
});

describe("resolveActionOutcome: publish and reject (UI-SPEC 3f, 3g, amendment A1)", () => {
  it("publish ok with indexingQueued true gives the Published toast", () => {
    expect(resolveActionOutcome("publish", { ok: true, indexingQueued: true })).toStrictEqual({
      kind: "success",
      tone: "success",
      message: copy.PUBLISHED_TOAST,
      disableSubmit: false,
      offerReload: false,
      focus: "heading",
    });
  });

  it("publish ok with indexingQueued false gives the A1 warning toast (review C2)", () => {
    expect(resolveActionOutcome("publish", { ok: true, indexingQueued: false })).toStrictEqual({
      kind: "success",
      tone: "warning",
      message: PUBLISHED_TOAST_INDEXING_NOT_STARTED,
      disableSubmit: false,
      offerReload: false,
      focus: "heading",
    });
  });

  it("publish refusal, CONFLICT and unknown disable the confirm button and focus 'Keep reviewing'", () => {
    expect(resolveActionOutcome("publish", { ok: false, code: "NOT_DRAFT" })).toStrictEqual({
      kind: "refusal",
      tone: "error",
      message: `Nothing was changed. ${copy.PUBLISH_ERROR_NOT_DRAFT}`,
      disableSubmit: true,
      offerReload: true,
      focus: "dismiss",
    });
    expect(resolveActionOutcome("publish", { ok: false, code: "CONFLICT" })).toStrictEqual({
      kind: "refusal",
      tone: "error",
      message: copy.CONFLICT,
      disableSubmit: true,
      offerReload: true,
      focus: "dismiss",
    });
    expect(resolveActionOutcome("publish", { rejected: true })).toStrictEqual({
      kind: "unknown",
      tone: "error",
      message: copy.PUBLISH_OUTCOME_UNKNOWN,
      disableSubmit: true,
      offerReload: true,
      focus: "dismiss",
    });
    for (const code of REVIEW_REFUSAL_CODES) {
      const view = resolveActionOutcome("publish", { ok: false, code });
      expect(view.kind).toBe("refusal");
      expect(view.disableSubmit).toBe(true);
      expect(view.focus).toBe("dismiss");
    }
    expect(copy.KEEP_REVIEWING).toBe("Keep reviewing");
  });

  it("reject has the same shape with the Rejected toast and 'Keep proposal'", () => {
    expect(resolveActionOutcome("reject", { ok: true })).toStrictEqual({
      kind: "success",
      tone: "success",
      message: copy.REJECTED_TOAST,
      disableSubmit: false,
      offerReload: false,
      focus: "heading",
    });
    expect(resolveActionOutcome("reject", { ok: false, code: "NOT_ALLOWED" })).toStrictEqual({
      kind: "refusal",
      tone: "error",
      message: `Nothing was changed. ${copy.REJECT_ERROR_NOT_ALLOWED}`,
      disableSubmit: true,
      offerReload: false,
      focus: "dismiss",
    });
    expect(resolveActionOutcome("reject", { ok: false, code: "CONFLICT" }).offerReload).toBe(true);
    expect(resolveActionOutcome("reject", { rejected: true })).toMatchObject({
      message: copy.REJECT_OUTCOME_UNKNOWN,
      disableSubmit: true,
      focus: "dismiss",
    });
    expect(copy.KEEP_PROPOSAL).toBe("Keep proposal");
  });
});

describe("resolveActionOutcome: restart and retry indexing (UI-SPEC 3i, amendments A3, A5)", () => {
  it("restart ok with queued false gives the A3 warning line (review C5)", () => {
    expect(resolveActionOutcome("restart", { ok: true, queued: false })).toStrictEqual({
      kind: "success",
      tone: "warning",
      message: RESTART_RECORDED_NOT_STARTED,
      disableSubmit: false,
      offerReload: false,
      focus: "pressedButton",
    });
  });

  it("restart ok with queued true is a success with no message", () => {
    expect(resolveActionOutcome("restart", { ok: true, queued: true })).toStrictEqual({
      kind: "success",
      tone: "success",
      message: null,
      disableSubmit: false,
      offerReload: false,
      focus: "pressedButton",
    });
  });

  it("restart refusals and unknown outcome", () => {
    expect(resolveActionOutcome("restart", { ok: false, code: "NOT_STUCK" })).toStrictEqual({
      kind: "refusal",
      tone: "error",
      message: copy.RESTART_RETRY_ERROR,
      disableSubmit: false,
      offerReload: false,
      focus: "pressedButton",
    });
    expect(resolveActionOutcome("restart", { rejected: true })).toStrictEqual({
      kind: "unknown",
      tone: "error",
      message: copy.RESTART_OUTCOME_UNKNOWN,
      disableSubmit: true,
      offerReload: true,
      focus: "pressedButton",
    });
  });

  it("retry indexing: queued true gives 'Indexing restarted.', queued false the A5 warning line", () => {
    expect(resolveActionOutcome("retryIndexing", { ok: true, queued: true })).toStrictEqual({
      kind: "success",
      tone: "success",
      message: "Indexing restarted.",
      disableSubmit: false,
      offerReload: false,
      focus: "pressedButton",
    });
    expect(resolveActionOutcome("retryIndexing", { ok: true, queued: false })).toStrictEqual({
      kind: "success",
      tone: "warning",
      message: RETRY_RECORDED_NOT_STARTED,
      disableSubmit: false,
      offerReload: false,
      focus: "pressedButton",
    });
  });

  it("retry indexing refusals and unknown outcome", () => {
    expect(
      resolveActionOutcome("retryIndexing", { ok: false, code: "NOT_RETRYABLE" }),
    ).toMatchObject({ kind: "refusal", message: copy.RESTART_RETRY_ERROR, focus: "pressedButton" });
    expect(
      resolveActionOutcome("retryIndexing", { ok: false, code: ACTION_UNKNOWN_CODE }),
    ).toStrictEqual({
      kind: "unknown",
      tone: "error",
      message: copy.RETRY_INDEXING_OUTCOME_UNKNOWN,
      disableSubmit: true,
      offerReload: true,
      focus: "pressedButton",
    });
  });

  it("NOT_ALLOWED and NOT_FOUND keep the button disabled; the other refusals invite another try (review b-IN-02)", () => {
    for (const action of ["restart", "retryIndexing"] as const) {
      for (const code of MAINTENANCE_REFUSAL_CODES) {
        const view = resolveActionOutcome(action, { ok: false, code });
        expect(view.disableSubmit).toBe(code === "NOT_ALLOWED" || code === "NOT_FOUND");
        expect(view.focus).toBe("pressedButton");
      }
      expect(resolveActionOutcome(action, { ok: false, code: "NOT_ALLOWED" }).message).toBe(
        copy.maintenanceRefusalCopy("NOT_ALLOWED"),
      );
    }
  });

  it("every maintenance refusal code resolves for both actions with focus on the pressed button", () => {
    for (const action of ["restart", "retryIndexing"] as const) {
      for (const code of MAINTENANCE_REFUSAL_CODES) {
        const view = resolveActionOutcome(action, { ok: false, code });
        expect(view.kind).toBe("refusal");
        expect(view.message).toBe(copy.maintenanceRefusalCopy(code));
        expect(view.focus).toBe("pressedButton");
      }
    }
  });
});

describe("resolveActionOutcome: reload offer (review b-WR-03)", () => {
  // Every row that asks the user to reload ("Reload the proposal…", "Reload it…") offers "Reload
  // proposal": the outcome-unknown rows of save, publish, reject, restart and retry indexing, and
  // the NOT_DRAFT rows of save, publish and reject, besides CONFLICT. The Start dialog's row says
  // "Open Proposals to check", so start never offers it.
  it("every outcome-unknown view except start offers the reload", () => {
    for (const action of ACTIONS) {
      const view = resolveActionOutcome(action, { rejected: true });
      expect(view.offerReload).toBe(action !== "start");
      expect(resolveActionOutcome(action, { ok: false, code: ACTION_UNKNOWN_CODE })).toStrictEqual(
        view,
      );
      if (view.offerReload) expect(view.message).toMatch(/Reload (the proposal|it) to check/);
    }
  });

  it("NOT_DRAFT offers the reload for save, publish and reject; its rows ask for it", () => {
    for (const action of ["save", "publish", "reject"] as const) {
      const view = resolveActionOutcome(action, { ok: false, code: "NOT_DRAFT" });
      expect(view.kind).toBe("refusal");
      expect(view.offerReload).toBe(true);
      expect(view.disableSubmit).toBe(true);
      expect(view.message).toMatch(/Reload it to see its status\.$/);
    }
  });

  it("refusals whose rows do not ask for a reload do not offer it", () => {
    for (const action of ["save", "publish", "reject"] as const) {
      for (const code of ["NOT_ALLOWED", "MEMBERSHIP_ENDED", "NOT_FOUND"]) {
        expect(resolveActionOutcome(action, { ok: false, code }).offerReload).toBe(false);
      }
    }
    expect(
      resolveActionOutcome("publish", { ok: false, code: "SLUG_UNAVAILABLE" }).offerReload,
    ).toBe(false);
    for (const action of ["restart", "retryIndexing"] as const) {
      for (const code of MAINTENANCE_REFUSAL_CODES) {
        expect(resolveActionOutcome(action, { ok: false, code }).offerReload).toBe(false);
      }
    }
  });
});

describe("resolveActionOutcome: accepts the services' typed results unchanged (plan 12.2-08)", () => {
  it("every service result type is an ActionOutcome", () => {
    // Typed as the services return them (plan 12.2-08 passes these values on unchanged).
    const started: ProposalRequestResult = { ok: true, proposalId: "p1" };
    const refused: ProposalRequestResult = { ok: false, code: "SELECTION", refusals: [] };
    const saved: SaveProposalResult = { ok: false, code: "TICKET_LINK", field: "title" };
    const published: PublishProposalResult = { ok: true, articleId: "a1", indexingQueued: false };
    const rejected: RejectProposalResult = { ok: true };
    const restarted: RestartProposalResult = { ok: true, queued: false };
    const retried: RetryIndexingResult = { ok: false, code: "NOT_RETRYABLE" };
    const results: Array<[ProposalAction, ActionOutcome]> = [
      ["start", started],
      ["start", refused],
      ["save", saved],
      ["publish", published],
      ["reject", rejected],
      ["restart", restarted],
      ["retryIndexing", retried],
    ];
    const kinds = results.map(([action, outcome]) => resolveActionOutcome(action, outcome).kind);
    expect(kinds).toEqual([
      "success",
      "refusal",
      "field",
      "success",
      "success",
      "success",
      "refusal",
    ]);
  });
});
