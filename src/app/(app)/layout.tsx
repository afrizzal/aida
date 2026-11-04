import { CommandProvider } from "@/components/command-provider";
import { Sidebar } from "@/components/sidebar";
import { TopBar } from "@/components/top-bar";
import { getBrandingSettings, getLogoSetting, logoPublicUrl } from "@/lib/branding/settings";
import { prisma } from "@/lib/db";
import { listSavedViewsForViewer } from "@/lib/saved-views/service";
import { sidebarViewsOrEmpty } from "@/lib/saved-views/ui-state";
import { scopedDb } from "@/lib/scoped-db";
import { requireSession } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();

  // activeOrganizationId is set at login by databaseHooks.session.create.before.
  // If null here it means an unexpected state (e.g. orphaned session); show a safe
  // fallback rather than crashing downstream getScopedDb calls. (AIDA-10)
  if (!session.session.activeOrganizationId) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-[14px] text-muted-foreground">
          No workspace found. Please sign out and sign in again.
        </p>
      </div>
    );
  }

  const user = {
    name: session.user.name,
    email: session.user.email,
  };

  const orgId = session.session.activeOrganizationId;
  // organization is a Better Auth model and is NOT in scopedDb's DOMAIN_MODELS — bare prisma.
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { name: true },
  });
  const { workspaceName } = await getBrandingSettings(scopedDb(orgId), org?.name ?? "AIDA");
  // The active organization's logo (AIDA-34, D-10, D-11): its versioned public URL, or null for
  // the Sparkles box when none (or a malformed reference) is stored.
  const logo = await getLogoSetting(scopedDb(orgId));
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
