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
//
// Run charter rule J (decisions K108 to K113, .planning/run-loop/J1-RENCANA.md): project
// `aida-test-egress`, run-labelled resources, run-tagged images, an exclusive lock, and the
// preflight checks (project absent, tags free, subnet free, 20 GiB free on the host and in the
// Docker VM) before anything is built. Teardown removes only this run's resources through
// scripts/test-docker-cleanup.ts; there is no `down -v`.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  applyCleanup,
  type DockerRunner,
  type ExactRefs,
  planExact,
  teardownRefs,
} from "../../scripts/test-docker-cleanup";
import { recordResource, testRunId } from "../support/docker-test-labels";
import {
  acquireLock,
  assertComposeFollowsRuleJ,
  type ComposeConfig,
  composeResourceNames,
  runBuildPreflight,
  runDocker,
} from "../support/docker-test-preflight";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const COMPOSE_FILE = path.join(PROJECT_ROOT, "docker-compose.egress-test.yml");
// Rule J: test projects start with aida-test-; this one is named exactly aida-test-egress. Never
// the default "aida" project of docker-compose.yml, whose services (app/worker/migrate) collide.
const COMPOSE_PROJECT = "aida-test-egress";
const EGRESS_SUBNET = "10.90.0.0/24"; // must match docker-compose.egress-test.yml
const RUN_ID = testRunId();
// One DNS log directory per run (K113). It lives under the repo, not os.tmpdir(): Colima mounts
// only the home directory into its VM, so a bind mount from /var/folders would never reach the
// host. The parent `.dns-log/` is gitignored.
const DNS_LOG_ROOT = path.join(PROJECT_ROOT, "tests", "integration", "egress-fixtures", ".dns-log");
let dnsLogDir = "";
const dnsLogPath = () => path.join(dnsLogDir, "dns-queries.log");
let releaseLock: (() => void) | undefined;
// Set right before `compose build`. Before it, the only Docker resource this invocation makes is
// the preflight's own `--rm` space probe, so a stop in preflight triggers no suite cleanup (K121);
// a probe that failed to remove itself is left for `pnpm test:docker-cleanup --run <id>`.
let buildStarted = false;
// The image tags and network and volume names this invocation proved absent and then created.
// Teardown removes these plus the project's containers, each re-checked for this run's labels
// (K121, K122). Containers are listed at teardown time, so a second invocation with the same run
// id that bypassed the lock could lose its containers: the known limit K115.
const created: ExactRefs = { container: [], network: [], volume: [], image: [] };

function composeEnv(): NodeJS.ProcessEnv {
  return { ...process.env, AIDA_TEST_RUN_ID: RUN_ID, AIDA_TEST_DNS_LOG_DIR: dnsLogDir };
}

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
        env: composeEnv(),
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

/** Every container of this project, including stopped ones; a failed listing throws. */
function projectContainers(): { id: string; name: string }[] {
  const ps = dc(["ps", "-a", "--format", "{{.ID}} {{.Name}}"]);
  if (ps.code !== 0) throw new Error(`docker compose ps failed (code ${ps.code}):\n${ps.stderr}`);
  return ps.stdout
    .split("\n")
    .map((l) => l.trim().split(" "))
    .filter(([id, name]) => Boolean(id && name))
    .map(([id, name]) => ({ id, name }));
}

function projectContainerIds(): string[] {
  return projectContainers().map((c) => c.id);
}

