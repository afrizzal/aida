import { Card } from "@/components/ui/card";
import { getEmailSettings } from "@/lib/channels/email/settings";
import { isAdminRole } from "@/lib/membership";
import { digestIntervalText } from "@/lib/notifications/digest-config";
import { getPreferences, getUnassignedSetting } from "@/lib/notifications/preferences";
import { requirePageAccess } from "@/lib/page-access";
import { NotificationPreferencesForm } from "./notification-preferences-form";

// Settings -> Notifications (Phase 10, AIDA-46 D-22, D-24; UI-SPEC Surface 5 with amendment A3).
// Every member sees and changes their own preferences for the active organization; owners and
// admins also get the "Unassigned tickets" switch (owner item 11, V-28), because only they receive
// that fallback. Every change goes through a server action that reads the session once and writes
// for the session user only (./actions.ts).
export const dynamic = "force-dynamic";

// The Copywriting Contract rows "Notifications subtitle", "Notifications SMTP-off line" and
// "Digest cadence line", verbatim.
const SUBTITLE =
  "Choose what you hear about in this workspace. These settings are yours; other members have their own.";
const SMTP_OFF =
  "This server has no email set up, so digests are not sent. In-app notifications still work.";
const cadenceLine = (interval: string) =>
  `Email digests are sent ${interval} and list only unread notifications.`;

/**
 * Whether this organization can send digests: the same test the digest job applies (email on,
 * an SMTP host and a from address). Settings that cannot be read count as email off, as there.
 */
async function emailIsSetUp(db: Parameters<typeof getEmailSettings>[0]): Promise<boolean> {
  try {
    const s = await getEmailSettings(db);
    return s.enabled && s.smtpHost.trim() !== "" && s.fromAddress.trim() !== "";
  } catch {
    return false;
  }
}

export default async function NotificationSettingsPage() {
  // The membership gate first, outside any try (Phase 10, V-27, C6): a non-member goes to /no-access.
  const { db, orgId, role, session } = await requirePageAccess();
  const userId = session.user.id;
  const canSeeUnassigned = isAdminRole(role);

  const [preferences, emailOn, unassigned] = await Promise.all([
    getPreferences(orgId, userId),
    emailIsSetUp(db),
    canSeeUnassigned ? getUnassignedSetting(orgId, userId) : Promise.resolve(null),
  ]);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-[18px] font-semibold">Notifications</h1>
        <p className="text-[13px] text-muted-foreground">{SUBTITLE}</p>
      </div>
      {!emailOn && <p className="text-[13px] text-muted-foreground">{SMTP_OFF}</p>}
      <Card className="border-border/70 p-4 shadow-sm">
        <section aria-labelledby="event-types-heading" className="space-y-4">
          <div className="space-y-1">
            <h2 id="event-types-heading" className="text-[15px] font-semibold tracking-tight">
              Event types
            </h2>
            <p className="text-[12px] text-muted-foreground">{cadenceLine(digestIntervalText())}</p>
          </div>
          <NotificationPreferencesForm initial={preferences} initialUnassigned={unassigned} />
        </section>
      </Card>
    </div>
  );
}
