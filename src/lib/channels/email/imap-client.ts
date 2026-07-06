import { ImapFlow } from "imapflow";

/**
 * Thin ImapFlow factory from decrypted EmailSettings (D-01). Worker-bundleable —
 * only bare-package imports, no `@/`.
 *
 * Short greeting timeout (default) so a bad host/port fails fast for the Settings
 * "Test connection" action (Pitfall 5); a longer socket timeout covers real fetches
 * once connected. Both are overridable via `opts.timeoutMs`.
 */
export function createImapClient(
  s: {
    imapHost: string;
    imapPort: number;
    imapSecure: boolean;
    imapUser: string;
    imapPassword: string;
  },
  opts?: { timeoutMs?: number },
): ImapFlow {
  return new ImapFlow({
    host: s.imapHost,
    port: s.imapPort,
    secure: s.imapSecure,
    auth: { user: s.imapUser, pass: s.imapPassword },
    logger: false,
    greetingTimeout: opts?.timeoutMs ?? 10000,
    socketTimeout: opts?.timeoutMs ?? 60000,
  });
}
