// One digest email on a socket the sender owns (Phase 10, AIDA-46, V-29, R2-5).
//
// nodemailer's socketTimeout is an inactivity timeout: a server that trickles one byte at a time
// keeps a send alive for as long as it likes, and SMTPTransport.close() does not touch a live
// connection. So the sender opens the TCP connection itself with node:net, hands it to nodemailer
// through createSmtpTransport's `getSocket` option (every other transport option, host, port,
// secure, auth and the timeouts, stays exactly what createSmtpTransport sets; nodemailer still
// does implicit TLS and STARTTLS on that socket), and destroys it when the deadline passes. It
// then awaits sendMail to settle, so no send is ever abandoned while it goes on.
//
// Outcome (R2-5), decided only from the awaited sendMail:
//   accepted   sendMail resolved with the recipient in info.accepted and info.rejected empty;
//   rejected   a definitive SMTP reply: an error with a reply code 400 to 599 (AUTH, RCPT, the
//              DATA command or the final reply after the data), or the recipient in
//              info.rejected. Three kinds:
//              - `configuration` (run decision K179): the server refused the workspace's SMTP
//                setup, not this recipient, so the operator can fix it and nothing is lost: a
//                failed login (nodemailer's EAUTH with a 5xx reply or with none, its own
//                "Missing credentials" check included), an authentication reply code (530, 534,
//                535, 538, RFC 4954) at any command, a server that does not accept mail (521 or
//                556, RFC 7504, or a 5xx greeting), or a 5xx reply to MAIL FROM (the from
//                address). The batch is released, and the caller stops that workspace's run;
//              - `permanent` (run decision K170): any other 5xx reply, which concerns this
//                recipient or this message (550 at RCPT, 554 after the data): the batch is then
//                closed instead of sent again;
//              - transient: a 4xx reply, or a rejected recipient with no code. A rejected
//                recipient of a resolved send is never `configuration`;
//   ambiguous  everything else: the deadline, a dropped connection, a timeout, an error with no
//              reply code. The server may have accepted the message.
// A send cut off by the deadline is always ambiguous, even if a partial reply was read.
//
// The message carries `Auto-Submitted: auto-generated` (RFC 3834; K170, review c-IN-06): an
// auto-responder does not answer it, and AIDA's own inbound path treats such mail as automatic, so
// it never opens or reopens a ticket (auto-generated.ts, D-13).
//
// Nothing here logs: errors can echo addresses. A failed send's error is handed back as
// digestErrorLabel (class and codes only) for the caller's log line. Relative imports only: the
// worker bundles it.
import net from "node:net";
import {
  createSmtpTransport,
  type SmtpConnectionConfig,
  type SmtpGetSocket,
} from "../channels/email/smtp-client";
import { digestErrorLabel } from "./digest-log";

/** RFC 3834 headers of every digest. */
export const DIGEST_MAIL_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "Auto-Submitted": "auto-generated",
});

export type DigestSendOutcome = "accepted" | "rejected" | "ambiguous";

export interface DigestSendResult {
  outcome: DigestSendOutcome;
  /** The SMTP reply code of a failed send, when nodemailer reported one. */
  responseCode?: number;
  /** For `rejected`: true for a 5xx reply about this recipient or message (K170). */
  permanent?: boolean;
  /** For `rejected`: true when the server refused the SMTP setup, not the recipient (K179). */
  configuration?: boolean;
  /** For a failed send: digestErrorLabel of the error (class and codes only). */
  errorLabel?: string;
  /** True when the deadline destroyed the socket. */
  deadlineReached: boolean;
  /** Milliseconds from the call to the settled sendMail. */
  elapsedMs: number;
}

export interface DigestMail {
  from: string;
  to: string;
  subject: string;
  text: string;
}

export interface SendDigestMailOptions {
  /** Wall-clock bound on the whole send, from this call; the socket is destroyed when it passes. */
  deadlineMs: number;
  /** nodemailer's connection, greeting and socket timeout, and the TCP connect timeout. */
  timeoutMs: number;
}

function normalise(address: unknown): string {
  const value =
    typeof address === "string"
      ? address
      : address && typeof address === "object" && "address" in address
        ? String((address as { address: unknown }).address)
        : "";
  return value.trim().toLowerCase();
}

/** RFC 4954 authentication replies: 530 required, 534 mechanism too weak, 535 invalid, 538 TLS. */
const AUTH_REPLY_CODES: ReadonlySet<number> = new Set([530, 534, 535, 538]);
/** RFC 7504: 521 the host does not accept mail, 556 the domain does not accept mail. */
const NOT_ACCEPTING_REPLY_CODES: ReadonlySet<number> = new Set([521, 556]);

/**
 * K179: whether a failed send's error is a refusal of the workspace's SMTP setup (see the header),
 * from nodemailer's error code, the failed command and the reply code only.
 */
