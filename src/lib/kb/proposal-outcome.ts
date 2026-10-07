// Phase 12.2 post-action rule (UI-SPEC 1b, 3e to 3i, amendments A1 to A6): the one function every
// proposal UI applies to an action's result, so the message, its tone, whether the submit stays
// disabled, the reload offer and the focus target are decided once and tested once. Pure and
// client-safe: client components import it. Relative imports only.
//
// Amendment A4 (review C6): an action that throws inside the server returns
// { ok: false, code: ACTION_UNKNOWN_CODE } (plan 12.2-08). That result, and a code outside the
// action's contract list, resolve to exactly the view of a rejected call: the action's "… outcome
// unknown" row, the submit or pressed button disabled until close or reload, and the focus target
// of the UI-SPEC 3i rejected-call row. UNKNOWN is compared here only; components never compare a
// code with it themselves.

import {
  MAINTENANCE_REFUSAL_CODES,
  type MaintenanceRefusalCode,
  PUBLISH_REFUSAL_CODES,
  type PublishRefusalCode,
  REQUEST_REFUSAL_CODES,
  REVIEW_REFUSAL_CODES,
  type RequestRefusalCode,
  type ReviewRefusalCode,
} from "./proposal-contract";
import {
  fieldRefusalCopy,
  INDEXING_RESTARTED,
  isProposalField,
  isProposalFieldCode,
  maintenanceRefusalCopy,
  outcomeUnknownCopy,
  type ProposalAction,
  type ProposalField,
  type ProposalFieldCode,
  PUBLISHED_TOAST,
  PUBLISHED_TOAST_INDEXING_NOT_STARTED,
  publishRefusalCopy,
  REJECTED_TOAST,
  RESTART_RECORDED_NOT_STARTED,
  RETRY_RECORDED_NOT_STARTED,
  rejectRefusalCopy,
  requestRefusalCopy,
  SAVED_TOAST,
  STARTED_TOAST,
  saveRefusalCopy,
} from "./proposal-copy";

export type { ProposalAction } from "./proposal-copy";

/** The code a server action returns for an error thrown inside it (plan 12.2-08). */
export const ACTION_UNKNOWN_CODE = "UNKNOWN" as const;

/**
 * What an action ended with: a typed success, a typed refusal (or ACTION_UNKNOWN_CODE), or a
 * rejected call (the promise rejected, for example a network failure), caught by the component.
 */
export type ActionOutcome =
  | { ok: true; indexingQueued?: boolean; queued?: boolean }
  | { ok: false; code: string; field?: string }
  | { rejected: true };

export type OutcomeKind = "success" | "refusal" | "field" | "unknown";

export type OutcomeTone = "success" | "warning" | "error";

/** UI-SPEC 3i focus targets. "dismiss" is "Close without starting", "Keep reviewing" or "Keep proposal". */
export type OutcomeFocus =
  | "dismiss"
  | "submit"
  | "callout"
  | "calloutHeading"
  | "field"
  | "heading"
  | "pressedButton";

export interface OutcomeView {
  kind: OutcomeKind;
  tone: OutcomeTone;
  /** The copy row to show; null for a restart success, which has no row. */
  message: string | null;
  /** The submit (or the pressed button) stays disabled until the dialog closes or the page reloads. */
  disableSubmit: boolean;
  /**
   * "Reload proposal" is offered with the message (review b-WR-03): for every row that asks the
   * user to reload, that is CONFLICT, NOT_DRAFT (save, publish, reject) and the outcome-unknown
   * rows of every action but start, whose row says "Open Proposals to check" instead.
   */
  offerReload: boolean;
  focus: OutcomeFocus;
  /** Set for kind "field": the field that failed. */
  field?: ProposalField;
}

/** UI-SPEC 3i rejected-call focus per action. */
const UNKNOWN_FOCUS: Record<ProposalAction, OutcomeFocus> = {
  start: "dismiss",
  save: "callout",
  publish: "dismiss",
  reject: "dismiss",
  restart: "pressedButton",
  retryIndexing: "pressedButton",
};

function view(
  kind: OutcomeKind,
  tone: OutcomeTone,
  message: string | null,
  focus: OutcomeFocus,
  disableSubmit = false,
  offerReload = false,
): OutcomeView {
  return { kind, tone, message, disableSubmit, offerReload, focus };
}

function unknownView(action: ProposalAction): OutcomeView {
  return view(
    "unknown",
    "error",
    outcomeUnknownCopy(action),
    UNKNOWN_FOCUS[action],
    true,
    action !== "start",
  );
}

/** Review b-WR-03: the refusals whose rows ask the user to reload the proposal. */
function asksForReload(code: string): boolean {
  return code === "CONFLICT" || code === "NOT_DRAFT";
}

function isOneOf<T extends string>(list: readonly T[], code: string): code is T {
  return (list as readonly string[]).includes(code);
}

/**
 * The field a field code belongs to when the refusal names none. CITATION_MARKER, TICKET_LINK,
 * BODY_REQUIRED, IMAGE_NOT_ALLOWED (amendment A6, run decision K54: the "Image error" row, focus
 * on Body) and BODY_TOO_LONG (amendment A8, review a-IN-02) belong to the body.
 */
