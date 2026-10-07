// Copy table for Phase 12.2 (UI-SPEC Copywriting Contract and amendments A1 to A5): one
// expectation per row, each checked against the row text pasted verbatim, plus exhaustive loops
// over every server code list of proposal-contract.ts.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAINTENANCE_REFUSAL_CODES,
  PROPOSAL_FAILURE_CODES,
  PROPOSAL_STATUSES,
  REQUEST_REFUSAL_CODES,
  REVIEW_REFUSAL_CODES,
  type ReviewRefusalCode,
  TICKET_REFUSAL_REASONS,
} from "../../src/lib/kb/proposal-contract";
import * as copy from "../../src/lib/kb/proposal-copy";
import {
  fieldRefusalCopy,
  outcomeUnknownCopy,
  PROPOSAL_ACTIONS,
  PROPOSAL_FIELD_CODES,
  PROPOSAL_FIELDS,
} from "../../src/lib/kb/proposal-copy";
import { type DraftFieldCode, validateDraftFields } from "../../src/lib/kb/proposal-schema";

const CHIP_SOURCE = fs.readFileSync(
  path.resolve(__dirname, "../../src/components/kb/kb-proposal-status-chip.tsx"),
  "utf8",
);

const PREFIX = "Nothing was changed.";

// The four "… error: unknown" rows (UI-SPEC amendment A4): kept verbatim. Only publish's
// SLUG_UNAVAILABLE (review a-IN-03) maps to one of them, the publish row, with the prefix.
const ERROR_UNKNOWN_ROWS = [
  "Nothing was changed. The proposal could not be started. Wait a moment and try again.",
  "Nothing was changed. The draft could not be saved. Wait a moment and try again.",
  "The article could not be published. Wait a moment and try again.",
  "The proposal could not be rejected. Wait a moment and try again.",
];

const MEMBERSHIP_ENDED_ROW =
  "Your access to this workspace has ended. Sign out, then sign in again.";

/** Every string any mapping function returns, for the A4 and prefix loops. */
function everyMappedRow(): string[] {
  const rows: string[] = [];
  for (const code of REQUEST_REFUSAL_CODES) rows.push(copy.requestRefusalCopy(code));
  for (const reason of TICKET_REFUSAL_REASONS) {
    rows.push(copy.ticketRefusalCopy(reason, 42));
    rows.push(copy.ticketRefusalCopy(reason));
  }
  for (const code of REVIEW_REFUSAL_CODES) {
    rows.push(copy.saveRefusalCopy(code), copy.publishRefusalCopy(code));
    rows.push(copy.rejectRefusalCopy(code));
    for (const field of PROPOSAL_FIELDS) {
      rows.push(copy.saveRefusalCopy(code, field), copy.publishRefusalCopy(code, field));
      rows.push(copy.rejectRefusalCopy(code, field));
    }
  }
  for (const field of PROPOSAL_FIELDS) {
    for (const code of PROPOSAL_FIELD_CODES) rows.push(fieldRefusalCopy(field, code));
  }
  rows.push(copy.publishRefusalCopy("SLUG_UNAVAILABLE"));
  for (const code of MAINTENANCE_REFUSAL_CODES) rows.push(copy.maintenanceRefusalCopy(code));
  for (const code of PROPOSAL_FAILURE_CODES) {
    rows.push(copy.failureFullCopy(code), copy.failureShortCopy(code));
  }
  for (const action of PROPOSAL_ACTIONS) rows.push(outcomeUnknownCopy(action));
  return rows;
}

