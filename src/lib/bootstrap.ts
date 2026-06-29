import { auth } from "./auth";
import { prisma } from "./db";

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

  // Create admin user
  const signUpResponse = await auth.api.signUpEmail({
    body: { name, email, password },
  });

  if (!signUpResponse?.user?.id) {
    console.error("[bootstrap] Failed to create admin user for", email);
    return;
  }

  const userId = signUpResponse.user.id;

  // Create organization (system action — userId bypasses allowUserToCreateOrganization: false)
  const orgResponse = await auth.api.createOrganization({
    body: { name: "AIDA", slug: "aida", userId },
  });

  if (!orgResponse?.id) {
    console.error("[bootstrap] Failed to create organization for admin", email);
    return;
  }

  // Mark setup complete
  await prisma.systemSetting.upsert({
    where: { key: "setupComplete" },
    update: { value: "true" },
    create: { key: "setupComplete", value: "true" },
  });

  console.info("[bootstrap] Created admin:", email);
}
