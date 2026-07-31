import { auth } from "./auth";
import { prisma } from "./db";

/**
 * Creates the first organization + admin headlessly: signUpEmail -> createOrganization
 * (hardcoded name "AIDA" / slug "aida" — never change this) -> mark setupComplete.
 * Shared by bootstrapFromEnv (below) and src/lib/demo/identities.ts's ensureDemoIdentities
 * so the two paths cannot drift (07-07, AIDA-22 / D-02). Throws a descriptive Error on
 * failure — callers decide whether that should block them or be swallowed.
 * NEVER logs the password.
 */
export async function createFirstOrgAndAdmin(input: {
  name: string;
  email: string;
  password: string;
}): Promise<{ orgId: string; adminUserId: string }> {
  const { name, email, password } = input;

  const signUpResponse = await auth.api.signUpEmail({
    body: { name, email, password },
  });

  if (!signUpResponse?.user?.id) {
    console.error("[bootstrap] Failed to create admin user for", email);
    throw new Error(`Failed to create admin user for ${email}`);
  }

  const userId = signUpResponse.user.id;

  // Create organization (system action — userId bypasses allowUserToCreateOrganization: false)
  const orgResponse = await auth.api.createOrganization({
    body: { name: "AIDA", slug: "aida", userId },
  });

  if (!orgResponse?.id) {
    console.error("[bootstrap] Failed to create organization for admin", email);
    throw new Error(`Failed to create organization for admin ${email}`);
  }

  // Mark setup complete
  await prisma.systemSetting.upsert({
    where: { key: "setupComplete" },
    update: { value: "true" },
    create: { key: "setupComplete", value: "true" },
  });

  console.info("[bootstrap] Created admin:", email);

  return { orgId: orgResponse.id, adminUserId: userId };
}

/**
 * Idempotent headless admin bootstrap (D-08).
 * Reads ADMIN_EMAIL + ADMIN_PASSWORD + ADMIN_NAME from env and creates
 * the first organization + admin if none exist.
 * Called once at server start via src/instrumentation.ts register().
 * NEVER logs the password.
 */
export async function bootstrapFromEnv(): Promise<void> {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME ?? "Admin";

  if (!email || !password) return; // env vars absent — no-op

  const existingCount = await prisma.user.count();
  if (existingCount > 0) return; // already bootstrapped — idempotent

  try {
    await createFirstOrgAndAdmin({ name, email, password });
  } catch {
    // createFirstOrgAndAdmin already logged the specific failure reason via console.error —
    // swallow here so a headless-bootstrap failure can never block server startup.
  }
}
