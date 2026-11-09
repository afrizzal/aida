import { CommandProvider } from "@/components/command-provider";
import { Sidebar } from "@/components/sidebar";
import { TopBar } from "@/components/top-bar";
import { getBrandingSettings, getLogoSetting, logoPublicUrl } from "@/lib/branding/settings";
import { prisma } from "@/lib/db";
import { requirePageAccess } from "@/lib/page-access";
import { listSavedViewsForViewer } from "@/lib/saved-views/service";
import { sidebarViewsOrEmpty } from "@/lib/saved-views/ui-state";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // The membership gate first, outside any try (Phase 10, V-27, C6): no session goes to /login, and
  // no active organization or no member row in it goes to /no-access, before the organization,
  // branding, logo and saved-view reads below. Each page calls it too, because the layout and the
  // page render in parallel.
  const { session, orgId, db } = await requirePageAccess();

  const user = {
    name: session.user.name,
    email: session.user.email,
  };

  // organization is a Better Auth model and is NOT in scopedDb's DOMAIN_MODELS — bare prisma.
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { name: true },
  });
  const { workspaceName } = await getBrandingSettings(db, org?.name ?? "AIDA");
  // The active organization's logo (AIDA-34, D-10, D-11): its versioned public URL, or null for
  // the Sparkles box when none (or a malformed reference) is stored.
  const logo = await getLogoSetting(db);
  const logoUrl = logo ? logoPublicUrl(orgId, logo.version) : null;

  // Saved views for the sidebar (AIDA-47, UI-SPEC Surface 1): the viewer's private views and the
  // organization's shared views, membership-checked by the service (D-01). A failed read, a
  // removed member included, gives empty lists and one server log line (UI-SPEC E1 error).
  const actor = { userId: session.user.id, orgId };
  const views = await sidebarViewsOrEmpty(() => listSavedViewsForViewer(prisma, actor));

  // The command palette (AIDA-49, D-11, D-12) gets the same membership-safe views list, so the
  // palette never shows another member's private view and a removed member sees no views.
  return (
    <CommandProvider views={views}>
      <div className="flex min-h-screen">
        <Sidebar user={user} brandName={workspaceName} logoUrl={logoUrl} views={views} />
        <div className="flex flex-1 flex-col">
          <TopBar user={user} />
          <main className="flex-1 overflow-auto p-6">{children}</main>
        </div>
      </div>
    </CommandProvider>
  );
}