describe("proposal-copy: Start (Surface 1)", () => {
  it("CTA, entry and dialog rows", () => {
    expect(copy.GENERATE_PROPOSAL_CTA).toBe("Generate proposal");
    expect(copy.SAVE_DRAFT_CTA).toBe("Save draft");
    expect(copy.APPROVE_AND_PUBLISH_CTA).toBe("Approve and publish…");
    expect(copy.PUBLISH_ARTICLE_CTA).toBe("Publish article");
    expect(copy.PROPOSE_KB_ARTICLE_ENTRY).toBe("Propose KB article…");
    expect(copy.ENTRY_UNAVAILABLE_AI_OFF).toBe(
      "AI is turned off for this workspace. An owner or admin can turn it on in Settings.",
    );
    expect(copy.ENTRY_UNAVAILABLE_TOO_MANY).toBe("Select 1 to 5 tickets to propose an article.");
    expect(copy.ENTRY_UNAVAILABLE_NOT_RESOLVED).toBe(
      "Only tickets with a status in the Resolved or Closed group can be used.",
    );
    expect(copy.ENTRY_UNAVAILABLE_MERGED).toBe(
      "This ticket was merged. Use the ticket it was merged into.",
    );
    expect(copy.START_TITLE).toBe("Propose a KB article");
    expect(copy.START_DESCRIPTION).toBe(
      "AIDA drafts an article from these tickets. Nothing is published until an owner or admin approves it.",
    );
    expect(copy.CUSTOMER_CONTENT_NOTICE).toBe(
      "These tickets contain your customers' messages. AIDA removes secrets such as API keys and card numbers, but not names, emails or other personal details. Remove them before you publish.",
    );
    expect(copy.START_INPUTS_LINE).toBe(
      "Only the subject and public replies are used. Internal notes and attachments are not.",
    );
    expect(copy.START_PENDING).toBe("Starting…");
    expect(copy.START_DISMISS).toBe("Close without starting");
    expect(copy.STARTED_TOAST).toBe("Proposal started. AIDA is drafting it now.");
  });

  it("selection refusal and per-ticket reasons", () => {
    expect(copy.NOTHING_WAS_CHANGED).toBe("Nothing was changed.");
    expect(copy.SELECTION_REFUSED_INTRO).toBe(
      "Some tickets can't be used. Close this dialog, change the selection, and try again.",
    );
    expect(copy.TICKET_REFUSAL_NOT_RESOLVED).toBe(
      "Its status is not in the Resolved or Closed group.",
    );
    expect(copy.ticketRefusalMerged(42)).toBe("Merged into #42. Use that ticket.");
    const parts = copy.ticketRefusalMergedParts(42);
    expect(parts.before + parts.target + parts.after).toBe("Merged into #42. Use that ticket.");
    expect(parts.target).toBe("#42");
    expect(copy.TICKET_REFUSAL_NOT_FOUND).toBe("No longer available.");
    expect(copy.TICKET_REFUSAL_DUPLICATE).toBe("Selected twice.");
  });

  it("start errors and outcome unknown", () => {
    expect(copy.START_ERROR_AI_OFF).toBe(
      "Nothing was changed. AI is turned off for this workspace.",
    );
    expect(copy.START_ERROR_COUNT).toBe("Nothing was changed. Select 1 to 5 tickets.");
    expect(copy.START_ERROR_NOT_ALLOWED).toBe(
      "Nothing was changed. Only workspace owners and admins can propose articles.",
    );
    expect(copy.START_ERROR_MEMBERSHIP_ENDED).toBe(MEMBERSHIP_ENDED_ROW);
    expect(copy.START_ERROR_UNKNOWN).toBe(
      "Nothing was changed. The proposal could not be started. Wait a moment and try again.",
    );
    expect(copy.START_OUTCOME_UNKNOWN).toBe(
      "The result is not known. A proposal may have been started. Open Proposals to check before you try again.",
    );
  });

  it("requestRefusalCopy maps every request code to its row", () => {
    for (const code of REQUEST_REFUSAL_CODES) {
      expect(copy.requestRefusalCopy(code).length).toBeGreaterThan(0);
    }
    expect(copy.requestRefusalCopy("AI_OFF")).toBe(copy.START_ERROR_AI_OFF);
    expect(copy.requestRefusalCopy("COUNT")).toBe(copy.START_ERROR_COUNT);
    expect(copy.requestRefusalCopy("NOT_ALLOWED")).toBe(copy.START_ERROR_NOT_ALLOWED);
    expect(copy.requestRefusalCopy("MEMBERSHIP_ENDED")).toBe(MEMBERSHIP_ENDED_ROW);
    expect(copy.requestRefusalCopy("SELECTION")).toBe(
      "Nothing was changed. Some tickets can't be used. Close this dialog, change the selection, and try again.",
    );
  });

  it("ticketRefusalCopy maps every ticket reason to its row", () => {
    for (const reason of TICKET_REFUSAL_REASONS) {
      expect(copy.ticketRefusalCopy(reason, 7).length).toBeGreaterThan(0);
    }
    expect(copy.ticketRefusalCopy("NOT_RESOLVED")).toBe(copy.TICKET_REFUSAL_NOT_RESOLVED);
    expect(copy.ticketRefusalCopy("MERGED", 7)).toBe("Merged into #7. Use that ticket.");
    // A MERGED refusal without its target number falls back to the merged entry row.
    expect(copy.ticketRefusalCopy("MERGED")).toBe(copy.ENTRY_UNAVAILABLE_MERGED);
    expect(copy.ticketRefusalCopy("NOT_FOUND")).toBe("No longer available.");
    expect(copy.ticketRefusalCopy("DUPLICATE")).toBe("Selected twice.");
  });
});

describe("proposal-copy: List (Surface 2)", () => {
  it("labels the five statuses as the 'Status labels' row", () => {
    // UI-SPEC: "Generating / Draft / Rejected / Published / Failed"
    expect(PROPOSAL_STATUSES.map((s) => copy.PROPOSAL_STATUS_LABELS[s]).join(" / ")).toBe(
      "Generating / Draft / Rejected / Published / Failed",
    );
  });

  it("page, empty, access and row rows", () => {
    expect(copy.PROPOSALS_LINK).toBe("Proposals");
    expect(copy.PROPOSALS_PAGE_TITLE).toBe("Article proposals");
    expect(copy.PROPOSALS_PAGE_DESCRIPTION).toBe(
      "Drafts AIDA wrote from resolved tickets. Only owners and admins see them, and none is in the knowledge base until it is published.",
    );
    expect(copy.BACK_TO_ARTICLES).toBe("Back to articles");
    expect(copy.LIST_AI_OFF_NOTICE).toBe(
      "AI is off, so no new proposals can be started. Existing drafts can still be reviewed, edited, rejected and published.",
    );
    expect(copy.UNTITLED_WHILE_GENERATING).toBe("Untitled (drafting…)");
    expect(copy.sourceCount(1)).toBe("1 ticket");
    expect(copy.sourceCount(2)).toBe("2 tickets");
    expect(copy.sourceCount(5)).toBe("5 tickets");
    expect(copy.LIST_EMPTY_HEADING).toBe("No proposals yet");
    expect(copy.LIST_EMPTY_BODY).toBe(
      'Select resolved tickets in the inbox and choose "Propose KB article…" to have AIDA draft one.',
    );
    expect(copy.GENERATION_FINISHED_ANNOUNCEMENT).toBe("A proposal finished drafting.");
    expect(copy.NOT_ALLOWED_HEADING).toBe("Owners and admins only");
    expect(copy.NOT_ALLOWED_BODY).toBe(
      "Only workspace owners and admins can review article proposals.",
    );
    expect(copy.MEMBERSHIP_ENDED).toBe(MEMBERSHIP_ENDED_ROW);
    expect(copy.NOT_FOUND_HEADING).toBe("Proposal not found");
    expect(copy.NOT_FOUND_BODY).toBe(
      "It may have been removed. Go back to Proposals to see the current list.",
    );
  });
});

