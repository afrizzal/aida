// ---------------------------------------------------------------------------
// identities.ts — the ONE place demo identities (org + admin + agent) are
// created, imported by both prisma/seed.ts (CLI) and bootstrap-demo.ts (boot
// path) so the two paths cannot drift (07-07, AIDA-22 / D-02).
// ---------------------------------------------------------------------------
import { randomUUID } from "node:crypto";
import { auth } from "@/lib/auth";
import { createFirstOrgAndAdmin } from "@/lib/bootstrap";
import { prisma } from "@/lib/db";

export const DEMO_ADMIN_EMAIL_DEFAULT = "admin@demo.aida.test";
export const DEMO_AGENT_EMAIL_DEFAULT = "agent@demo.aida.test";
export const DEMO_PASSWORD_DEFAULT = "aida-demo-2026";

const DEMO_ADMIN_NAME_DEFAULT = "Admin";
const DEMO_AGENT_NAME = "Sam Rivera";

export interface DemoIdentities {
  orgId: string;
  adminUserId: string;
  agentUserId: string;
}

/**
 * Idempotently ensures a demo org + admin + agent exist and returns their ids.
 * Reads DEMO_ADMIN_EMAIL / DEMO_ADMIN_PASSWORD / DEMO_AGENT_EMAIL, falling back to the
 * documented defaults above. Never logs the password.
 */
export async function ensureDemoIdentities(): Promise<DemoIdentities> {
  const adminEmail = process.env.DEMO_ADMIN_EMAIL || DEMO_ADMIN_EMAIL_DEFAULT;
  const adminPassword = process.env.DEMO_ADMIN_PASSWORD || DEMO_PASSWORD_DEFAULT;
  const adminName = process.env.DEMO_ADMIN_NAME || DEMO_ADMIN_NAME_DEFAULT;
  const agentEmail = process.env.DEMO_AGENT_EMAIL || DEMO_AGENT_EMAIL_DEFAULT;

  let orgId: string;
  let adminUserId: string;

  const existingOrg = await prisma.organization.findFirst();
  if (existingOrg) {
    orgId = existingOrg.id;

    // Prefer an owner/admin-role member over just the earliest member, in case the
    // workspace was set up interactively via /setup and has more than one member.
    const adminMember =
      (await prisma.member.findFirst({
        where: { organizationId: orgId, role: { in: ["owner", "admin"] } },
        orderBy: { createdAt: "asc" },
      })) ??
      (await prisma.member.findFirst({
        where: { organizationId: orgId },
        orderBy: { createdAt: "asc" },
      }));
    if (!adminMember) {
      throw new Error(
        `[demo] Organization "${existingOrg.slug}" exists but has no members — cannot resolve an admin user id.`,
      );
    }
    adminUserId = adminMember.userId;
  } else {
    // No organization yet — create it headlessly via the shared bootstrap sequence
    // (never duplicate the Better Auth signUpEmail/createOrganization calls here).
    const created = await createFirstOrgAndAdmin({
      name: adminName,
      email: adminEmail,
      password: adminPassword,
    });
    orgId = created.orgId;
    adminUserId = created.adminUserId;
  }

  // Agent (second user) — mirrors tests/e2e/global-setup.ts's proven pattern: signUpEmail,
  // then a direct prisma.member.create (Better Auth's member model has no organizationId-
  // scoped helper here).
  let agentUserId: string;
  const existingAgent = await prisma.user.findFirst({ where: { email: agentEmail } });
  if (existingAgent) {
    agentUserId = existingAgent.id;
  } else {
    const agentSignUp = await auth.api.signUpEmail({
      body: { name: DEMO_AGENT_NAME, email: agentEmail, password: adminPassword },
    });
    if (!agentSignUp?.user?.id) {
      throw new Error(`[demo] Failed to create demo agent user for ${agentEmail}`);
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

  return { orgId, adminUserId, agentUserId };
}
