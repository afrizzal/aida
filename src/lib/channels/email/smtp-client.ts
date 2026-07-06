// Thin nodemailer transporter factory from decrypted EmailSettings.
//
// Imported by BOTH the Next.js app (Test Connection Server Action, plan 06) AND the worker
// (email-outbound-send job, THIS plan) — worker-bundleable, so keep this file's own imports
// bare/relative only (no `@/`).
import nodemailer from "nodemailer";

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
export function createSmtpTransport(
  s: SmtpConnectionConfig,
  opts?: { timeoutMs?: number },
) {
  const timeoutMs = opts?.timeoutMs ?? 10000;
  return nodemailer.createTransport({
    host: s.smtpHost,
    port: s.smtpPort,
    secure: s.smtpSecure,
    auth: { user: s.smtpUser, pass: s.smtpPassword },
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: timeoutMs,
  });
}