describe("proposal-copy: Review (Surface 3)", () => {
  it("page, notices, editor and sources rows", () => {
    expect(copy.REVIEW_PAGE_TITLE).toBe("Review proposal");
    expect(copy.requestedByLine("Ada", "9 Nov 2026, 10:00")).toBe(
      "Requested by Ada · 9 Nov 2026, 10:00",
    );
    expect(copy.AI_NOTICE).toBe(
      "AI-generated draft. Review every fact before publishing. AIDA may get details wrong.",
    );
    expect(copy.sourceChangedNotice("#12, #14")).toBe(
      "#12, #14 changed after this draft was written. Check the draft still matches. It is never updated on its own.",
    );
    expect(copy.TRUNCATION_NOTICE).toBe(
      "Some messages were too long or too many and were left out of the draft. Read the source tickets for the full picture.",
    );
    expect(copy.TITLE_LABEL).toBe("Title");
    expect(copy.TITLE_HELP).toBe("3 to 120 characters.");
    expect(copy.BODY_LABEL).toBe("Body (Markdown)");
    // Amendment A2 adds "Links to tickets are not allowed."; amendment A6 (run decision K54)
    // adds "Images are not allowed." after it.
    expect(copy.BODY_HELP).toBe(
      "Source references such as [T1] are not allowed in the body; AIDA refuses to save or publish a body that contains them. Remove customer names, emails and other personal details. Links to tickets are not allowed. Images are not allowed.",
    );
    expect(copy.BODY_HELP).toContain("Links to tickets are not allowed.");
    expect(copy.BODY_HELP.endsWith("Images are not allowed.")).toBe(true);
    expect(copy.PREVIEW_TOGGLE).toBe("Preview");
    expect(copy.REJECT_TRIGGER).toBe("Reject…");
    expect(copy.SOURCES_HEADING).toBe("Sources");
    expect(copy.SOURCE_CHANGED_SHORT).toBe("Changed since drafting");
    expect(copy.citedIn("[T1], [T3]")).toBe("Cited in: [T1], [T3]");
    expect(copy.NOT_CITED).toBe("Not cited");
    expect(copy.SOURCE_UNAVAILABLE).toBe("This ticket is no longer available.");
    expect(copy.SOURCES_INTERNAL_NOTE).toBe(
      "Sources are internal and are never shown in the article.",
    );
  });

  it("field error rows, including amendment A2", () => {
    expect(copy.CITATION_MARKER_ERROR).toBe(
      "Nothing was changed. The body contains source references such as [T1]. Remove them, then save again.",
    );
    expect(copy.TITLE_CITATION_MARKER_ERROR).toBe(
      "Nothing was changed. The title contains source references such as [T1]. Remove them, then save again.",
    );
    expect(copy.TICKET_LINK_ERROR).toBe(
      "Nothing was changed. The body links to a ticket. Remove ticket links, then save again.",
    );
    // Amendment A6 (run decision K54) "Image error" (Body field).
    expect(copy.IMAGE_ERROR).toBe(
      "Nothing was changed. The body contains an image. Remove images, then save again.",
    );
    // UI-SPEC "Field errors": "Title must be at least 3 characters. / Title must be at most 120
    // characters. / Body is required."
    expect(copy.TITLE_TOO_SHORT_ERROR).toBe("Title must be at least 3 characters.");
    expect(copy.TITLE_TOO_LONG_ERROR).toBe("Title must be at most 120 characters.");
    expect(copy.BODY_REQUIRED_ERROR).toBe("Body is required.");
    // Amendment A8 (review a-IN-02): the Field errors row for a body over BODY_MAX.
    expect(copy.BODY_TOO_LONG_ERROR).toBe("Body must be at most 20,000 characters.");
  });

  it("fieldRefusalCopy maps by field and code (amendment A2, run decisions K51 and K52)", () => {
    expect(fieldRefusalCopy("title", "CITATION_MARKER")).toBe(copy.TITLE_CITATION_MARKER_ERROR);
    expect(fieldRefusalCopy("bodyMarkdown", "CITATION_MARKER")).toBe(copy.CITATION_MARKER_ERROR);
    expect(fieldRefusalCopy("bodyMarkdown", "TICKET_LINK")).toBe(copy.TICKET_LINK_ERROR);
    // A ticket link in the title reuses the title marker row: no separate UI-SPEC row (K52).
    expect(fieldRefusalCopy("title", "TICKET_LINK")).toBe(copy.TITLE_CITATION_MARKER_ERROR);
    expect(fieldRefusalCopy("title", "TITLE_TOO_SHORT")).toBe(copy.TITLE_TOO_SHORT_ERROR);
    expect(fieldRefusalCopy("title", "TITLE_TOO_LONG")).toBe(copy.TITLE_TOO_LONG_ERROR);
    expect(fieldRefusalCopy("bodyMarkdown", "BODY_REQUIRED")).toBe(copy.BODY_REQUIRED_ERROR);
    // Amendment A6: only the body produces IMAGE_NOT_ALLOWED; the title entry exists for totality.
    expect(fieldRefusalCopy("bodyMarkdown", "IMAGE_NOT_ALLOWED")).toBe(copy.IMAGE_ERROR);
    // Amendment A8: only the body produces BODY_TOO_LONG; the title entry exists for totality.
    expect(fieldRefusalCopy("bodyMarkdown", "BODY_TOO_LONG")).toBe(copy.BODY_TOO_LONG_ERROR);
    expect(fieldRefusalCopy("title", "BODY_TOO_LONG")).toBe(copy.BODY_TOO_LONG_ERROR);
    for (const field of PROPOSAL_FIELDS) {
      for (const code of PROPOSAL_FIELD_CODES) {
        expect(fieldRefusalCopy(field, code).length).toBeGreaterThan(0);
      }
    }
  });

  it("every validateDraftFields code is a review refusal code with a row (reviews C7, R2-2)", () => {
    // Type level: DraftFieldCode is a subset of ReviewRefusalCode.
    const asReview = (code: DraftFieldCode): ReviewRefusalCode => code;
    const cases: Array<{ title: string; bodyMarkdown: string }> = [
      { title: "ab", bodyMarkdown: "Body" },
      { title: "x".repeat(121), bodyMarkdown: "Body" },
      { title: "Reset [T1] guide", bodyMarkdown: "Body" },
      { title: "Reset guide https://help.example.com/tickets/abc", bodyMarkdown: "Body" },
      { title: "Reset guide", bodyMarkdown: "   " },
      { title: "Reset guide", bodyMarkdown: "See [T2] for details." },
      { title: "Reset guide", bodyMarkdown: "[g](/tickets/abc)" },
      { title: "Reset guide", bodyMarkdown: "![x](https://attacker.example/p.png)" },
      { title: "Reset guide", bodyMarkdown: "a".repeat(20001) },
    ];
    const seen = new Set<string>();
    for (const input of cases) {
      const result = validateDraftFields(input);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      seen.add(`${result.field}:${result.code}`);
      expect(REVIEW_REFUSAL_CODES).toContain(asReview(result.code));
      expect(PROPOSAL_FIELD_CODES).toContain(result.code);
      expect(fieldRefusalCopy(result.field, result.code).length).toBeGreaterThan(0);
    }
    expect([...seen].sort()).toEqual(
      [
        "title:TITLE_TOO_SHORT",
        "title:TITLE_TOO_LONG",
        "title:CITATION_MARKER",
        "title:TICKET_LINK",
        "bodyMarkdown:BODY_REQUIRED",
        "bodyMarkdown:CITATION_MARKER",
        "bodyMarkdown:TICKET_LINK",
        "bodyMarkdown:IMAGE_NOT_ALLOWED",
        "bodyMarkdown:BODY_TOO_LONG",
      ].sort(),
    );
  });

  it("the real validator's ticket-link refusals map to the A2 rows (K51, review R2-2)", () => {
    const title = validateDraftFields({
      title: "Reset guide https://help.example.com/tickets/abc",
      bodyMarkdown: "Body",
    });
    expect(title).toEqual({ ok: false, field: "title", code: "TICKET_LINK" });
    if (!title.ok) {
      expect(fieldRefusalCopy(title.field, title.code)).toBe(copy.TITLE_CITATION_MARKER_ERROR);
    }
    const body = validateDraftFields({ title: "Reset guide", bodyMarkdown: "[g](/tickets/abc)" });
    expect(body).toEqual({ ok: false, field: "bodyMarkdown", code: "TICKET_LINK" });
    if (!body.ok) {
      expect(fieldRefusalCopy(body.field, body.code)).toBe(copy.TICKET_LINK_ERROR);
    }
  });

  it("save rows and saveRefusalCopy over every review code", () => {
    expect(copy.SAVE_PENDING).toBe("Saving…");
    expect(copy.SAVED_TOAST).toBe("Draft saved. It is not published.");
    expect(copy.SAVE_ERROR_NOT_DRAFT).toBe(
      "Nothing was changed. This proposal is no longer a draft. Reload it to see its status.",
    );
    expect(copy.SAVE_ERROR_NOT_ALLOWED).toBe(
      "Nothing was changed. Only workspace owners and admins can edit proposals.",
    );
    expect(copy.SAVE_ERROR_UNKNOWN).toBe(
      "Nothing was changed. The draft could not be saved. Wait a moment and try again.",
    );
    expect(copy.SAVE_OUTCOME_UNKNOWN).toBe(
      "The result is not known. The draft may have been saved. Reload the proposal to check before you try again.",
    );
    expect(copy.CONFLICT).toBe(
      "Nothing was changed. Someone else changed this proposal after you opened it. Reload it to see their version. Your edits are still in the form; copy them first if you need them.",
    );
    expect(copy.RELOAD_BUTTON).toBe("Reload proposal");
    expect(copy.PUBLISH_UNAVAILABLE_UNSAVED).toBe("Save your changes first.");

    for (const code of REVIEW_REFUSAL_CODES) {
      expect(copy.saveRefusalCopy(code).length).toBeGreaterThan(0);
    }
    expect(copy.saveRefusalCopy("NOT_DRAFT")).toBe(copy.SAVE_ERROR_NOT_DRAFT);
    expect(copy.saveRefusalCopy("NOT_ALLOWED")).toBe(copy.SAVE_ERROR_NOT_ALLOWED);
    expect(copy.saveRefusalCopy("MEMBERSHIP_ENDED")).toBe(MEMBERSHIP_ENDED_ROW);
    expect(copy.saveRefusalCopy("CONFLICT")).toBe(copy.CONFLICT);
    expect(copy.saveRefusalCopy("NOT_FOUND")).toBe(
      "Nothing was changed. It may have been removed. Go back to Proposals to see the current list.",
    );
    expect(copy.saveRefusalCopy("CITATION_MARKER", "title")).toBe(copy.TITLE_CITATION_MARKER_ERROR);
    expect(copy.saveRefusalCopy("CITATION_MARKER")).toBe(copy.CITATION_MARKER_ERROR);
    expect(copy.saveRefusalCopy("TICKET_LINK", "title")).toBe(copy.TITLE_CITATION_MARKER_ERROR);
    expect(copy.saveRefusalCopy("TICKET_LINK")).toBe(copy.TICKET_LINK_ERROR);
    expect(copy.saveRefusalCopy("TITLE_TOO_SHORT")).toBe(copy.TITLE_TOO_SHORT_ERROR);
  });
});

