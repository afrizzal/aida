export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Refuse to boot on a DATABASE_URL that disagrees with the POSTGRES_* values compose passes as
    // AIDA_EXPECT_DB_* (D-12(4), AIDA-35). The message names the component, never a value.
    // Inactive in `next dev` and the E2E server, which never receive AIDA_EXPECT_*.
    const { assertDatabaseUrlConsistent, DatabaseUrlMismatchError } = await import("@/lib/db-url");
    try {
      assertDatabaseUrlConsistent(process.env);
    } catch (err) {
      if (err instanceof DatabaseUrlMismatchError) {
        console.error(`[boot] ${err.message}`);
        process.exit(1);
      }
      throw err;
    }
    // Refuse to boot on a BETTER_AUTH_URL that is set but is not a bare http(s) origin (K165): a
    // path breaks sign-in or every invitation link. The message names the variable, never a value.
    const { AppUrlError, assertAppUrlAtStart } = await import("@/lib/app-url");
    try {
      assertAppUrlAtStart(process.env);
    } catch (err) {
      if (err instanceof AppUrlError) {
        console.error(`[boot] ${err.message}`);
        process.exit(1);
      }
      throw err;
    }
    // One log line, never a boot failure; the limiter keeps failing closed (review b-IN-b7).
    const { warnIfRateLimitPepperUnsafe } = await import("@/lib/rate-limit/pepper-check");
    warnIfRateLimitPepperUnsafe();
    // Both steps take the tenant seed lock with the short boot waits, so the app serves within
    // a stated time (K146): see BOOT_TENANT_SEED_LOCK_OPTIONS. Neither step throws.
    const { BOOT_TENANT_SEED_LOCK_OPTIONS } = await import("@/lib/tenant-seed-lock");
    const { bootstrapFromEnv } = await import("@/lib/bootstrap");
    await bootstrapFromEnv(BOOT_TENANT_SEED_LOCK_OPTIONS);
    // Demo mode is a no-op unless DEMO_MODE === "true"; imported lazily so the demo
    // fixtures never load in a normal production boot.
    const { bootstrapDemoMode } = await import("@/lib/demo/bootstrap-demo");
    await bootstrapDemoMode(BOOT_TENANT_SEED_LOCK_OPTIONS);
  }
}
