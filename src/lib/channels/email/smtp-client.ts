// Thin nodemailer transporter factory from decrypted EmailSettings.
//
// Imported by BOTH the Next.js app (Test Connection Server Action, plan 06) AND the worker
// (email-outbound-send job, THIS plan) — worker-bundleable, so keep this file's own imports
// bare/relative only (no `@/`).
import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";

export interface SmtpConnectionConfig {
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPassword: string;
}

/**
 * Creates a nodemailer SMTP transporter with EXPLICIT connection/greeting/socket timeouts
 * (RESEARCH.md Pitfall 5) — a misconfigured host/port must fail fast with a clear error
 * rather than hang on Node's OS-default socket timeout (often 2+ minutes).
 */
/**
 * nodemailer's `getSocket` transport option (Phase 10, V-29): called once per send with the
 * transport options; the callback receives `{ connection: socket }` with an already connected
 * plain TCP socket, which nodemailer then uses instead of opening its own. TLS handling stays
 * nodemailer's: with `secure` it upgrades that socket at once, and a STARTTLS offer upgrades it
 * after EHLO. The digest sender uses it to own the socket and cut a send off at a deadline.
 */
export type SmtpGetSocket = NonNullable<SMTPTransport.Options["getSocket"]>;

/**
 * Creates a nodemailer SMTP transporter with EXPLICIT connection/greeting/socket timeouts
 * (RESEARCH.md Pitfall 5) — a misconfigured host/port must fail fast with a clear error
 * rather than hang on Node's OS-default socket timeout (often 2+ minutes). An optional
 * `getSocket` is passed to nodemailer unchanged; every other option is the same either way.
 */
export function createSmtpTransport(
  s: SmtpConnectionConfig,
  opts?: { timeoutMs?: number; getSocket?: SmtpGetSocket },
) {
  const timeoutMs = opts?.timeoutMs ?? 10000;
  const options: SMTPTransport.Options = {
    host: s.smtpHost,
    port: s.smtpPort,
    secure: s.smtpSecure,
    auth: { user: s.smtpUser, pass: s.smtpPassword },
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: timeoutMs,
  };
  if (opts?.getSocket) options.getSocket = opts.getSocket;
  return nodemailer.createTransport(options);
}