describe("proposal-copy: Publish (3f)", () => {
  it("dialog rows, including amendment A1", () => {
    expect(copy.PUBLISH_TITLE).toBe("Publish this article?");
    expect(copy.publishDescription("Reset a password")).toBe(
      '"Reset a password" will be added to the knowledge base, where AIDA uses it to draft replies.',
    );
    expect(copy.PUBLISH_CHECKLIST.join(" / ")).toBe(
      "Facts are correct. / Customer names, emails and other personal details are removed. / Nothing in it is private to one customer.",
    );
    expect(copy.PUBLISH_CANNOT_BE_UNDONE).toBe(
      "Publishing can't be undone here. To change the article later, edit it in the knowledge base.",
    );
    expect(copy.PUBLISH_CONFIRM_CHECKBOX).toBe("I reviewed this draft and it is ready to publish.");
    expect(copy.KEEP_REVIEWING).toBe("Keep reviewing");
    expect(copy.PUBLISH_PENDING).toBe("Publishing…");
    expect(copy.PUBLISHED_TOAST).toBe("Article published. AIDA is indexing it now.");
    expect(copy.PUBLISHED_TOAST_INDEXING_NOT_STARTED).toBe(
      "Article published, but indexing did not start. Open the proposal and use Retry indexing.",
    );
    expect(copy.PUBLISH_ERROR_NOT_DRAFT).toBe(
      "This proposal is no longer a draft. Reload it to see its status.",
    );
    expect(copy.PUBLISH_ERROR_NOT_ALLOWED).toBe("Only workspace owners and admins can publish.");
    expect(copy.PUBLISH_ERROR_UNKNOWN).toBe(
      "The article could not be published. Wait a moment and try again.",
    );
    expect(copy.PUBLISH_OUTCOME_UNKNOWN).toBe(
      "The result is not known. The article may have been published. Reload the proposal to check before you try again.",
    );
  });

  it("publishRefusalCopy puts the callout prefix before the unprefixed publish rows", () => {
    for (const code of REVIEW_REFUSAL_CODES) {
      expect(copy.publishRefusalCopy(code).length).toBeGreaterThan(0);
    }
    expect(copy.publishRefusalCopy("NOT_DRAFT")).toBe(`${PREFIX} ${copy.PUBLISH_ERROR_NOT_DRAFT}`);
    expect(copy.publishRefusalCopy("NOT_ALLOWED")).toBe(
      `${PREFIX} ${copy.PUBLISH_ERROR_NOT_ALLOWED}`,
    );
    expect(copy.publishRefusalCopy("CONFLICT")).toBe(copy.CONFLICT);
    expect(copy.publishRefusalCopy("MEMBERSHIP_ENDED")).toBe(MEMBERSHIP_ENDED_ROW);
    expect(copy.publishRefusalCopy("TICKET_LINK", "bodyMarkdown")).toBe(copy.TICKET_LINK_ERROR);
    // Review a-IN-03: the exhausted slug retry.
    expect(copy.publishRefusalCopy("SLUG_UNAVAILABLE")).toBe(
      `${PREFIX} ${copy.PUBLISH_ERROR_UNKNOWN}`,
    );
  });
});