function isConfigurationFailure(error: unknown, code: number | undefined): boolean {
  const { code: type, command } = (error ?? {}) as { code?: unknown; command?: unknown };
  if (type === "EAUTH") return code === undefined || code >= 500;
  if (code === undefined || code < 500) return false;
  if (AUTH_REPLY_CODES.has(code) || NOT_ACCEPTING_REPLY_CODES.has(code)) return true;
  return command === "CONN" || command === "MAIL FROM";
}

/**
 * Classifies a settled sendMail (R2-5, K170, K179). Exported so the TLS-equivalence tests apply
 * the same rule to createSmtpTransport's own sends.
 */
export function classifySendResult(
  to: string,
  settled:
    | {
        ok: true;
        info: { accepted?: unknown[]; rejected?: unknown[]; rejectedErrors?: unknown[] };
      }
    | { ok: false; error: unknown },
): {
  outcome: DigestSendOutcome;
  responseCode?: number;
  permanent?: boolean;
  configuration?: boolean;
} {
  const wanted = to.trim().toLowerCase();
  if (settled.ok) {
    const accepted = (settled.info.accepted ?? []).map(normalise);
    const rejected = (settled.info.rejected ?? []).map(normalise);
    if (rejected.includes(wanted)) {
      const entry = (settled.info.rejectedErrors ?? []).find(
        (e) => normalise((e as { recipient?: unknown } | null)?.recipient) === wanted,
      ) as { responseCode?: unknown } | undefined;
      const code = typeof entry?.responseCode === "number" ? entry.responseCode : undefined;
      if (code !== undefined && code >= 400 && code <= 599) {
        return { outcome: "rejected", responseCode: code, permanent: code >= 500 };
      }
      return { outcome: "rejected", permanent: false };
    }
    if (accepted.includes(wanted) && rejected.length === 0) return { outcome: "accepted" };
    return { outcome: "ambiguous" };
  }
  const error = settled.error as { responseCode?: unknown } | null;
  const code = typeof error?.responseCode === "number" ? error.responseCode : undefined;
  const reply = code !== undefined && code >= 400 && code <= 599 ? code : undefined;
  if (isConfigurationFailure(settled.error, reply)) {
    return reply === undefined
      ? { outcome: "rejected", permanent: false, configuration: true }
      : { outcome: "rejected", responseCode: reply, permanent: false, configuration: true };
  }
  if (reply !== undefined)
    return { outcome: "rejected", responseCode: reply, permanent: reply >= 500 };
  return code === undefined
    ? { outcome: "ambiguous" }
    : { outcome: "ambiguous", responseCode: code };
}

/** Sends one message through the configured SMTP on an owned socket; never throws. */
export async function sendDigestMail(
  settings: SmtpConnectionConfig,
  mail: DigestMail,
  { deadlineMs, timeoutMs }: SendDigestMailOptions,
): Promise<DigestSendResult> {
  const started = Date.now();
  let socket: net.Socket | null = null;
  let deadlineReached = false;

  const timer = setTimeout(
    () => {
      deadlineReached = true;
      socket?.destroy();
    },
    Math.max(0, deadlineMs),
  );

  const getSocket: SmtpGetSocket = (_options, callback) => {
    if (deadlineReached) {
      callback(new Error("digest send deadline reached before connecting"), undefined);
      return;
    }
    const s = net.connect({ host: settings.smtpHost, port: settings.smtpPort });
    socket = s;
    // nodemailer attaches its own handlers; this one only keeps a late error from being unhandled.
    s.on("error", () => {});
    let handedOver = false;
    const finish = (error: Error | null) => {
      if (handedOver) return;
      handedOver = true;
      s.setTimeout(0);
      s.off("connect", onConnect);
      s.off("close", onClose);
      s.off("timeout", onTimeout);
      if (error) {
        s.destroy();
        callback(error, undefined);
      } else {
        callback(null, { connection: s });
      }
    };
    const onConnect = () => finish(null);
    const onClose = () => finish(new Error("SMTP connection closed before it was established"));
    const onTimeout = () => finish(new Error("SMTP connection timed out"));
    s.once("connect", onConnect);
    s.once("close", onClose);
    s.setTimeout(timeoutMs, onTimeout);
  };

  const transport = createSmtpTransport(settings, { timeoutMs, getSocket });
  let settled: Parameters<typeof classifySendResult>[1];
  try {
    const info = await transport.sendMail({
      from: mail.from,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      headers: { ...DIGEST_MAIL_HEADERS },
    });
    settled = { ok: true, info };
  } catch (error) {
    settled = { ok: false, error };
  } finally {
    clearTimeout(timer);
    transport.close();
    (socket as net.Socket | null)?.destroy();
  }

  const elapsedMs = Date.now() - started;
  const errorLabel = settled.ok ? undefined : digestErrorLabel(settled.error);
  if (deadlineReached && !settled.ok) {
    return { outcome: "ambiguous", deadlineReached: true, elapsedMs, errorLabel };
  }
  const classified = classifySendResult(mail.to, settled);
  return errorLabel === undefined
    ? { ...classified, deadlineReached, elapsedMs }
    : { ...classified, deadlineReached, elapsedMs, errorLabel };
}
