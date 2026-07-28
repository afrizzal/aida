import { Sidebar } from "@/components/sidebar";
import { TopBar } from "@/components/top-bar";
import { getBrandingSettings } from "@/lib/branding/settings";
import { prisma } from "@/lib/db";
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

  return (
    <div className="flex min-h-screen">
      <Sidebar user={user} brandName={workspaceName} />
      <div className="flex flex-1 flex-col">
        <TopBar user={user} />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