describe("proposal-copy: Reject (3g)", () => {
  it("dialog rows", () => {
    expect(copy.REJECT_TITLE).toBe("Reject this proposal?");
    expect(copy.REJECT_DESCRIPTION).toBe(
      "It stays in the list as rejected and can never be published. To try again, start a new proposal.",
    );
    expect(copy.KEEP_PROPOSAL).toBe("Keep proposal");
    expect(copy.REJECT_PROPOSAL).toBe("Reject proposal");
    expect(copy.REJECT_PENDING).toBe("Rejecting…");
    expect(copy.REJECTED_TOAST).toBe("Proposal rejected.");
    expect(copy.REJECT_ERROR_NOT_DRAFT).toBe(
      "This proposal is no longer a draft. Reload it to see its status.",
    );
    expect(copy.REJECT_ERROR_NOT_ALLOWED).toBe(
      "Only workspace owners and admins can reject proposals.",
    );
    expect(copy.REJECT_ERROR_UNKNOWN).toBe(
      "The proposal could not be rejected. Wait a moment and try again.",
    );
    expect(copy.REJECT_OUTCOME_UNKNOWN).toBe(
      "The result is not known. The proposal may have been rejected. Reload it to check before you try again.",
    );
  });

  it("rejectRefusalCopy puts the callout prefix before the unprefixed reject rows", () => {
    for (const code of REVIEW_REFUSAL_CODES) {
      expect(copy.rejectRefusalCopy(code).length).toBeGreaterThan(0);
    }
    expect(copy.rejectRefusalCopy("NOT_DRAFT")).toBe(`${PREFIX} ${copy.REJECT_ERROR_NOT_DRAFT}`);
    expect(copy.rejectRefusalCopy("NOT_ALLOWED")).toBe(
      `${PREFIX} ${copy.REJECT_ERROR_NOT_ALLOWED}`,
    );
    expect(copy.rejectRefusalCopy("CONFLICT")).toBe(copy.CONFLICT);
    expect(copy.rejectRefusalCopy("MEMBERSHIP_ENDED")).toBe(MEMBERSHIP_ENDED_ROW);
  });
});

