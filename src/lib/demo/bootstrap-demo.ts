// ---------------------------------------------------------------------------
// bootstrap-demo.ts — flag-gated demo bootstrap (07-07, AIDA-22 / D-02).
//
// Turns `docker compose up` with DEMO_MODE=true into an instantly explorable,
// fully populated helpdesk. Strictly opt-in (DEMO_MODE must be exactly
// "true"), loud in the logs (known credentials are being created), and a
// failed seed must NEVER block the app from starting — see instrumentation.ts.
// ---------------------------------------------------------------------------
import { prisma } from "@/lib/db";
import { DEMO_ADMIN_EMAIL_DEFAULT, ensureDemoIdentities } from "@/lib/demo/identities";
import { seedDemoData } from "@/lib/demo/seed-demo-data";

export async function bootstrapDemoMode(): Promise<void> {
  if (process.env.DEMO_MODE !== "true") return;

  // Logged before anything else so the warning appears even if seeding below fails.
  console.warn(
    "[demo] DEMO MODE IS ACTIVE. This instance auto-creates accounts with PUBLICLY DOCUMENTED credentials and loads fictional data. Never expose it to the internet or use it for real tickets.",
  );

  try {
    const existing = await prisma.ticket.count();
    if (existing > 0) {
      console.info("[demo] Demo data already present (%d tickets) — skipping seed.", existing);
      return;
    }

    const ids = await ensureDemoIdentities();

    const started = Date.now();
    const summary = await seedDemoData({
      orgId: ids.orgId,
      adminUserId: ids.adminUserId,
      agentUserId: ids.agentUserId,
    });

    const adminEmail = process.env.DEMO_ADMIN_EMAIL || DEMO_ADMIN_EMAIL_DEFAULT;
    console.info("[demo] Seeded demo workspace in %dms: %o", Date.now() - started, summary);
    console.info(
      "[demo] Sign in at / with %s (password from DEMO_ADMIN_PASSWORD, default: the documented demo password).",
      adminEmail,
    );
  } catch (error) {
    // A failed demo seed must never prevent the app from starting.
    console.error(
      "[demo] Demo seeding failed:",
      error instanceof Error ? error.message : String(error),
    );
  }
}
