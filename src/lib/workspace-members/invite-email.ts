// The invitation email (Phase 10, AIDA-42, D-06, D-26, R2-5). It goes through the organization's
// existing SMTP transport (channels/email/smtp-client.ts) with its configured from address: no
// new egress destination. Plain text, the UI-SPEC subject and body verbatim.
//
// Result semantics (R2-5): `sent` only when the awaited sendMail resolved with the invited
// address in info.accepted and info.rejected empty. A rejected RCPT, a rejected DATA command, a
// rejected message after the terminator, a dropped connection, a timeout or any other error is
// `send_failed`; email disabled, or no SMTP host or from address configured, is `smtp_off`. The
// caller (createInvitation) returns the copyable link for both of those (D-06).
//
// Nothing here logs: the body carries the link token (threat T-10-21), and SMTP errors can echo
// addresses.
//
// Relative imports only and no framework import.
import { getEmailSettings } from "../channels/email/settings";
import { createSmtpTransport } from "../channels/email/smtp-client";
import type { scopedDb } from "../scoped-db";

export type InvitationEmailStatus = "sent" | "smtp_off" | "send_failed";

/** UI-SPEC Copywriting "Invitation email subject". */
export const INVITATION_EMAIL_SUBJECT = "You've been invited to an AIDA workspace";

export interface InvitationEmailContent {
  inviterName: string;
  workspaceName: string;
  role: string;
  link: string;
  expiresAt: Date;
}

const EXPIRY_FORMAT = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "UTC",
});

/** The expiry as the body states it, for example "20 November 2026 at 04:52 UTC". */
export function formatInvitationExpiry(expiresAt: Date): string {
  return `${EXPIRY_FORMAT.format(expiresAt)} UTC`;
}

/** UI-SPEC Copywriting "Invitation email body", verbatim with its placeholders filled. */
export function invitationEmailBody({
  inviterName,
  workspaceName,
  role,
  link,
  expiresAt,
}: InvitationEmailContent): string {
  return `${inviterName} invited you to join ${workspaceName} on AIDA as ${role}. Open this link to join: ${link}. The link works once and expires on ${formatInvitationExpiry(expiresAt)}. If you did not expect this, ignore this email.`;
}

export interface SendInvitationEmailInput extends InvitationEmailContent {
  /** The invited address (already normalised and validated by createInvitation). */
  to: string;
}

/** The settings delegate getEmailSettings needs: a scopedDb client of the inviting organization. */
type SettingDb = Pick<ReturnType<typeof scopedDb>, "setting">;

/** Test seam: the per-send timeout of the transport (production uses the transport default). */
export interface SendInvitationEmailOptions {
  timeoutMs?: number;
}

/**
 * Sends the invitation email through the organization's SMTP settings. Never throws: every
 * failure is a status (see the header).
 */
export async function sendInvitationEmail(
  db: SettingDb,
  { to, ...content }: SendInvitationEmailInput,
  options: SendInvitationEmailOptions = {},
): Promise<InvitationEmailStatus> {
  let settings: Awaited<ReturnType<typeof getEmailSettings>>;
  try {
    settings = await getEmailSettings(db);
  } catch {
    return "send_failed";
  }
  if (!settings.enabled || settings.smtpHost.trim() === "" || settings.fromAddress.trim() === "") {
    return "smtp_off";
  }

  const transport = createSmtpTransport(
    settings,
    options.timeoutMs === undefined ? undefined : { timeoutMs: options.timeoutMs },
  );
  try {
    const info = await transport.sendMail({
      from: settings.fromAddress,
      to,
      subject: INVITATION_EMAIL_SUBJECT,
      text: invitationEmailBody(content),
    });
    const wanted = to.trim().toLowerCase();
    const accepted = (info.accepted ?? []).map((a) =>
      (typeof a === "string" ? a : a.address).trim().toLowerCase(),
    );
    const rejected = info.rejected ?? [];
    return accepted.includes(wanted) && rejected.length === 0 ? "sent" : "send_failed";
  } catch {
    return "send_failed";
  } finally {
    transport.close();
  }
}