describe("proposal-copy: Generation (3e)", () => {
  it("generating, stuck, terminal notices and new proposal rows", () => {
    expect(copy.GENERATING_BODY).toBe(
      "AIDA is drafting this article. This page updates on its own.",
    );
    expect(copy.STUCK_NOTICE).toBe(
      "This draft is taking longer than expected. You can restart it; this may call your AI provider again.",
    );
    expect(copy.RESTART_GENERATION).toBe("Restart generation");
    expect(copy.NEW_PROPOSAL_BUTTON).toBe("Start a new proposal");
    expect(copy.rejectedNotice("Ada", "9 Nov 2026")).toBe(
      "Rejected by Ada · 9 Nov 2026. This proposal can't be published.",
    );
    expect(copy.publishedNotice("Ada", "9 Nov 2026")).toBe("Published by Ada · 9 Nov 2026.");
    expect(copy.OPEN_ARTICLE).toBe("Open article");
  });

  it("failure rows, full and short", () => {
    expect(copy.FAILURE_AI_OFF).toBe(
      "AI was turned off before drafting started. Turn it on, then start a new proposal.",
    );
    expect(copy.FAILURE_SOURCE_CHANGED).toBe(
      "A source ticket was reopened or merged before drafting. Start a new proposal with the current tickets.",
    );
    expect(copy.FAILURE_PROVIDER).toBe(
      "Your AI provider did not answer. Check Settings → AI, then start a new proposal.",
    );
    expect(copy.FAILURE_INVALID_OUTPUT).toBe(
      "The AI answer could not be used. Start a new proposal; a different selection may help.",
    );
    expect(copy.FAILURE_CONFIGURATION).toBe(
      "AI is not set up correctly. Check Settings → AI, then start a new proposal.",
    );
    expect(copy.FAILURE_UNKNOWN).toBe("Drafting failed. Start a new proposal.");
    // UI-SPEC "Failure short (list)": Provider error / Unusable answer / Setup problem /
    // Source changed / AI was off / Failed
    expect(
      [
        copy.FAILURE_SHORT_PROVIDER,
        copy.FAILURE_SHORT_INVALID_OUTPUT,
        copy.FAILURE_SHORT_CONFIGURATION,
        copy.FAILURE_SHORT_SOURCE_CHANGED,
        copy.FAILURE_SHORT_AI_OFF,
        copy.FAILURE_SHORT_UNKNOWN,
      ].join(" / "),
    ).toBe(
      "Provider error / Unusable answer / Setup problem / Source changed / AI was off / Failed",
    );
  });

  it("failureFullCopy and failureShortCopy over every failure code", () => {
    for (const code of PROPOSAL_FAILURE_CODES) {
      expect(copy.failureFullCopy(code).length).toBeGreaterThan(0);
      expect(copy.failureShortCopy(code).length).toBeGreaterThan(0);
    }
    expect(copy.failureFullCopy("AI_OFF")).toBe(copy.FAILURE_AI_OFF);
    expect(copy.failureFullCopy("SOURCE_CHANGED")).toBe(copy.FAILURE_SOURCE_CHANGED);
    expect(copy.failureFullCopy("PROVIDER")).toBe(copy.FAILURE_PROVIDER);
    expect(copy.failureFullCopy("INVALID_OUTPUT")).toBe(copy.FAILURE_INVALID_OUTPUT);
    expect(copy.failureFullCopy("CONFIGURATION")).toBe(copy.FAILURE_CONFIGURATION);
    expect(copy.failureFullCopy("REQUESTER_NOT_ALLOWED")).toBe(
      "Drafting failed. Start a new proposal.",
    );
    expect(copy.failureFullCopy("UNKNOWN")).toBe("Drafting failed. Start a new proposal.");
    expect(copy.failureShortCopy("PROVIDER")).toBe("Provider error");
    expect(copy.failureShortCopy("INVALID_OUTPUT")).toBe("Unusable answer");
    expect(copy.failureShortCopy("CONFIGURATION")).toBe("Setup problem");
    expect(copy.failureShortCopy("SOURCE_CHANGED")).toBe("Source changed");
    expect(copy.failureShortCopy("AI_OFF")).toBe("AI was off");
    expect(copy.failureShortCopy("REQUESTER_NOT_ALLOWED")).toBe("Failed");
    expect(copy.failureShortCopy("UNKNOWN")).toBe("Failed");
  });
});