/** Records the project's containers, and the network and volume once they exist (K124). */
function recordProjectResources(names: { networks: string[]; volumes: string[] }): void {
  for (const { id, name } of projectContainers()) {
    recordResource(RUN_ID, { type: "container", name, id, state: "created" });
  }
  for (const [type, list] of [
    ["network", names.networks],
    ["volume", names.volumes],
  ] as const) {
    for (const name of list) {
      const inspected = runDocker([type, "inspect", "--format", "{{.Name}}", name]);
      if (inspected.code === 0) recordResource(RUN_ID, { type, name, state: "created" });
    }
  }
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
  if (!dnsLogDir || !fs.existsSync(dnsLogPath())) return [];
  return fs
    .readFileSync(dnsLogPath(), "utf-8")
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

// Plan 09-12 (AIDA-40; reviews P12, Q6): scripts/install.sh runs on the operator's host before any
// container exists, so the stack below cannot observe its download. This describe pins it
// statically instead and needs no Docker: it uses none of the stack's hooks or helpers, so
// `vitest run --config vitest.egress.config.ts -t "<this describe's name>"` runs it alone and
// starts nothing. Its runtime evidence is tests/unit/install-script.test.ts (fake curl).
describe("installer egress inventory", () => {
  test("scripts/install.sh makes exactly one download, from github.com, and docs/SECURITY.md lists it", () => {
    const script = fs.readFileSync(path.join(PROJECT_ROOT, "scripts", "install.sh"), "utf8");
    const code = script.split("\n").filter((line) => !/^\s*#/.test(line));

    // A network tool in command position: line start, after ; & | ( or $( or a backquote, or
    // after then/do/else/exec/command/env, with or without a directory in front of it.
    const invocation =
      /(?:^|[;&|(`]|\$\(|\b(?:then|do|else|exec|command|env)\s)\s*(?:\S*\/)?(curl|wget|nc|ncat|socat|ftp|telnet)\b/;
    const calls = code.filter((line) => invocation.test(line));
    expect(calls, calls.join("\n")).toHaveLength(1);
    expect(invocation.exec(calls[0])?.[1]).toBe("curl");
    // Every other mention of curl is a preflight `need curl`; no other network tool at all.
    const mentions = code
      .filter((line) => /\bcurl\b/.test(line) && line !== calls[0])
      .map((line) => line.trim());
    expect(mentions.length).toBeGreaterThan(0);
    expect(new Set(mentions)).toEqual(new Set(["need curl"]));
    expect(
      code.filter((line) => /\b(?:wget|nc|ncat|socat|telnet)\b|\/dev\/(?:tcp|udp)/.test(line)),
    ).toEqual([]);

    // The one call downloads the one URL the script builds, and that URL's host is github.com.
    expect(calls[0]).toContain('"$url"');
    const assigned = code
      .filter((line) => /^\s*\w+="?https?:\/\//.test(line))
      .map((line) => line.trim());
    expect(assigned).toEqual(['url="https://github.com/$REPO/archive/refs/tags/$1.tar.gz"']);
    expect(new URL("https://github.com/x/x/archive/refs/tags/x.tar.gz").host).toBe("github.com");
    // Any other URL in the script is only printed (the app's local address), never fetched.
    const hosts = code
      .flatMap((line) => line.match(/https?:\/\/[^\s"'}]+/g) ?? [])
      .map((literal) => new URL(literal.replace(/\$\w+/g, "x")).hostname);
    expect(hosts.filter((host) => host === "github.com")).toHaveLength(1);
    expect(hosts.filter((host) => host !== "github.com" && host !== "localhost")).toEqual([]);

    // docs/SECURITY.md records it in its egress section, including GitHub's redirect host.
    const security = fs.readFileSync(path.join(PROJECT_ROOT, "docs", "SECURITY.md"), "utf8");
    const egress =
      security.split(/^## /m).find((section) => section.startsWith("Data residency & egress")) ??
      "";
    for (const name of [
      "Installer network use",
      "scripts/install.sh",
      "github.com",
      "codeload.github.com",
    ]) {
      expect(egress, name).toContain(name);
    }
  });
});

describe("egress isolation: no flow requires a route to the public internet", () => {
  beforeAll(async () => {
    releaseLock = acquireLock(RUN_ID);
    fs.mkdirSync(DNS_LOG_ROOT, { recursive: true });
    dnsLogDir = fs.mkdtempSync(path.join(DNS_LOG_ROOT, "run-"));

    // Resolve the compose file (with the `control` profile, so negative-control is checked too)
    // and refuse it unless every resource follows rule J. Then the preflight checks, before any
    // build; until the build, only the preflight's own `--rm` space probe touches Docker.
    const config = dc(["--profile", "control", "config", "--format", "json"], { timeout: 60_000 });
    if (config.code !== 0) throw new Error(`docker compose config failed:\n${config.stderr}`);
    const resolved = JSON.parse(config.stdout) as ComposeConfig;
    const tags = assertComposeFollowsRuleJ(resolved, COMPOSE_PROJECT, RUN_ID);
    const names = composeResourceNames(resolved);
    runBuildPreflight(runDocker, {
      runId: RUN_ID,
      project: COMPOSE_PROJECT,
      tags,
      subnet: EGRESS_SUBNET,
      hostDirs: [os.homedir(), PROJECT_ROOT],
      networkNames: names.networks,
      volumeNames: names.volumes,
    });

    // Build once, after the checks; `up` and `run` never rebuild, retag or pull (K111, K116).
    // The tags and the network and volume names were all proven absent above, under the lock.
    created.image = tags;
    created.network = names.networks;
    created.volume = names.volumes;
    for (const tag of tags) recordResource(RUN_ID, { type: "image", name: tag, state: "planned" });
    buildStarted = true;
    const build = dc(["build"], { timeout: 480_000 });
    if (build.code !== 0) {
      throw new Error(
        `docker compose build failed (code ${build.code}):\n${build.stderr}\n${build.stdout}`,
      );
    }
    for (const tag of tags) recordResource(RUN_ID, { type: "image", name: tag, state: "created" });
    const up = dc(["up", "-d", "--no-build", "--pull", "never"], { timeout: 300_000 });
    let ledgerError = "";
    try {
      recordProjectResources(names);
    } catch (err) {
      ledgerError = String(err);
    }
    if (up.code !== 0) {
      throw new Error(
        `docker compose up failed (code ${up.code}):\n${up.stderr}\n${up.stdout}${ledgerError ? `\nledger: ${ledgerError}` : ""}`,
      );
    }
    if (ledgerError) throw new Error(`recording the project's resources failed: ${ledgerError}`);

    await waitForHealthy("app", 120_000);
  }, 900_000);

  afterAll(() => {
    // Without the lock this invocation created nothing, and another holder may be using the
    // same run id: remove nothing (K114).
    if (!releaseLock) return;
    let failures: string[] = [];
    try {
      // The decision lives in teardownRefs() so it is unit-tested: nothing before the build
      // started (whatever made the preflight stop is not ours), otherwise only the recorded refs
      // plus the project's containers, each re-checked before removal (K108, K121, K122).
      const refs = teardownRefs({ lockHeld: true, buildStarted, created }, projectContainerIds);
      if (refs) {
        const docker: DockerRunner = (args) =>
          execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
        const { plan, notOurs } = planExact(docker, RUN_ID, refs);
        for (const other of notOurs) {
          console.warn(`left alone (not this run's): ${other.type} ${other.name}`);
        }
        const result = applyCleanup(docker, RUN_ID, plan);
        failures = result.failed.map((f) => `${f.resource.type} ${f.resource.name}: ${f.error}`);
      }
    } finally {
      releaseLock?.();
      if (dnsLogDir) fs.rmSync(dnsLogDir, { recursive: true, force: true });
    }
    if (failures.length > 0) {
      throw new Error(`cleanup of run ${RUN_ID} left resources:\n${failures.join("\n")}`);
    }
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

    recordResource(RUN_ID, {
      type: "container",
      name: `${COMPOSE_PROJECT} negative-control run`,
      state: "planned",
    });
    const control = dc(["run", "--rm", "--pull", "never", "negative-control"], { timeout: 30_000 });
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
