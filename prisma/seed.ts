// ---------------------------------------------------------------------------
// prisma/seed.ts — CLI entrypoint for `pnpm db:seed` (07-02, AIDA-22).
//
// Turns a freshly-migrated, EMPTY database into a fully populated demo
// helpdesk in one command. Refuses instead of duplicating data on a
// non-empty workspace (D-01 -- AuditEvent rows are append-only, so a
// destructive "reset and re-seed" path is impossible by design).
//
// Identity creation (org + admin + agent) lives in src/lib/demo/identities.ts
// (ensureDemoIdentities) — shared with the boot-time DEMO_MODE path
// (src/lib/demo/bootstrap-demo.ts, 07-07) so the two paths cannot drift.
//
// tsx resolves the `@/` alias from the root tsconfig.json.
// ---------------------------------------------------------------------------
import "dotenv/config";
import { prisma } from "@/lib/db";
import {
  DEMO_ADMIN_EMAIL_DEFAULT,
  DEMO_AGENT_EMAIL_DEFAULT,
  DEMO_PASSWORD_DEFAULT,
  ensureDemoIdentities,
} from "@/lib/demo/identities";
import { seedDemoData } from "@/lib/demo/seed-demo-data";

const ADMIN_EMAIL = process.env.DEMO_ADMIN_EMAIL || DEMO_ADMIN_EMAIL_DEFAULT;
const ADMIN_PASSWORD = process.env.DEMO_ADMIN_PASSWORD || DEMO_PASSWORD_DEFAULT;
const AGENT_EMAIL = process.env.DEMO_AGENT_EMAIL || DEMO_AGENT_EMAIL_DEFAULT;

async function main(): Promise<void> {
  try {
    const ids = await ensureDemoIdentities();

    // Guard (D-01): refuse on a non-empty workspace instead of duplicating data.
    const existingTicketCount = await prisma.ticket.count({
      where: { organizationId: ids.orgId },
    });
    if (existingTicketCount > 0) {
      console.log(`[seed] Refusing to seed: workspace already has ${existingTicketCount} tickets.`);
      console.log(
        "[seed] The demo seed is not idempotent and AuditEvent rows are append-only (they can never be deleted),",
      );
      console.log(
        "[seed] so re-seeding would duplicate data. Start from a clean database instead:",
      );
      console.log("[seed]   docker compose down -v && docker compose up      (Docker)");
      console.log("[seed]   node node_modules/prisma/build/index.js migrate reset   (local dev)");
      process.exit(1);
    }

    const summary = await seedDemoData({
      orgId: ids.orgId,
      adminUserId: ids.adminUserId,
      agentUserId: ids.agentUserId,
    });

    console.log(JSON.stringify(summary, null, 2));
    console.log("");
    console.log("[seed] Demo workspace seeded. Log in with:");
    console.log(`[seed]   Admin: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
    console.log(`[seed]   Agent: ${AGENT_EMAIL} / ${ADMIN_PASSWORD}`);

    // Required: createKbArticle() leaves a pg-boss connection pool open (kb-embed-article
    // enqueue), which would otherwise hang the process indefinitely.
    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    console.error("[seed] Failed:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

void main();
