import { Sidebar } from "@/components/sidebar";
import { TopBar } from "@/components/top-bar";
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

  return (
    <div className="flex min-h-screen">
      <Sidebar user={user} />
      <div className="flex flex-1 flex-col">
        <TopBar user={user} />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
