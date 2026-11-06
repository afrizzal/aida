// ---------------------------------------------------------------------------
// prisma/seed.ts — CLI entrypoint for `pnpm db:seed` (07-02, AIDA-22; 09-02, AIDA-37).
//
// Turns a freshly-migrated, EMPTY database into a fully populated demo
// helpdesk in one command. The tenant guard (src/lib/demo/tenant-guard.ts,
// shared with the DEMO_MODE boot) classifies the database before any write:
//   - empty (no organization and no user): seed, exit 0;
//   - the complete marked demo workspace: print "already seeded", exit 0;
//   - an incomplete demo or any other workspace: refuse, write nothing, exit 1;
//   - DEMO_ADMIN_EMAIL and DEMO_AGENT_EMAIL the same address: refuse before any read or write,
//     exit 1 (review a-WR-3).
// The seed never deletes anything (owner decision 2026-11-11 item 3) and never prints a
// password (D-18).
//
// tsx resolves the `@/` alias from the root tsconfig.json.
// ---------------------------------------------------------------------------
import "dotenv/config";
import { prisma } from "@/lib/db";
import { runGuardedDemoSeed } from "@/lib/demo/tenant-guard";

async function main(): Promise<void> {
  let exitCode = 1;
  try {
    const outcome = await runGuardedDemoSeed({ caller: "seed-cli" });
    switch (outcome.kind) {
      case "seeded":
        // scripts/capture-demo-assets.ts parses `"tickets": N` from this JSON.
        console.log(JSON.stringify(outcome.summary, null, 2));
        console.log("");
        console.log(
          `[seed] Demo workspace seeded. Sign in with ${outcome.adminEmail}; the password is DEMO_ADMIN_PASSWORD from your environment (see docs/OPERATIONS.md).`,
        );
        exitCode = 0;
        break;
      case "already-seeded":
        console.log(
          "[seed] This database already holds the complete demo workspace; nothing written.",
        );
        exitCode = 0;
        break;
      case "refused-partial":
        console.log(
          "[seed] Refusing to seed: this database holds an incomplete demo workspace (no completion marker); nothing written. See docs/OPERATIONS.md, Demo mode, for the manual recovery on a new, separate database.",
        );
        break;
      case "refused-foreign":
        console.log(
          "[seed] Refusing to seed: this database already holds a workspace that is not the demo; nothing written. Seed a new, separate database instead (docs/OPERATIONS.md, Demo mode).",
        );
        break;
      case "refused-config":
        console.log(
          "[seed] Refusing to seed: DEMO_ADMIN_EMAIL and DEMO_AGENT_EMAIL are the same address; nothing written. Set two different addresses.",
        );
        break;
      case "lock-timeout":
        console.log(
          "[seed] Refusing to seed: another seed or bootstrap holds the tenant seed lock; nothing written. Try again when it has finished.",
        );
        break;
    }
  } catch (error) {
    console.error("[seed] Failed:", error instanceof Error ? error.message : String(error));
    exitCode = 1;
  }
  // Required: createKbArticle() leaves a pg-boss connection pool open (kb-embed-article
  // enqueue), which would otherwise hang the process indefinitely.
  await prisma.$disconnect().catch(() => {});
  process.exit(exitCode);
}

void main();
