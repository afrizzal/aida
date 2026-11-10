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
//   rejected   a definitive SMTP reply: an error with a reply code 400 to 599 (RCPT, the DATA
//              command or the final reply after the data), or the recipient in info.rejected;
//   ambiguous  everything else: the deadline, a dropped connection, a timeout, an error with no
//              reply code. The server may have accepted the message.
// A send cut off by the deadline is always ambiguous, even if a partial reply was read.
//
// Nothing here logs: errors can echo addresses. Relative imports only: the worker bundles it.
import net from "node:net";
import {
  createSmtpTransport,
  type SmtpConnectionConfig,
  type SmtpGetSocket,
} from "../channels/email/smtp-client";

export type DigestSendOutcome = "accepted" | "rejected" | "ambiguous";

export interface DigestSendResult {
  outcome: DigestSendOutcome;
  /** The SMTP reply code of a failed send, when nodemailer reported one. */
  responseCode?: number;
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

/**
 * Classifies a settled sendMail (R2-5). Exported so the TLS-equivalence tests apply the same
 * rule to createSmtpTransport's own sends.
 */
export function classifySendResult(
  to: string,
  settled:
    | { ok: true; info: { accepted?: unknown[]; rejected?: unknown[] } }
    | { ok: false; error: unknown },
): { outcome: DigestSendOutcome; responseCode?: number } {
  const wanted = to.trim().toLowerCase();
  if (settled.ok) {
    const accepted = (settled.info.accepted ?? []).map(normalise);
    const rejected = (settled.info.rejected ?? []).map(normalise);
    if (rejected.includes(wanted)) return { outcome: "rejected" };
    if (accepted.includes(wanted) && rejected.length === 0) return { outcome: "accepted" };
    return { outcome: "ambiguous" };
  }
  const error = settled.error as { responseCode?: unknown } | null;
  const code = typeof error?.responseCode === "number" ? error.responseCode : undefined;
  if (code !== undefined && code >= 400 && code <= 599)
    return { outcome: "rejected", responseCode: code };
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
  if (deadlineReached && !settled.ok) {
    return { outcome: "ambiguous", deadlineReached: true, elapsedMs };
  }
  const classified = classifySendResult(mail.to, settled);
  return { ...classified, deadlineReached, elapsedMs };
}
