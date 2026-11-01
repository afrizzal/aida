"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireOrgAdmin } from "@/lib/authz";
import {
  getEmailSettings,
  saveEmailSettings as persistEmailSettings,
} from "@/lib/channels/email/settings";
import {
  EMAIL_PROBE_TIMEOUT_MS,
  probeImapConnection,
  probeSmtpConnection,
} from "@/lib/channels/email/test-connection";
import {
  ConnectionTestConfigError,
  type ConnectionTestResult,
  classifyConnectionError,
  connectionErrorLogShape,
} from "@/lib/connection-test/errors";
import { getScopedDb } from "@/lib/session";

/** Mirrors the Email settings form fields — ports/booleans arrive as form-native strings/booleans. */
export interface EmailSettingsInput {
  fromAddress: string;
  imapHost: string;
  imapPort: string;
  imapSecure: boolean;
  imapUser: string;
  imapPassword?: string;
  smtpHost: string;
  smtpPort: string;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPassword?: string;
}

/**
 * Persists the full IMAP/SMTP/from-address form. Admin-gated (SECURITY.md: server-side authz
 * on every mutating Settings Server Action). Blank passwords are forwarded as-is — plan 02's
 * saveEmailSettings treats an empty/undefined password as "keep existing stored value".
 */
export async function saveEmailSettings(input: EmailSettingsInput): Promise<{ ok: boolean }> {
  await requireOrgAdmin();
  const { db, orgId } = await getScopedDb();

  try {
    await persistEmailSettings(db, orgId, {
      fromAddress: input.fromAddress,
      imapHost: input.imapHost,
      imapPort: Number(input.imapPort),
      imapSecure: input.imapSecure,
      imapUser: input.imapUser,
      imapPassword: input.imapPassword,
      smtpHost: input.smtpHost,
      smtpPort: Number(input.smtpPort),
      smtpSecure: input.smtpSecure,
      smtpUser: input.smtpUser,
      smtpPassword: input.smtpPassword,
    });
    revalidatePath("/settings/email");
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/** Toggles the whole channel on/off (D-26 — everything else keeps working with it off). */
export async function setEmailChannelEnabled(enabled: boolean): Promise<{ ok: boolean }> {
  await requireOrgAdmin();
  const { db, orgId } = await getScopedDb();

  try {
    await persistEmailSettings(db, orgId, { enabled });
    revalidatePath("/settings/email");
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/**
 * Validates a form-native port string (an integer in 1..65535). Throws ConnectionTestConfigError,
 * which classifies as invalid_configuration, instead of handing a bad value to the client (D-25).
 */
function parsePort(raw: string): number {
  const port = Number(raw);
  if (raw.trim() === "" || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConnectionTestConfigError("port must be an integer in 1..65535");
  }
  return port;
}

/** A host must be a non-empty string; ConnectionTestConfigError otherwise (D-25). */
function requireHost(host: unknown): string {
  if (typeof host !== "string" || host.trim() === "") {
    throw new ConnectionTestConfigError("host is required");
  }
  return host;
}

/**
 * Real IMAP connectivity probe (D-24, Pitfall 5) — each phase (TCP/TLS connect, greeting, socket
 * inactivity) has a 10s budget, so a bad or filtered host/port fails instead of hanging (K127). Falls back to the stored decrypted password when the form field is
 * blank, so an admin can Test without re-typing an already-saved password. The port and host are
 * validated and the client is constructed inside the `try`, so a constructor error is classified
 * too. A failure returns a fixed category and a correlation ID (D-25, F-08); the failure text is
 * never echoed or logged.
 */
export async function testImapConnection(input: EmailSettingsInput): Promise<ConnectionTestResult> {
  await requireOrgAdmin();
  const { db } = await getScopedDb();

  const imapPassword = input.imapPassword || (await getEmailSettings(db)).imapPassword;

  try {
    await probeImapConnection(
      {
        imapHost: requireHost(input.imapHost),
        imapPort: parsePort(input.imapPort),
        imapSecure: input.imapSecure,
        imapUser: input.imapUser,
        imapPassword,
      },
      { timeoutMs: EMAIL_PROBE_TIMEOUT_MS },
    );
    return { ok: true };
  } catch (e) {
    // Log only the probe, the category, the correlation ID and the allowlisted error shape (D-25,
    // K127).
    const correlationId = randomUUID();
    const category = classifyConnectionError(e);
    console.error("[settings] connection test failed", {
      probe: "imap",
      category,
      correlationId,
      error: connectionErrorLogShape(e),
    });
    return { ok: false, error: category, correlationId };
  }
}

/**
 * Real SMTP connectivity probe (D-24, Pitfall 5) — same 10s-timeout/stored-password-fallback,
 * validation-inside-try and categorized-failure contract as testImapConnection (D-25, F-08).
 */
export async function testSmtpConnection(input: EmailSettingsInput): Promise<ConnectionTestResult> {
  await requireOrgAdmin();
  const { db } = await getScopedDb();

  const smtpPassword = input.smtpPassword || (await getEmailSettings(db)).smtpPassword;

  try {
    await probeSmtpConnection(
      {
        smtpHost: requireHost(input.smtpHost),
        smtpPort: parsePort(input.smtpPort),
        smtpSecure: input.smtpSecure,
        smtpUser: input.smtpUser,
        smtpPassword,
      },
      { timeoutMs: EMAIL_PROBE_TIMEOUT_MS },
    );
    return { ok: true };
  } catch (e) {
    // Log only the probe, the category, the correlation ID and the allowlisted error shape (D-25,
    // K127).
    const correlationId = randomUUID();
    const category = classifyConnectionError(e);
    console.error("[settings] connection test failed", {
      probe: "smtp",
      category,
      correlationId,
      error: connectionErrorLogShape(e),
    });
    return { ok: false, error: category, correlationId };
  }
}
