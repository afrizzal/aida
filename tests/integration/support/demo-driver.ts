// Test-only child-process driver for the tenant seed guard (plan 09-02, AIDA-37, AIDA-38).
//
// Run with tsx as a separate process, DATABASE_URL and every DEMO_* and ADMIN_* variable set
// explicitly by the test (this file loads no .env). Each process gets its own pool, so two
// drivers started together race for real on the advisory lock, and a crash is a real end of
// the seeding process.
//
//   tsx tests/integration/support/demo-driver.ts <mode> [<mode> ...] [--crash-at <stage>]
//       [--lock-timeout-ms <n>]
//
// Modes run in the order given, in this one process (as src/instrumentation.ts runs
// bootstrapFromEnv and then the demo boot):
//   demo-boot          bootstrapDemoMode() with DEMO_MODE=true (the real boot path)
//   guarded-demo-boot  runGuardedDemoSeed({ caller: "demo-boot" })
//   guarded-seed-cli   runGuardedDemoSeed({ caller: "seed-cli" })
//   bootstrap-env      bootstrapFromEnv()
//   classify           classifyTenantData() under the tenant seed lock (read only)
//   heartbeat          the worker's heartbeat handler, called directly (writes SystemSetting)
//   pgboss-start       starts and stops pg-boss once (creates its schema, infrastructure only)
//
// `--crash-at <stage>` passes hooks.afterStage that throws once that stage has committed: the
// only way a crash is injected. Production code reads no environment variable or argv for it.
// The last stdout line is `AIDA_DRIVER_RESULT <json>`.
import { PgBoss } from "pg-boss";
import { bootstrapFromEnv } from "../../../src/lib/bootstrap";
import { prisma } from "../../../src/lib/db";
import { bootstrapDemoMode } from "../../../src/lib/demo/bootstrap-demo";
import {
  classifyTenantData,
  DEMO_SEED_STAGES,
  type DemoSeedHooks,
  type DemoSeedStage,
  runGuardedDemoSeed,
} from "../../../src/lib/demo/tenant-guard";
import { withTenantSeedLock } from "../../../src/lib/tenant-seed-lock";
import { heartbeatHandler } from "../../../src/lib/worker/jobs/heartbeat";

const MODES = [
  "demo-boot",
  "guarded-demo-boot",
  "guarded-seed-cli",
  "bootstrap-env",
  "classify",
  "heartbeat",
  "pgboss-start",
] as const;
type Mode = (typeof MODES)[number];

const DRIVER_RESULT_PREFIX = "AIDA_DRIVER_RESULT ";

class InjectedCrash extends Error {
  constructor(readonly stage: DemoSeedStage) {
    super(`injected crash after stage ${stage}`);
  }
}

function parseArgs(argv: string[]): {
  modes: Mode[];
  crashAt: DemoSeedStage | null;
  lockTimeoutMs: number | undefined;
} {
  const modes: Mode[] = [];
  let crashAt: DemoSeedStage | null = null;
  let lockTimeoutMs: number | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--crash-at") {
      const stage = argv[++i] as DemoSeedStage;
      if (!DEMO_SEED_STAGES.includes(stage)) throw new Error(`unknown stage ${String(stage)}`);
      crashAt = stage;
    } else if (arg === "--lock-timeout-ms") {
      lockTimeoutMs = Number(argv[++i]);
      if (!Number.isInteger(lockTimeoutMs) || lockTimeoutMs < 1) throw new Error("bad timeout");
    } else if ((MODES as readonly string[]).includes(arg)) {
      modes.push(arg as Mode);
    } else {
      throw new Error(`unknown argument ${arg}`);
    }
  }
  if (modes.length === 0) throw new Error("no mode given");
  return { modes, crashAt, lockTimeoutMs };
}

async function runMode(
  mode: Mode,
  hooks: DemoSeedHooks,
  lockTimeoutMs: number | undefined,
): Promise<Record<string, unknown>> {
  try {
    switch (mode) {
      case "demo-boot":
        process.env.DEMO_MODE = "true";
        await bootstrapDemoMode();
        return { mode, outcome: "returned" };
      case "guarded-demo-boot":
      case "guarded-seed-cli": {
        const outcome = await runGuardedDemoSeed({
          caller: mode === "guarded-seed-cli" ? "seed-cli" : "demo-boot",
          hooks,
          lockTimeoutMs,
        });
        return { mode, outcome: outcome.kind };
      }
      case "bootstrap-env":
        await bootstrapFromEnv();
        return { mode, outcome: "returned" };
      case "classify": {
        const classification = await withTenantSeedLock((tx) => classifyTenantData(tx));
        return { mode, outcome: classification };
      }
      case "heartbeat":
        await heartbeatHandler();
        return { mode, outcome: "returned" };
      case "pgboss-start": {
        const boss = new PgBoss(process.env.DATABASE_URL as string);
        boss.on("error", () => {});
        await boss.start();
        await boss.stop();
        return { mode, outcome: "returned" };
      }
    }
  } catch (err) {
    if (err instanceof InjectedCrash) return { mode, outcome: "crashed", stage: err.stage };
    return { mode, outcome: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

async function main(): Promise<void> {
  const { modes, crashAt, lockTimeoutMs } = parseArgs(process.argv.slice(2));
  const hooks: DemoSeedHooks = {
    afterStage: (stage) => {
      if (stage === crashAt) throw new InjectedCrash(stage);
    },
  };
  const results: Record<string, unknown>[] = [];
  for (const mode of modes) results.push(await runMode(mode, hooks, lockTimeoutMs));
  console.log(`${DRIVER_RESULT_PREFIX}${JSON.stringify({ results })}`);
  await prisma.$disconnect().catch(() => {});
  // pg-boss (started by the KB writes of a seed) keeps its own pool open; end the process.
  process.exit(0);
}

main().catch((err) => {
  console.error("[demo-driver] failed:", err instanceof Error ? err.message : String(err));
  process.exit(2);
});
