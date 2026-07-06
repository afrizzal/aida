// Outbound MIME composer (D-22/D-23): multipart/alternative (raw markdown text part + an
// email-safe HTML part), bracket-consistent Message-IDs, and threading headers.
//
// Imported by BOTH the Next.js app AND the worker (email-outbound-send job) — worker-bundleable,
// so this file's own imports MUST stay relative/bare (no `@/`).
import { randomBytes } from "node:crypto";
import { renderMarkdown } from "../../markdown/render";

/**
 * Generates a bracketed outbound Message-ID, e.g. `<a1b2c3...@mail.example.com>` — matching
 * the exact bracket format mailparser produces for inbound In-Reply-To/References (RESEARCH.md
 * Pitfall 1: a bracket-format mismatch silently breaks threading for every reply).
 */
export function buildOutboundMessageId(domain: string): string {
  return `<${randomBytes(16).toString("hex")}@${domain}>`;
}

/**
 * Wraps rendered HTML in a minimal, email-safe document using INLINE literal styles only —
 * no Tailwind classes, no CSS custom properties. Third-party mail clients (Gmail, Outlook,
 * Apple Mail) cannot load either, so this intentionally does NOT follow DESIGN-SYSTEM.md
 * (03-UI-SPEC.md scope note: this wrapper is out of scope for the design contract).
 */
export function wrapEmailSafeHtml(inner: string): string {
  return `<html><body style="margin:0;padding:16px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1a1a1a;">${inner}</body></html>`;
}

export interface OutboundMail {
  fromAddress: string;
  fromName: string;
  to: string;
  subject: string;
  bodyMarkdown: string;
  messageId: string;
  inReplyTo?: string | null;
  references?: string[];
}

/**
 * Builds a plain object suitable for both `transporter.sendMail(...)` and nodemailer's
 * `MailComposer` — nodemailer auto-produces multipart/alternative whenever both `text` and
 * `html` are supplied. No quoted history is appended (D-22 — v1 relies on threading headers
 * plus the recipient's own mail client).
 */
export function composeMail(m: OutboundMail) {
  return {
    from: { name: m.fromName, address: m.fromAddress },
    to: m.to,
    subject: m.subject,
    text: m.bodyMarkdown,
    html: wrapEmailSafeHtml(renderMarkdown(m.bodyMarkdown)),
    messageId: m.messageId,
    inReplyTo: m.inReplyTo ?? undefined,
    references: (m.references ?? []).slice(-10).join(" ") || undefined,
  };
}
