// ---------------------------------------------------------------------------
// bootstrap-demo.ts — flag-gated demo bootstrap (07-07, AIDA-22 / D-02; 09-02, AIDA-37).
//
// Turns `docker compose up` with DEMO_MODE=true into an instantly explorable,
// fully populated helpdesk. Strictly opt-in (DEMO_MODE must be exactly
// "true"), loud in the logs (known credentials are being created), and a
// failed seed must NEVER block the app from starting — see instrumentation.ts.
//
// The tenant guard (tenant-guard.ts) decides: an empty database is seeded, a database holding
// the complete marked demo is left as it is, and anything else is refused with one log line
// and no write. Every outcome and every error ends in one log line and a normal return.
// ---------------------------------------------------------------------------
import { runGuardedDemoSeed } from "@/lib/demo/tenant-guard";

export async function bootstrapDemoMode(): Promise<void> {
  if (process.env.DEMO_MODE !== "true") return;

  // Logged before anything else so the warning appears even if seeding below fails.
  console.warn(
    "[demo] DEMO MODE IS ACTIVE. This instance auto-creates accounts with PUBLICLY DOCUMENTED credentials and loads fictional data. Never expose it to the internet or use it for real tickets.",
  );

  try {
    const outcome = await runGuardedDemoSeed({ caller: "demo-boot" });
    switch (outcome.kind) {
      case "seeded":
        console.info(
          "[demo] Seeded the demo workspace in %dms. Sign in at / with %s (the password is DEMO_ADMIN_PASSWORD from the environment).",
          outcome.durationMs,
          outcome.adminEmail,
        );
        return;
      case "already-seeded":
        console.info("[demo] The complete demo workspace is already present; nothing written.");
        return;
      case "refused-partial":
        console.error(
          "[demo] Refusing to seed: this database holds an incomplete demo workspace (no completion marker); nothing written. See docs/OPERATIONS.md, Demo mode, for the manual recovery on a new database.",
        );
        return;
      case "refused-foreign":
        console.error(
          "[demo] Refusing to seed: this database already holds a workspace that is not the demo; nothing written. Point DEMO_MODE at a new, separate database instead (docs/OPERATIONS.md, Demo mode).",
        );
        return;
      case "refused-config":
        console.error(
          "[demo] Refusing to seed: DEMO_ADMIN_EMAIL and DEMO_AGENT_EMAIL are the same address; nothing written. Set two different addresses.",
        );
        return;
      case "lock-timeout":
        console.error(
          "[demo] Skipped the demo seed: another seed holds the tenant seed lock; nothing written.",
        );
        return;
    }
  } catch (error) {
    // A failed demo seed must never prevent the app from starting.
    console.error(
      "[demo] Demo seeding failed:",
      error instanceof Error ? error.message : String(error),
    );
  }
}
