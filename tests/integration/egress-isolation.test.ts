// Egress-isolation proof (07-09.1 Task 1 / AIDA-20 / "no third-party egress").
//
// D-1 (07-09.1-PLAN.md, LOCKED): egress is proven by DENIAL, not observation. Boots the real
// production image (docker-compose.egress-test.yml) on a Docker network declared
// `internal: true` — verified experimentally (see this project's Task 1 SUMMARY) that such a
// network has NO default route out at all: neither outbound (raw-IP connect attempts get
// `ENETUNREACH` immediately) nor inbound (published `ports:` silently don't work, which is why
// every flow here is driven via `docker compose exec`/`run` — those talk to the Docker daemon's
// control plane, not the container network, so they work regardless).
//
// Runs via `pnpm test:egress` (NOT part of the default `pnpm test:integration` / PR path — see
// package.json and vitest.egress.config.ts: this suite builds a multi-container stack and is
// intentionally slow).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const COMPOSE_FILE = path.join(PROJECT_ROOT, "docker-compose.egress-test.yml");
const COMPOSE_PROJECT = "aida-egress-test"; // explicit — never share the default "aida" project
// name with the main docker-compose.yml, whose services (app/worker/migrate) would collide.
const DNS_LOG_DIR = path.join(PROJECT_ROOT, "tests", "integration", "egress-fixtures", ".dns-log");
const DNS_LOG_PATH = path.join(DNS_LOG_DIR, "dns-queries.log");

function dc(
  args: string[],
  opts: { timeout?: number } = {},
): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(
      "docker",
      ["compose", "-p", COMPOSE_PROJECT, "-f", COMPOSE_FILE, ...args],
      {
        cwd: PROJECT_ROOT,
        encoding: "utf-8",
        timeout: opts.timeout ?? 300_000,
        maxBuffer: 32 * 1024 * 1024,
      },
    );
    return { code: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status?: number | null; stdout?: string; stderr?: string; message?: string };
    return {
      code: e.status ?? 1,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? e.message ?? String(err),
    };
  }
}

function containerId(service: string): string {
  const { stdout } = dc(["ps", "-q", service]);
  const id = stdout.trim();
  if (!id) throw new Error(`no running container found for service "${service}"`);
  return id;
}

