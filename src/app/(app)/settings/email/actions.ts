"use server";

import { revalidatePath } from "next/cache";
import { createImapClient } from "@/lib/channels/email/imap-client";
import { createSmtpTransport } from "@/lib/channels/email/smtp-client";
import {
  getEmailSettings,
  saveEmailSettings as persistEmailSettings,
} from "@/lib/channels/email/settings";
import { requireOrgAdmin } from "@/lib/authz";
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
 * Real IMAP connectivity probe (D-24, Pitfall 5) — fails fast within a 10s timeout rather than
 * hanging on a bad host/port. Falls back to the stored decrypted password when the form field is
 * blank, so an admin can Test without re-typing an already-saved password. Never echoes the
 * submitted password back in the error.
 */
export async function testImapConnection(
  input: EmailSettingsInput,
): Promise<{ ok: boolean; error?: string }> {
  await requireOrgAdmin();
  const { db } = await getScopedDb();

  const imapPassword = input.imapPassword || (await getEmailSettings(db)).imapPassword;

  const client = createImapClient(
    {
      imapHost: input.imapHost,
      imapPort: Number(input.imapPort),
      imapSecure: input.imapSecure,
      imapUser: input.imapUser,
      imapPassword,
    },
    { timeoutMs: 10000 },
  );

  try {
    await client.connect();
    await client.logout();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e as Error).message).slice(0, 200) };
  }
}

/**
 * Real SMTP connectivity probe (D-24, Pitfall 5) — same 10s-timeout/stored-password-fallback
 * contract as testImapConnection.
 */
export async function testSmtpConnection(
  input: EmailSettingsInput,
): Promise<{ ok: boolean; error?: string }> {
  await requireOrgAdmin();
  const { db } = await getScopedDb();

  const smtpPassword = input.smtpPassword || (await getEmailSettings(db)).smtpPassword;

  const transport = createSmtpTransport(
    {
      smtpHost: input.smtpHost,
      smtpPort: Number(input.smtpPort),
      smtpSecure: input.smtpSecure,
      smtpUser: input.smtpUser,
      smtpPassword,
    },
    { timeoutMs: 10000 },
  );

  try {
    await transport.verify();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e as Error).message).slice(0, 200) };
  }
}
