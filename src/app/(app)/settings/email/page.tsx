import { getEmailSettings } from "@/lib/channels/email/settings";
import { requirePageAccess } from "@/lib/page-access";
import { EmailChannelToggle } from "./email-channel-toggle";
import { EmailSettingsForm } from "./email-settings-form";

// Reads DB at request time (org-scoped settings) — must never be statically prerendered.
export const dynamic = "force-dynamic";

export default async function EmailSettingsPage() {
  // The membership gate first, outside any try (Phase 10, V-27, C6): a non-member goes to /no-access.
  const { db } = await requirePageAccess();
  const settings = await getEmailSettings(db);

  return (
    <div className="space-y-6">
      <h1 className="text-[18px] font-semibold">Email</h1>
      <EmailChannelToggle defaultEnabled={settings.enabled} />
      <EmailSettingsForm
        initial={{
          fromAddress: settings.fromAddress,
          imapHost: settings.imapHost,
          imapPort: String(settings.imapPort),
          imapSecure: settings.imapSecure,
          imapUser: settings.imapUser,
          smtpHost: settings.smtpHost,
          smtpPort: String(settings.smtpPort),
          smtpSecure: settings.smtpSecure,
          smtpUser: settings.smtpUser,
        }}
        health={{ lastPollAt: settings.lastPollAt, lastPollError: settings.lastPollError }}
      />
    </div>
  );
}
