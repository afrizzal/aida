// ---------------------------------------------------------------------------
// identities.ts — the ONE place demo identities (org + admin + agent) are
// created, reached by both prisma/seed.ts (CLI) and bootstrap-demo.ts (boot
// path) through src/lib/demo/tenant-guard.ts so the two paths cannot drift
// (07-07, AIDA-22 / D-02; 09-02, AIDA-37).
// ---------------------------------------------------------------------------
import { randomUUID } from "node:crypto";
import { auth } from "@/lib/auth";
import { createFirstOrgAndAdmin } from "@/lib/bootstrap";
import { prisma } from "@/lib/db";
import type { DemoSeedHooks } from "@/lib/demo/tenant-guard";

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
 * Creates the demo org + admin + agent and returns their ids. Creates only, never adopts an
 * existing organization or user: it runs after the tenant guard classified the database as
 * empty, and throws if an organization or a user exists anyway (the guard was bypassed by a
 * writer that does not take the tenant seed lock, review a-WR-1).
 * Reads DEMO_ADMIN_EMAIL / DEMO_ADMIN_PASSWORD / DEMO_AGENT_EMAIL, falling back to the
 * documented defaults above. Never logs the password.
 */
export async function createDemoIdentities(hooks?: DemoSeedHooks): Promise<DemoIdentities> {
  const adminEmail = process.env.DEMO_ADMIN_EMAIL || DEMO_ADMIN_EMAIL_DEFAULT;
  const adminPassword = process.env.DEMO_ADMIN_PASSWORD || DEMO_PASSWORD_DEFAULT;
  const adminName = process.env.DEMO_ADMIN_NAME || DEMO_ADMIN_NAME_DEFAULT;
  const agentEmail = process.env.DEMO_AGENT_EMAIL || DEMO_AGENT_EMAIL_DEFAULT;

  const existingOrg = await prisma.organization.findFirst({ select: { id: true } });
  const existingUser = await prisma.user.findFirst({ select: { id: true } });
  if (existingOrg || existingUser) {
    throw new Error(
      "[demo] Refusing to create demo identities: an organization or a user already exists (the tenant guard was bypassed).",
    );
  }

  // The shared bootstrap sequence (never duplicate the Better Auth signUpEmail/createOrganization
  // calls here). Stages admin-user, organization and setup-complete.
  const { orgId, adminUserId } = await createFirstOrgAndAdmin(
    { name: adminName, email: adminEmail, password: adminPassword },
    hooks,
  );

  // Agent (second user) — mirrors tests/e2e/global-setup.ts's proven pattern: signUpEmail,
  // then a direct prisma.member.create (Better Auth's member model has no organizationId-
  // scoped helper here).
  const agentSignUp = await auth.api.signUpEmail({
    body: { name: DEMO_AGENT_NAME, email: agentEmail, password: adminPassword },
  });
  if (!agentSignUp?.user?.id) {
    throw new Error(`[demo] Failed to create demo agent user for ${agentEmail}`);
  }
  const agentUserId = agentSignUp.user.id;
  await hooks?.afterStage?.("agent-user");

  await prisma.member.create({
    data: {
      id: randomUUID(),
      organizationId: orgId,
      userId: agentUserId,
      role: "member",
      createdAt: new Date(),
    },
  });
  await hooks?.afterStage?.("agent-member");

  return { orgId, adminUserId, agentUserId };
}