describe("proposal-copy: Maintenance (restart and retry indexing)", () => {
  it("retry and restart rows, including amendments A1, A3 and A5", () => {
    expect(copy.RETRY_INDEXING).toBe("Retry indexing");
    expect(copy.RETRY_INDEXING_PENDING_LABEL).toBe("Retrying…");
    expect(copy.INDEXING_RESTARTED).toBe("Indexing restarted.");
    expect(copy.RETRY_INDEXING_PENDING_HINT).toBe(
      "Indexing has not finished. If it stays Pending, retry.",
    );
    expect(copy.RESTART_RETRY_ERROR).toBe("Nothing was changed. Wait a moment and try again.");
    expect(copy.RESTART_OUTCOME_UNKNOWN).toBe(
      "The result is not known. Generation may have restarted. Reload the proposal to check before you try again.",
    );
    expect(copy.RETRY_INDEXING_OUTCOME_UNKNOWN).toBe(
      "The result is not known. Indexing may have restarted. Reload the proposal to check before you try again.",
    );
    expect(copy.RESTART_RECORDED_NOT_STARTED).toBe(
      "Restart was recorded, but generation did not start. You can restart again in 10 minutes.",
    );
    expect(copy.RETRY_RECORDED_NOT_STARTED).toBe(
      "Retry was recorded, but indexing did not start. Try Retry indexing again in a moment.",
    );
  });

  it("maintenanceRefusalCopy maps every restart and retry code", () => {
    for (const code of MAINTENANCE_REFUSAL_CODES) {
      const row = copy.maintenanceRefusalCopy(code);
      expect(row).toBe(
        code === "MEMBERSHIP_ENDED" ? MEMBERSHIP_ENDED_ROW : copy.RESTART_RETRY_ERROR,
      );
    }
  });
});

describe("proposal-copy: outcome unknown and the four '… error: unknown' rows (amendment A4)", () => {
  it("outcomeUnknownCopy gives each action its outcome-unknown row", () => {
    expect(PROPOSAL_ACTIONS).toEqual([
      "start",
      "save",
      "publish",
      "reject",
      "restart",
      "retryIndexing",
    ]);
    expect(outcomeUnknownCopy("start")).toBe(copy.START_OUTCOME_UNKNOWN);
    expect(outcomeUnknownCopy("save")).toBe(copy.SAVE_OUTCOME_UNKNOWN);
    expect(outcomeUnknownCopy("publish")).toBe(copy.PUBLISH_OUTCOME_UNKNOWN);
    expect(outcomeUnknownCopy("reject")).toBe(copy.REJECT_OUTCOME_UNKNOWN);
    expect(outcomeUnknownCopy("restart")).toBe(copy.RESTART_OUTCOME_UNKNOWN);
    expect(outcomeUnknownCopy("retryIndexing")).toBe(copy.RETRY_INDEXING_OUTCOME_UNKNOWN);
  });

  it("only SLUG_UNAVAILABLE maps to a '… error: unknown' row (the publish row, prefixed); the rows exist verbatim", () => {
    expect([
      copy.START_ERROR_UNKNOWN,
      copy.SAVE_ERROR_UNKNOWN,
      copy.PUBLISH_ERROR_UNKNOWN,
      copy.REJECT_ERROR_UNKNOWN,
    ]).toEqual(ERROR_UNKNOWN_ROWS);
    const mapped = everyMappedRow();
    for (const row of ERROR_UNKNOWN_ROWS) expect(mapped).not.toContain(row);
    // Review a-IN-03 changed this expectation for the publish row only: the exhausted slug retry
    // is a known outcome (nothing was published), so it shows "Publish error: unknown".
    const slug = copy.publishRefusalCopy("SLUG_UNAVAILABLE");
    expect(slug).toBe(`${PREFIX} ${copy.PUBLISH_ERROR_UNKNOWN}`);
    expect(mapped.filter((m) => m.includes(copy.PUBLISH_ERROR_UNKNOWN))).toEqual([slug]);
    for (const row of [
      copy.START_ERROR_UNKNOWN,
      copy.SAVE_ERROR_UNKNOWN,
      copy.REJECT_ERROR_UNKNOWN,
    ]) {
      expect(mapped.some((m) => m.includes(row))).toBe(false);
    }
  });
});