async function waitForHealthy(service: string, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = "";
  while (Date.now() < deadline) {
    const id = containerId(service);
    lastStatus = execFileSync("docker", ["inspect", "--format", "{{.State.Health.Status}}", id], {
      encoding: "utf-8",
    }).trim();
    if (lastStatus === "healthy") return;
    if (lastStatus === "unhealthy") throw new Error(`${service} reported unhealthy`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(
    `${service} did not become healthy within ${timeoutMs}ms (last status: ${lastStatus})`,
  );
}

function readDnsLogLines(): string[] {
  if (!fs.existsSync(DNS_LOG_PATH)) return [];
  return fs
    .readFileSync(DNS_LOG_PATH, "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

function queriedNames(lines: string[]): string[] {
  return lines.map((l) => l.match(/name=(\S+)/)?.[1] ?? "<unparsed>");
}

interface ProbeFlowResult {
  name: string;
  ok: boolean;
  detail?: string;
}
interface ProbeOutput {
  orgId?: string;
  results: ProbeFlowResult[];
  fatal?: string;
}

function runProbe(): { code: number; probe: ProbeOutput | null; stdout: string; stderr: string } {
  const { code, stdout, stderr } = dc(
    [
      "exec",
      "-T",
      "runner",
      "node",
      "node_modules/tsx/dist/cli.mjs",
      "tests/integration/egress-fixtures/probe.ts",
    ],
    { timeout: 180_000 },
  );
  const resultLine = stdout.split("\n").find((l) => l.startsWith("PROBE_RESULT:"));
  const probe = resultLine
    ? (JSON.parse(resultLine.slice("PROBE_RESULT:".length)) as ProbeOutput)
    : null;
  return { code, probe, stdout, stderr };
}

describe("egress isolation: no flow requires a route to the public internet", () => {
  beforeAll(async () => {
    fs.rmSync(DNS_LOG_DIR, { recursive: true, force: true });
    fs.mkdirSync(DNS_LOG_DIR, { recursive: true });

    const up = dc(["up", "-d", "--build"], { timeout: 480_000 });
    if (up.code !== 0) {
      throw new Error(`docker compose up failed (code ${up.code}):\n${up.stderr}\n${up.stdout}`);
    }

    await waitForHealthy("app", 120_000);
  }, 600_000);

  afterAll(() => {
    dc(["down", "-v", "--remove-orphans"], { timeout: 120_000 });
  }, 180_000);

  test("the production app container reaches a HEALTHY state with no route to the internet", () => {
    // Re-assert (beforeAll already waited for this) — a first-class, named assertion rather
    // than only an implicit precondition of the tests below.
    const id = containerId("app");
    const status = execFileSync("docker", ["inspect", "--format", "{{.State.Health.Status}}", id], {
      encoding: "utf-8",
    }).trim();
    expect(status).toBe("healthy");
  });

  test("provider Test Connection, auto-triage, KB embed + draft, an Insight run, and outbound email ALL succeed", () => {
    const { code, probe, stdout, stderr } = runProbe();

    expect(
      probe,
      `no PROBE_RESULT line found in probe output.\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
    ).not.toBeNull();
    expect(probe?.fatal, `probe crashed: ${probe?.fatal}`).toBeUndefined();

    const flows = probe?.results ?? [];
    expect(flows.length).toBeGreaterThan(0);
    for (const flow of flows) {
      expect(flow.ok, `flow "${flow.name}" failed: ${flow.detail ?? "(no detail)"}`).toBe(true);
    }
    expect(code, "probe.ts must exit 0 when every flow succeeds").toBe(0);
  });

  test("the observed-destination set is a subset of {postgres, stub LLM, stub SMTP} — asserted, not merely logged", () => {
    // db/stub-llm/stub-smtp are all reached by their Docker Compose SERVICE NAME — resolved
    // entirely by each container's embedded per-container DNS resolver (127.0.0.11), which
    // NEVER forwards a service-name lookup to the custom `dns:` override. So the correct,
    // non-vacuous claim here is that dns-logger observed ZERO lookups during the flows above:
    // nothing outside {db, stub-llm, stub-smtp} was even attempted, and those three were never
    // even candidates for forwarding in the first place (proven separately, honestly, by the
    // negative-control test below, which forces a real forward to prove the mechanism itself
    // works). An empty set is trivially a subset of {postgres, stub LLM, stub SMTP}; asserting
    // it explicitly (rather than skipping the check) is what makes this a real assertion.
    const observed = new Set(queriedNames(readDnsLogLines()));
    const allowed = new Set(["postgres", "stub-llm", "stub-smtp"]);
    for (const name of observed) {
      expect(allowed.has(name), `unexpected external destination observed: ${name}`).toBe(true);
    }
    expect(
      observed.size,
      `expected zero forwarded lookups; observed: ${[...observed].join(", ")}`,
    ).toBe(0);
  });

  test("negative control: a deliberate external lookup IS captured — proves the capture mechanism actually works", () => {
    const before = readDnsLogLines().length;

    const control = dc(["run", "--rm", "negative-control"], { timeout: 30_000 });
    expect(control.code, `negative-control container failed: ${control.stderr}`).toBe(0);

    const deadline = Date.now() + 10_000;
    let lines: string[] = [];
    while (Date.now() < deadline) {
      lines = readDnsLogLines();
      if (lines.length > before) break;
    }

    const newLines = lines.slice(before);
    expect(
      newLines.length,
      "dns-logger recorded no new query — the capture mechanism failed to observe the deliberate lookup",
    ).toBeGreaterThan(0);
    expect(newLines.some((l) => l.includes("canary.aida-egress-negative-control.invalid"))).toBe(
      true,
    );
  });
});
