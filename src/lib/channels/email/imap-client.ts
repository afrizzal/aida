import { ImapFlow } from "imapflow";

/**
 * Thin ImapFlow factory from decrypted EmailSettings (D-01). Worker-bundleable —
 * only bare-package imports, no `@/`.
 *
 * Short greeting timeout (default) so a bad host/port fails fast for the Settings
 * "Test connection" action (Pitfall 5); a longer socket timeout covers real fetches
 * once connected. `opts.timeoutMs` overrides all three phase budgets: the TCP/TLS connect
 * (imapflow's `connectionTimeout`, 90 s by default, so a filtered port would otherwise hold the
 * Settings action that long), the greeting and socket inactivity (K127).
 */
export interface ImapConnectionConfig {
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  imapUser: string;
  imapPassword: string;
}

export function createImapClient(s: ImapConnectionConfig, opts?: { timeoutMs?: number }): ImapFlow {
  return new ImapFlow({
    host: s.imapHost,
    port: s.imapPort,
    secure: s.imapSecure,
    auth: { user: s.imapUser, pass: s.imapPassword },
    logger: false,
    connectionTimeout: opts?.timeoutMs ?? 90_000,
    greetingTimeout: opts?.timeoutMs ?? 10000,
    socketTimeout: opts?.timeoutMs ?? 60000,
  });
}