describe("proposal-copy: the 'Nothing was changed.' rule", () => {
  // Rows that carry the prefix themselves (as the UI-SPEC writes them): Start error AI off,
  // count, not allowed (and unknown); Citation marker error, Title citation marker error, Ticket
  // link error; Save error not draft, not allowed (and unknown); Conflict; Restart / Retry error.
  // Rows written without it that a mapping prefixes: Selection refused intro, Publish error and
  // Reject error rows, and the Not found body (the prefix is composed by the mapping, so the
  // dialog renders the message as is). Returned without the prefix: the rows that start with
  // "Your access" (Start error: membership ended, Membership ended), the terminal-state Failure
  // rows (full and short), the outcome-unknown rows (the result is not known, so "nothing was
  // changed" would be false) and the Field errors rows, shown as inline field messages under the
  // field exactly as the UI-SPEC row reads.
  it("every refusal row returned by a refusal mapping starts with the prefix, with the named exceptions", () => {
    const fieldRows = new Set([
      copy.TITLE_TOO_SHORT_ERROR,
      copy.TITLE_TOO_LONG_ERROR,
      copy.BODY_REQUIRED_ERROR,
      copy.BODY_TOO_LONG_ERROR,
    ]);
    const refusalRows: string[] = [];
    for (const code of REQUEST_REFUSAL_CODES) refusalRows.push(copy.requestRefusalCopy(code));
    for (const code of REVIEW_REFUSAL_CODES) {
      for (const field of [undefined, ...PROPOSAL_FIELDS]) {
        refusalRows.push(copy.saveRefusalCopy(code, field));
        refusalRows.push(copy.publishRefusalCopy(code, field));
        refusalRows.push(copy.rejectRefusalCopy(code, field));
      }
    }
    for (const code of MAINTENANCE_REFUSAL_CODES)
      refusalRows.push(copy.maintenanceRefusalCopy(code));
    for (const row of refusalRows) {
      if (row.startsWith("Your access") || fieldRows.has(row)) continue;
      expect(row.startsWith(`${PREFIX} `)).toBe(true);
      expect(row.indexOf(PREFIX, 1)).toBe(-1);
    }
  });

  it("names the rows that carry the prefix themselves and those that never do", () => {
    const prefixed = [
      copy.START_ERROR_AI_OFF,
      copy.START_ERROR_COUNT,
      copy.START_ERROR_NOT_ALLOWED,
      copy.START_ERROR_UNKNOWN,
      copy.CITATION_MARKER_ERROR,
      copy.TITLE_CITATION_MARKER_ERROR,
      copy.TICKET_LINK_ERROR,
      copy.IMAGE_ERROR,
      copy.SAVE_ERROR_NOT_DRAFT,
      copy.SAVE_ERROR_NOT_ALLOWED,
      copy.SAVE_ERROR_UNKNOWN,
      copy.CONFLICT,
      copy.RESTART_RETRY_ERROR,
    ];
    for (const row of prefixed) expect(row.startsWith(`${PREFIX} `)).toBe(true);
    const unprefixed = [
      copy.SELECTION_REFUSED_INTRO,
      copy.PUBLISH_ERROR_NOT_DRAFT,
      copy.PUBLISH_ERROR_NOT_ALLOWED,
      copy.PUBLISH_ERROR_UNKNOWN,
      copy.REJECT_ERROR_NOT_DRAFT,
      copy.REJECT_ERROR_NOT_ALLOWED,
      copy.REJECT_ERROR_UNKNOWN,
      copy.START_ERROR_MEMBERSHIP_ENDED,
      copy.MEMBERSHIP_ENDED,
      ...PROPOSAL_FAILURE_CODES.map((c) => copy.failureFullCopy(c)),
      ...PROPOSAL_ACTIONS.map((a) => outcomeUnknownCopy(a)),
    ];
    for (const row of unprefixed) expect(row.startsWith(PREFIX)).toBe(false);
  });

  it("no mapped row carries an id, a code or a raw error (D-03, D-12)", () => {
    for (const row of everyMappedRow()) {
      expect(row).not.toMatch(/\b[A-Z]{2,}_[A-Z_]+\b/);
      expect(row).not.toMatch(/undefined|null|Error:|\{|\}/);
    }
  });
});

describe("KbProposalStatusChip source", () => {
  it("uses token classes only: no hex, oklch or rgb colour", () => {
    expect(CHIP_SOURCE).not.toContain("#");
    expect(CHIP_SOURCE).not.toContain("oklch(");
    expect(CHIP_SOURCE).not.toContain("rgb(");
  });

  it("takes its words from proposal-copy and pairs each status with the UI-SPEC icon", () => {
    expect(CHIP_SOURCE).toContain('from "@/lib/kb/proposal-copy"');
    for (const icon of ["Loader2", "FileText", "X", "Check", "CircleAlert"]) {
      expect(CHIP_SOURCE).toContain(`icon: ${icon}`);
    }
    expect(CHIP_SOURCE).toContain("motion-reduce:animate-none");
    expect(CHIP_SOURCE).toContain("h-5 gap-1 px-2 py-0.5 text-[12px]");
  });
});
