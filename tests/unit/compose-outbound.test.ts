import { simpleParser } from "mailparser";
// nodemailer's MailComposer isn't re-exported from the package root — import the subpath
// directly (a documented/common nodemailer usage pattern for building raw MIME without a
// live SMTP transport).
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { describe, expect, it } from "vitest";
import { buildOutboundMessageId, composeMail, wrapEmailSafeHtml } from "../../src/lib/channels/email/compose-outbound";

describe("compose-outbound", () => {
  it("buildOutboundMessageId returns a bracketed id containing the domain", () => {
    const id = buildOutboundMessageId("mail.example.com");
    expect(id.startsWith("<")).toBe(true);
    expect(id.endsWith(">")).toBe(true);
    expect(id).toContain("@mail.example.com");
  });

  it("round-trips the Message-ID bracket-exact through MailComposer -> simpleParser (Pitfall 1)", async () => {
    const messageId = buildOutboundMessageId("mail.example.com");
    const mail = composeMail({
      fromAddress: "support@example.com",
      fromName: "Acme Support",
      to: "customer@example.com",
      subject: "Re: Something broke [#42]",
      bodyMarkdown: "Thanks for reaching out — we're looking into it.",
      messageId,
    });

    const composer = new MailComposer(mail);
    const raw = await composer.compile().build();
    const parsed = await simpleParser(raw);

    expect(parsed.messageId).toBe(messageId);
  });

  it("produces both a text and an html part (multipart/alternative)", async () => {
    const messageId = buildOutboundMessageId("mail.example.com");
    const mail = composeMail({
      fromAddress: "support@example.com",
      fromName: "Acme Support",
      to: "customer@example.com",
      subject: "Re: Something broke [#42]",
      bodyMarkdown: "**Bold** update on your ticket.",
      messageId,
    });

    const composer = new MailComposer(mail);
    const raw = await composer.compile().build();
    const parsed = await simpleParser(raw);

    expect(parsed.text).toBeTruthy();
    expect(parsed.html).toBeTruthy();
  });

  it("wrapEmailSafeHtml wraps inner HTML in an inline-styled html/body document", () => {
    const wrapped = wrapEmailSafeHtml("<p>hi</p>");
    expect(wrapped).toContain("<html>");
    expect(wrapped).toContain("<body");
    expect(wrapped).toContain('style="');
    expect(wrapped).toContain("<p>hi</p>");
    expect(wrapped).toContain("</body></html>");
    // Email-safe: no Tailwind classes / CSS variables that third-party mail clients can't load.
    expect(wrapped).not.toContain("class=");
    expect(wrapped).not.toContain("var(--");
  });
});
