// Connectivity probes for Settings -> Email (D-24, D-25), mirroring src/lib/llm/test-connection.ts:
// each throws on failure and resolves on success. The Server Actions classify what they throw.
// Kept in one place so the unit tests drive the same probe, against local fake servers, with a
// short timeout passed through the same option the actions use. Relative imports only.
import { createImapClient, type ImapConnectionConfig } from "./imap-client";
import { createSmtpTransport, type SmtpConnectionConfig } from "./smtp-client";

/** The Settings actions' probe budget per phase (connect, greeting, socket inactivity). */
export const EMAIL_PROBE_TIMEOUT_MS = 10_000;

/** IMAP: connect (TCP or TLS, greeting, login), then log out. Throws on any failure. */
export async function probeImapConnection(
  config: ImapConnectionConfig,
  opts?: { timeoutMs?: number },
): Promise<void> {
  const client = createImapClient(config, { timeoutMs: opts?.timeoutMs ?? EMAIL_PROBE_TIMEOUT_MS });
  await client.connect();
  await client.logout();
}

/** SMTP: nodemailer's verify() (connect, greeting, EHLO, login when credentials are set). */
export async function probeSmtpConnection(
  config: SmtpConnectionConfig,
  opts?: { timeoutMs?: number },
): Promise<void> {
  const transport = createSmtpTransport(config, {
    timeoutMs: opts?.timeoutMs ?? EMAIL_PROBE_TIMEOUT_MS,
  });
  try {
    await transport.verify();
  } catch (e) {
    // nodemailer's verify() rejects with a bare `Error("Connection closed")`, no code, when the
    // server ends the connection before the SMTP session finishes. Give it nodemailer's own
    // connection code so it classifies like every other close (K127).
    if (e instanceof Error && e.message === "Connection closed" && !("code" in e)) {
      throw Object.assign(new Error("SMTP connection closed", { cause: e }), {
        code: "ECONNECTION",
      });
    }
    throw e;
  }
}