function fieldFor(code: ProposalFieldCode, field: string | undefined): ProposalField {
  if (isProposalField(field)) return field;
  return code === "TITLE_TOO_SHORT" || code === "TITLE_TOO_LONG" ? "title" : "bodyMarkdown";
}

function successView(
  action: ProposalAction,
  outcome: { indexingQueued?: boolean; queued?: boolean },
): OutcomeView {
  switch (action) {
    case "start":
      return view("success", "success", STARTED_TOAST, "heading");
    case "save":
      return view("success", "success", SAVED_TOAST, "heading");
    case "publish":
      // Amendment A1 (review C2): only a queued embed send is a plain success.
      return outcome.indexingQueued === true
        ? view("success", "success", PUBLISHED_TOAST, "heading")
        : view("success", "warning", PUBLISHED_TOAST_INDEXING_NOT_STARTED, "heading");
    case "reject":
      return view("success", "success", REJECTED_TOAST, "heading");
    case "restart":
      // Amendment A3 (review C5); the UI-SPEC has no success row for a queued restart.
      return outcome.queued === true
        ? view("success", "success", null, "pressedButton")
        : view("success", "warning", RESTART_RECORDED_NOT_STARTED, "pressedButton");
    case "retryIndexing":
      // Amendment A5 (review R3-2): "Indexing restarted." only for a queued send.
      return outcome.queued === true
        ? view("success", "success", INDEXING_RESTARTED, "pressedButton")
        : view("success", "warning", RETRY_RECORDED_NOT_STARTED, "pressedButton");
  }
}

function startRefusalView(code: RequestRefusalCode): OutcomeView {
  // UI-SPEC 1b: a refused request leaves nothing to retry in this dialog; the admin closes it.
  const focus: OutcomeFocus = code === "SELECTION" ? "calloutHeading" : "dismiss";
  return view("refusal", "error", requestRefusalCopy(code), focus, true);
}

function saveRefusalView(code: ReviewRefusalCode, field: string | undefined): OutcomeView {
  if (isProposalFieldCode(code)) {
    const target = fieldFor(code, field);
    return { ...view("field", "error", fieldRefusalCopy(target, code), "field"), field: target };
  }
  // CONFLICT (3h), NOT_DRAFT, NOT_ALLOWED, MEMBERSHIP_ENDED and NOT_FOUND cannot succeed again
  // without a reload, so save stays disabled until then.
  return view("refusal", "error", saveRefusalCopy(code), "callout", true, asksForReload(code));
}

function dialogRefusalView(message: string, code: PublishRefusalCode): OutcomeView {
  return view("refusal", "error", message, "dismiss", true, asksForReload(code));
}

function publishRefusalView(code: PublishRefusalCode, field: string | undefined): OutcomeView {
  // SLUG_UNAVAILABLE (review a-IN-03) is a known outcome: "Publish error: unknown" with the prefix.
  return dialogRefusalView(
    publishRefusalCopy(code, isProposalField(field) ? field : undefined),
    code,
  );
}

function rejectRefusalView(code: ReviewRefusalCode, field: string | undefined): OutcomeView {
  return dialogRefusalView(
    rejectRefusalCopy(code, isProposalField(field) ? field : undefined),
    code,
  );
}

function maintenanceRefusalView(code: MaintenanceRefusalCode): OutcomeView {
  // "Restart / Retry error" invites another try, so the button stays enabled. NOT_ALLOWED and
  // NOT_FOUND cannot succeed on another try: their rows and a disabled button (review b-IN-02).
  const final = code === "NOT_ALLOWED" || code === "NOT_FOUND";
  return view("refusal", "error", maintenanceRefusalCopy(code), "pressedButton", final);
}

/** The view after an action (UI-SPEC 3i); UNKNOWN and a rejected call give the identical view. */
export function resolveActionOutcome(action: ProposalAction, outcome: ActionOutcome): OutcomeView {
  if ("rejected" in outcome) return unknownView(action);
  if (outcome.ok) return successView(action, outcome);

  const { code, field } = outcome;
  if (code === ACTION_UNKNOWN_CODE) return unknownView(action);

  switch (action) {
    case "start":
      return isOneOf(REQUEST_REFUSAL_CODES, code) ? startRefusalView(code) : unknownView(action);
    case "save":
      return isOneOf(REVIEW_REFUSAL_CODES, code)
        ? saveRefusalView(code, field)
        : unknownView(action);
    case "publish":
      return isOneOf(PUBLISH_REFUSAL_CODES, code)
        ? publishRefusalView(code, field)
        : unknownView(action);
    case "reject":
      return isOneOf(REVIEW_REFUSAL_CODES, code)
        ? rejectRefusalView(code, field)
        : unknownView(action);
    case "restart":
    case "retryIndexing":
      return isOneOf(MAINTENANCE_REFUSAL_CODES, code)
        ? maintenanceRefusalView(code)
        : unknownView(action);
  }
}
