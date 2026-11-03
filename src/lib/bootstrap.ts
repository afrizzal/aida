import { auth } from "./auth";
import { prisma } from "./db";
import { TenantSeedLockTimeout, withTenantSeedLock } from "./tenant-seed-lock";

/** The writes of createFirstOrgAndAdmin, in order; each is committed on its own. */
export type BootstrapStage = "admin-user" | "organization" | "setup-complete";

export interface BootstrapStageHooks {
  /** Awaited after each committed write. Tests use it to stop between writes; production passes none. */
  afterStage?: (stage: BootstrapStage) => Promise<void> | void;
}

/**
 * Creates the first organization + admin headlessly: signUpEmail -> createOrganization
 * (hardcoded name "AIDA" / slug "aida" — never change this) -> mark setupComplete.
 * Shared by bootstrapFromEnv (below) and src/lib/demo/identities.ts's createDemoIdentities
 * so the two paths cannot drift (07-07, AIDA-22 / D-02). The slug is the same for a real and a
 * demo workspace, so it never identifies the demo (the demo completion marker does, 09-02).
 * The three writes are not one transaction: each commits on its own. Throws a descriptive
 * Error on failure — callers decide whether that should block them or be swallowed.
 * NEVER logs the password.
 */
export async function createFirstOrgAndAdmin(
  input: {
    name: string;
    email: string;
    password: string;
  },
  hooks?: BootstrapStageHooks,
): Promise<{ orgId: string; adminUserId: string }> {
  const { name, email, password } = input;

  const signUpResponse = await auth.api.signUpEmail({
    body: { name, email, password },
  });

  if (!signUpResponse?.user?.id) {
    console.error("[bootstrap] Failed to create admin user for", email);
    throw new Error(`Failed to create admin user for ${email}`);
  }

  const userId = signUpResponse.user.id;
  await hooks?.afterStage?.("admin-user");

  // Create organization (system action — userId bypasses allowUserToCreateOrganization: false)
  const orgResponse = await auth.api.createOrganization({
    body: { name: "AIDA", slug: "aida", userId },
  });

  if (!orgResponse?.id) {
    console.error("[bootstrap] Failed to create organization for admin", email);
    throw new Error(`Failed to create organization for admin ${email}`);
  }
  await hooks?.afterStage?.("organization");

  // Mark setup complete
  await prisma.systemSetting.upsert({
    where: { key: "setupComplete" },
    update: { value: "true" },
    create: { key: "setupComplete", value: "true" },
  });
  await hooks?.afterStage?.("setup-complete");

  console.info("[bootstrap] Created admin:", email);

  return { orgId: orgResponse.id, adminUserId: userId };
}

/**
 * Idempotent headless admin bootstrap (D-08).
 * Reads ADMIN_EMAIL + ADMIN_PASSWORD + ADMIN_NAME from env and creates
 * the first organization + admin if no user exists.
 * Called once at server start via src/instrumentation.ts register(), before the demo boot, so
 * with ADMIN_* set a real workspace exists first and the demo boot then refuses (09-02, U-17).
 * The user count and the create run under the tenant seed lock that `pnpm db:seed` and the
 * DEMO_MODE boot take too (D-17); a lock timeout logs one line and returns, so boot never blocks.
 * NEVER logs the password.
 */
export async function bootstrapFromEnv(): Promise<void> {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME ?? "Admin";

  if (!email || !password) return; // env vars absent — no-op

  try {
    await withTenantSeedLock(async (tx) => {
      const existingCount = await tx.user.count();
      if (existingCount > 0) return; // already bootstrapped — idempotent
      try {
        await createFirstOrgAndAdmin({ name, email, password });
      } catch {
        // createFirstOrgAndAdmin already logged the specific failure reason via console.error —
        // swallow here so a headless-bootstrap failure can never block server startup.
      }
    });
  } catch (err) {
    if (err instanceof TenantSeedLockTimeout) {
      console.error(
        "[bootstrap] Skipped the headless admin bootstrap: another seed holds the tenant seed lock.",
      );
      return;
    }
    throw err;
  }
}
