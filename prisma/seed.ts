// ---------------------------------------------------------------------------
// prisma/seed.ts — CLI entrypoint for `pnpm db:seed` (07-02, AIDA-22).
//
// Turns a freshly-migrated, EMPTY database into a fully populated demo
// helpdesk in one command. Refuses instead of duplicating data on a
// non-empty workspace (D-01 -- AuditEvent rows are append-only, so a
// destructive "reset and re-seed" path is impossible by design).
//
// tsx resolves the `@/` alias from the root tsconfig.json.
// ---------------------------------------------------------------------------
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { seedDemoData } from "@/lib/demo/seed-demo-data";

const ADMIN_EMAIL = process.env.DEMO_ADMIN_EMAIL || "admin@demo.aida.test";
const ADMIN_PASSWORD = process.env.DEMO_ADMIN_PASSWORD || "aida-demo-2026";
const ADMIN_NAME = process.env.DEMO_ADMIN_NAME || "Admin";
const AGENT_EMAIL = "agent@demo.aida.test";
const AGENT_NAME = "Sam Rivera";

async function resolveOrgAndAdmin(): Promise<{ orgId: string; adminUserId: string }> {
  const existingOrg = await prisma.organization.findFirst();
  if (existingOrg) {
    // Prefer an owner/admin-role member (mirrors src/lib/authz.ts's role check) over just the
    // earliest member, in case the workspace was set up interactively via /setup and has more
    // than one member by the time this seed runs.
    const adminMember =
      (await prisma.member.findFirst({
        where: { organizationId: existingOrg.id, role: { in: ["owner", "admin"] } },
        orderBy: { createdAt: "asc" },
      })) ??
      (await prisma.member.findFirst({
        where: { organizationId: existingOrg.id },
        orderBy: { createdAt: "asc" },
      }));
    if (!adminMember) {
      throw new Error("Organization exists but has no members -- cannot resolve an admin user id.");
    }
    return { orgId: existingOrg.id, adminUserId: adminMember.userId };
  }

  // No organization yet -- create the identity set headlessly, mirroring
  // src/lib/bootstrap.ts's proven signUpEmail + createOrganization sequence exactly.
  const signUpResponse = await auth.api.signUpEmail({
    body: { name: ADMIN_NAME, email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  if (!signUpResponse?.user?.id) {
    throw new Error(`Failed to create admin user for ${ADMIN_EMAIL}`);
  }
  const adminUserId = signUpResponse.user.id;

  const orgResponse = await auth.api.createOrganization({
    body: { name: "AIDA", slug: "aida", userId: adminUserId },
  });
  if (!orgResponse?.id) {
    throw new Error(`Failed to create organization for admin ${ADMIN_EMAIL}`);
  }

  await prisma.systemSetting.upsert({
    where: { key: "setupComplete" },
    update: { value: "true" },
    create: { key: "setupComplete", value: "true" },
  });

  return { orgId: orgResponse.id, adminUserId };
}

async function resolveAgent(orgId: string): Promise<string> {
  const existingAgent = await prisma.user.findFirst({ where: { email: AGENT_EMAIL } });
  let agentUserId: string;

  if (existingAgent) {
    agentUserId = existingAgent.id;
  } else {
    // Mirrors tests/e2e/global-setup.ts's proven "add a second user to an org" pattern:
    // signUpEmail, then a direct prisma.member.create (Better Auth model, not scopedDb).
    const agentSignUp = await auth.api.signUpEmail({
      body: { name: AGENT_NAME, email: AGENT_EMAIL, password: ADMIN_PASSWORD },
    });
    if (!agentSignUp?.user?.id) {
      throw new Error(`Failed to create agent user for ${AGENT_EMAIL}`);
    }
    agentUserId = agentSignUp.user.id;
  }

  const existingMembership = await prisma.member.findFirst({
    where: { organizationId: orgId, userId: agentUserId },
  });
  if (!existingMembership) {
    await prisma.member.create({
      data: {
        id: randomUUID(),
        organizationId: orgId,
        userId: agentUserId,
        role: "member",
        createdAt: new Date(),
      },
    });
  }

  return agentUserId;
}

async function main(): Promise<void> {
  try {
    const { orgId, adminUserId } = await resolveOrgAndAdmin();
    const agentUserId = await resolveAgent(orgId);

    // Guard (D-01): refuse on a non-empty workspace instead of duplicating data.
    const existingTicketCount = await prisma.ticket.count({ where: { organizationId: orgId } });
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

    const summary = await seedDemoData({ orgId, adminUserId, agentUserId });

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
