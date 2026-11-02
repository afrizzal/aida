// ---------------------------------------------------------------------------
// scripts/test-image-check.ts: the build-path image check of plan 08-09 (D-08, D-27) under run
// charter rule J and review R3-3.
//
// It reuses the J1 modules (tests/support/docker-test-labels.ts, tests/support/docker-test-
// preflight.ts, scripts/test-docker-cleanup.ts) and duplicates none of them. It builds ONE
// Dockerfile target under the unique labelled tag `aida-test-nonroot-<target>:<runId>`, only after
// J1's lock, tag check and 20 GiB preflight; it reads the image with `docker image inspect` only;
// it starts no container of its own (J1's labelled space probe inside the preflight is the only
// one); it removes only its own tag, by `repo:tag` through J1's applyCleanup, and only while that
// tag still points to the image ID recorded right after the build. The build cache, base images
// and every other resource are left alone (K109). K115 stays open: the ID check and the removal
// are not atomic against a process that ignores the lock.
//
//   pnpm exec tsx scripts/test-image-check.ts --target runner|builder
//   pnpm exec tsx scripts/test-image-check.ts --verify <log> <exit> <target>
//
// Output: exactly one IMAGE-CHECK-TEARDOWN line and one IMAGE-CHECK-RESULT line. Exit 0 passed,
// 1 failed, 3 blocked, 4 not run, 2 usage. On SIGINT or SIGTERM the docker build client is stopped,
// the same teardown runs on this run's own records only, and the run ends `not run (interrupted)`
// with exit 4; --verify refuses that result.
// ---------------------------------------------------------------------------
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  dockerNotFound,
  isRunId,
  type LedgerEntry,
  RUN_LABEL,
  recordResource,
  TEST_LABEL,
  TEST_NAME_PREFIX,
  testLabels,
  testResourceName,
  testRunId,
} from "../tests/support/docker-test-labels";
import {
  acquireLock,
  type Docker,
  type PreflightOptions,
  runBuildPreflight,
  runDocker,
  tagState,
} from "../tests/support/docker-test-preflight";
import {
  BASE_IMAGE,
  baseImageProblem,
  type CheckState,
  EXIT_CODES,
  type ImageCheckResult,
  J1_SPACE_STOP,
  RESULT_PREFIX,
  TEARDOWN_PREFIX,
  TELEMETRY_VARS,
  type TeardownLine,
  verifyImageCheckLog,
} from "./image-check-verify";
import {
  applyCleanup,
  type DockerRunner,
  type ExactRefs,
  planExact,
  teardownRefs,
} from "./test-docker-cleanup";

// The validation lives in the pure module (K133); these names stay importable from here.
export {
  BASE_IMAGE,
  baseImageProblem,
  type CheckState,
  EXIT_CODES,
  type ImageCheckResult,
  J1_SPACE_STOP,
  RESULT_PREFIX,
  summaryWord,
  TEARDOWN_PREFIX,
  TELEMETRY_VARS,
  type TeardownLine,
  VERIFY_PREFIX,
  verifyImageCheckLog,
} from "./image-check-verify";

export const IMAGE_CHECK_TARGETS = ["runner", "builder"] as const;
export type ImageCheckTarget = (typeof IMAGE_CHECK_TARGETS)[number];

/** Ten minutes without new build output ends the build (the binaries.prisma.sh stall, 2026-11-08). */
export const BUILD_QUIET_MS = 600_000;

/** After SIGTERM to the docker client (watchdog or interrupt), SIGKILL follows this much later. */
export const KILL_GRACE_MS = 10_000;

const EVIDENCE_MAX = 4000;
const DOCKER_DOWN = [
  "failed to connect to the docker API",
  "Cannot connect to the Docker daemon",
  "error during connect",
];

export function imageCheckTag(target: string, runId: string): string {
  if (!(IMAGE_CHECK_TARGETS as readonly string[]).includes(target)) {
    throw new Error(`Unknown image check target: ${JSON.stringify(target)}`);
  }
  if (!isRunId(runId)) throw new Error(`Not a valid test run id: ${JSON.stringify(runId)}`);
  return `${TEST_NAME_PREFIX}nonroot-${target}:${runId}`;
}

/** No pull, push, output or cache flag: the moby driver resolves the local base image (K116). */
export function imageBuildArgs(target: string, tag: string, runId: string): string[] {
  const labels = Object.entries(testLabels(runId)).flatMap(([key, value]) => [
    "--label",
    `${key}=${value}`,
  ]);
  return ["build", "--target", target, ...labels, "--tag", tag, "."];
}

export interface Classification {
  state: "blocked" | "not run" | "failed";
  cause: string;
}

const hasAny = (text: string, needles: string[]): boolean => needles.some((n) => text.includes(n));

export function classifyPreflightFailure(message: string): Classification {
  if (hasAny(message, DOCKER_DOWN)) return { state: "blocked", cause: "docker" };
  if (J1_SPACE_STOP.test(message)) return { state: "blocked", cause: "space" };
  if (
    hasAny(message, [
      "Could not measure free space",
      "Cannot read free space",
      "Expected two df rows",
      "Expected one df row",
      "Cannot read the Docker root directory",
      "No host directory to measure",
    ])
  ) {
    return { state: "blocked", cause: "measure" };
  }
  if (message.includes("Lock ") && message.includes(" is held")) {
    return { state: "not run", cause: "lock" };
  }
  if (
    hasAny(message, [
      "already has a",
      "already exists",
      "already exist and must not be overwritten",
    ])
  ) {
    return { state: "not run", cause: "foreign" };
  }
  if (hasAny(message, ["Cannot list ", "Cannot tell whether", "Cannot inspect"])) {
    return { state: "blocked", cause: "docker" };
  }
  return { state: "failed", cause: "harness" };
}

/** A BuildKit error marker: `#12 ERROR: ...`, `ERROR: failed to solve: ...` or `error: ...`. */
const STEP_ERROR = /^#(\d+) ERROR: /;
const FINAL_ERROR = /^(?:ERROR|error): |failed to solve: /;
/** A network failure word; it counts only on the same line as a registry or engine download. */
const NET_FAILURE =
  /ENOTFOUND|ETIMEDOUT|EAI_AGAIN|ECONNRESET|ECONNREFUSED|socket hang up|i\/o timeout|timed out|no such host/;
/**
 * The anchored external signatures (c-WR-05). Each names the download that failed: the base image
 * pull, the npm registry through pnpm, or the Prisma engine download. A bare `@prisma/engines`,
 * `ENOTFOUND` or `ETIMEDOUT` elsewhere (pnpm install output, app code during `next build`) is not
 * one of them, so a genuine build error that mentions them stays `failed`.
 */
const EXTERNAL_SIGNATURES: ((line: string) => boolean)[] = [
  (l) => /failed to resolve source metadata for /.test(l),
  (l) => /\btoomanyrequests: /.test(l),
  (l) => /\bTLS handshake timeout\b/.test(l),
  (l) => /\bpull access denied for /.test(l),
  (l) => /dial tcp(?: [^ :]+)?: lookup [^ :]+(?: on [^ ]+)?: /.test(l) && NET_FAILURE.test(l),
  (l) => /\bERR_PNPM_(?:META_FETCH_FAIL|FETCH_\w+)\b/.test(l),
  (l) => /\bbinaries\.prisma\.sh\b/.test(l) && NET_FAILURE.test(l),
];

/**
 * The lines that describe the failing step: that step's last 20 output lines plus everything from
 * its `#N ERROR:` marker to the end (BuildKit's context block and the final `failed to solve`). With
 * no step marker, from the last final-error line; with no marker at all, the last 20 lines.
 */
export function failingStepLines(log: string): string[] {
  const all = log.split(/\r?\n/);
  let at = -1;
  let step: string | null = null;
  for (let i = all.length - 1; i >= 0; i--) {
    const m = all[i].match(STEP_ERROR);
    if (m) {
      at = i;
      step = m[1];
      break;
    }
  }
  if (at === -1) {
    for (let i = all.length - 1; i >= 0; i--) {
      if (FINAL_ERROR.test(all[i])) {
        at = i;
        break;
      }
    }
  }
  if (at === -1) return all.slice(-20);
  const own =
    step === null
      ? []
      : all
          .slice(0, at)
          .filter((l) => l.startsWith(`#${step} `))
          .slice(-20);
  return [...own, ...all.slice(at)];
}

/** No mirror is ever configured: an external stall is reported, never worked around. */
export function classifyBuildFailure(log: string, watchdogFired: boolean): Classification {
  const step = failingStepLines(log);
  if (step.some((l) => l.includes("no space left on device")))
    return { state: "blocked", cause: "space" };
  if (watchdogFired || step.some((l) => EXTERNAL_SIGNATURES.some((sig) => sig(l))))
    return { state: "blocked", cause: "external" };
  if (step.some((l) => hasAny(l, DOCKER_DOWN))) return { state: "blocked", cause: "docker" };
  return { state: "failed", cause: "build" };
}

interface ImageConfig {
  User?: unknown;
  Env?: unknown;
  Labels?: unknown;
}

function envEntries(config: ImageConfig, name: string): string[] {
  const env = Array.isArray(config.Env) ? config.Env.map(String) : [];
  return env.filter((entry) => entry.startsWith(`${name}=`));
}

function labelsOf(config: ImageConfig): Record<string, string> {
  return config.Labels && typeof config.Labels === "object"
    ? (config.Labels as Record<string, string>)
    : {};
}

/** One violation line per problem in the parsed `{{json .Config}}` of the image. */
export function inspectFindings(config: unknown, runId: string): string[] {
  const c = (config && typeof config === "object" ? config : {}) as ImageConfig;
  const out: string[] = [];
  if (c.User !== "node") out.push(`User is ${JSON.stringify(c.User ?? "")}, expected "node"`);
  for (const name of TELEMETRY_VARS) {
    const entries = envEntries(c, name);
    if (entries.length !== 1) out.push(`Env has ${entries.length} ${name} entries, expected 1`);
    else if (entries[0] !== `${name}=1`)
      out.push(`Env ${JSON.stringify(entries[0])}, expected ${name}=1`);
  }
  const labels = labelsOf(c);
  if (labels[TEST_LABEL] !== "1") out.push(`label ${TEST_LABEL} is not 1`);
  if (labels[RUN_LABEL] !== runId) out.push(`label ${RUN_LABEL} is not ${runId}`);
  return out;
}

/** A tag is removable only while it still points to the image ID recorded after the build. */
export function removableTags(
  recorded: Record<string, string>,
  current: Record<string, string | null>,
): { remove: string[]; leftAlone: string[] } {
  const remove: string[] = [];
  const leftAlone: string[] = [];
  for (const [tag, id] of Object.entries(current)) {
    if (id === null) continue;
    const want = recorded[tag];
    if (want === undefined) leftAlone.push(`${tag} unrecorded`);
    else if (want === id) remove.push(tag);
    else leftAlone.push(`${tag} now ${id}`);
  }
  return { remove, leftAlone };
}

export const DEFAULT_STEPS = {
  preflight: runBuildPreflight,
  lock: acquireLock,
  record: recordResource,
};

export interface BuildOutcome {
  code: number;
  watchdogFired: boolean;
}

export interface ImageCheckDeps {
  runId: string;
  repoRoot: string;
  hostDirs: string[];
  runDir: string;
  docker: Docker;
  cleanupDocker: DockerRunner;
  /** `signal` aborts on SIGINT or SIGTERM: the build must stop its child and settle. */
  build(
    args: string[],
    logFile: string,
    quietMs: number,
    signal: AbortSignal,
  ): Promise<BuildOutcome>;
  preflight?: (docker: Docker, options: PreflightOptions) => void;
  lock?: (runId: string) => () => void;
  record?: (runId: string, entry: LedgerEntry) => void;
  print?: (line: string) => void;
  /** Subscribes to SIGINT and SIGTERM; returns the unsubscribe. Default: none (main passes them). */
  interrupts?: (onSignal: (signal: string) => void) => () => void;
}

class Stop extends Error {
  constructor(
    readonly state: CheckState,
    readonly cause: string,
    readonly evidence: string,
  ) {
    super(evidence);
  }
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

function imageId(docker: Docker, ref: string): { id: string | null; error?: string } {
  const r = docker(["image", "inspect", "--format", "{{.Id}}", ref]);
  if (r.code === 0) return { id: r.stdout.trim() };
  if (dockerNotFound("image", ref, r.stderr)) return { id: null };
  return { id: null, error: r.stderr.trim() || `exit ${r.code}` };
}

/** The base image's ID, `absent` when the daemon has no such image, or `unreadable: <error>`. */
function baseImageId(docker: Docker): string {
  const r = imageId(docker, BASE_IMAGE);
  if (r.error !== undefined) return `unreadable: ${r.error}`;
  return r.id ?? "absent";
}

function readLog(file: string): string {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function tail(file: string, lines: number): string {
  return readLog(file).split("\n").slice(-lines).join("\n");
}

/** Builds, inspects and removes one target's image under rule J. Never throws. */
export async function runImageCheck(
  target: string,
  deps: ImageCheckDeps,
): Promise<ImageCheckResult> {
  const lock = deps.lock ?? DEFAULT_STEPS.lock;
  const preflight = deps.preflight ?? DEFAULT_STEPS.preflight;
  const record = deps.record ?? DEFAULT_STEPS.record;
  const print = deps.print ?? ((line: string) => process.stdout.write(`${line}\n`));
  const result: ImageCheckResult = {
    target,
    tag: "",
    runId: deps.runId,
    state: "passed",
    cause: "none",
    evidence: "",
    imageId: null,
    user: null,
    env: [],
    labels: {},
    baseImageBefore: null,
    baseImageAfter: null,
    runDir: deps.runDir,
  };
  const teardown: TeardownLine = {
    created: false,
    removed: [],
    gone: [],
    skipped: [],
    notOurs: [],
    leftAlone: [],
    failed: [],
    remaining: [],
    runId: deps.runId,
  };
  const setState = (c: { state: CheckState; cause: string }, evidence: string) => {
    result.state = c.state;
    result.cause = c.cause;
    result.evidence = evidence;
  };

  // c-WR-06: an interrupt aborts the build, then the run takes the normal teardown below, which
  // touches only what this run recorded (its tag, by repo:tag after the ID re-check, and the lock).
  const abort = new AbortController();
  let interrupted: string | null = null;
  const unsubscribe = (deps.interrupts ?? (() => () => {}))((signal) => {
    if (interrupted !== null) return;
    interrupted = signal;
    abort.abort();
  });
  const stopIfInterrupted = (stage: string) => {
    if (interrupted !== null)
      throw new Stop("not run", "interrupted", `Interrupted by ${interrupted} ${stage}`);
  };

  let release: (() => void) | null = null;
  let buildStarted = false;
  const created: ExactRefs = {};
  const recorded: Record<string, string> = {};
  const preflightInfo: Record<string, unknown> = {
    tag: "",
    tagState: "not reached",
    preflight: "not reached",
    message: "",
    baseImageBefore: null,
  };

  try {
    // (a) and (b): the tag, then J1's lock. Without the lock no Docker query runs at all.
    result.tag = imageCheckTag(target, deps.runId);
    preflightInfo.tag = result.tag;
    try {
      release = lock(deps.runId);
    } catch (err) {
      const c = classifyPreflightFailure(messageOf(err));
      throw new Stop(c.state, c.cause, messageOf(err));
    }
    stopIfInterrupted("before the tag check; nothing was built");

    // (c) The tag must be free; a taken tag is never overwritten.
    let state: "free" | "taken";
    try {
      state = tagState(deps.docker, result.tag);
    } catch (err) {
      const c = classifyPreflightFailure(messageOf(err));
      throw new Stop(c.state, c.cause, messageOf(err));
    }
    preflightInfo.tagState = state;
    if (state === "taken") {
      throw new Stop(
        "not run",
        "foreign",
        `Image tag ${result.tag} already exists; it is never overwritten (rule J)`,
      );
    }

    // (d) Evidence for K116 only: did the build pull or update the base image?
    result.baseImageBefore = baseImageId(deps.docker);
    preflightInfo.baseImageBefore = result.baseImageBefore;

    // (e) J1's preflight: project and names absent, tag free, 20 GiB on the host and in the VM.
    try {
      preflight(deps.docker, {
        runId: deps.runId,
        project: testResourceName("image-check", deps.runId),
        tags: [result.tag],
        hostDirs: deps.hostDirs,
      });
      preflightInfo.preflight = "passed";
    } catch (err) {
      preflightInfo.preflight = "stopped";
      preflightInfo.message = messageOf(err);
      const c = classifyPreflightFailure(messageOf(err));
      throw new Stop(c.state, c.cause, messageOf(err));
    }
    stopIfInterrupted("before the build started; nothing was built");

    // (f) The build.
    record(deps.runId, { type: "image", name: result.tag, state: "planned" });
    created.image = [result.tag];
    buildStarted = true;
    const logFile = path.join(deps.runDir, "build.log");
    const outcome = await deps.build(
      imageBuildArgs(target, result.tag, deps.runId),
      logFile,
      BUILD_QUIET_MS,
      abort.signal,
    );

    // (g) Whatever the exit: which image does the tag point to now?
    const after = imageId(deps.docker, result.tag);
    if (after.error !== undefined) {
      throw new Stop(
        "blocked",
        "docker",
        `Cannot read the image ID of ${result.tag}: ${after.error}`,
      );
    }
    if (after.id !== null) {
      result.imageId = after.id;
      recorded[result.tag] = after.id;
      record(deps.runId, { type: "image", name: result.tag, id: after.id, state: "created" });
    }
    stopIfInterrupted(
      `during the build (exit ${outcome.code}); the docker build client was stopped`,
    );

    // (h) A failed or stalled build. A build that exits 0 without its tag is failed (c-IN-04).
    if (outcome.code === 0 && !outcome.watchdogFired && after.id === null) {
      throw new Stop("failed", "build", `build exited 0 but ${result.tag} is absent`);
    }
    if (outcome.code !== 0 || outcome.watchdogFired) {
      const logTail = tail(logFile, 80);
      const c = classifyBuildFailure(readLog(logFile), outcome.watchdogFired);
      const why = outcome.watchdogFired
        ? `watchdog: no build output for ${BUILD_QUIET_MS} ms; exit ${outcome.code}\n`
        : `build exit ${outcome.code}\n`;
      throw new Stop(c.state, c.cause, `${why}${logTail}`);
    }

    // (i) The image itself, read with image inspect only.
    const inspected = deps.docker(["image", "inspect", "--format", "{{json .Config}}", result.tag]);
    if (inspected.code !== 0) {
      throw new Stop(
        "blocked",
        "docker",
        `Cannot inspect ${result.tag}: ${inspected.stderr.trim()}`,
      );
    }
    const config = JSON.parse(inspected.stdout) as ImageConfig;
    result.user = typeof config.User === "string" ? config.User : null;
    result.env = TELEMETRY_VARS.flatMap((name) => envEntries(config, name));
    const labels = labelsOf(config);
    for (const key of [TEST_LABEL, RUN_LABEL]) if (key in labels) result.labels[key] = labels[key];
    result.baseImageAfter = baseImageId(deps.docker);
    const findings = inspectFindings(config, deps.runId);
    const base = baseImageProblem(result.baseImageBefore, result.baseImageAfter);
    if (base !== null)
      setState({ state: "failed", cause: "base-image" }, [base, ...findings].join("\n"));
    else if (findings.length > 0)
      setState({ state: "failed", cause: "config" }, findings.join("\n"));
    else setState({ state: "passed", cause: "none" }, "");
  } catch (err) {
    if (err instanceof Stop) setState(err, err.evidence);
    else setState({ state: "failed", cause: "harness" }, messageOf(err));
  } finally {
    // (j) Teardown: only with the lock, only after the build started, only the recorded tag.
    const problems: string[] = [];
    if (release) {
      try {
        fs.writeFileSync(
          path.join(deps.runDir, "preflight.json"),
          `${JSON.stringify(preflightInfo, null, 2)}\n`,
        );
      } catch (err) {
        problems.push(`preflight.json: ${messageOf(err)}`);
      }
      try {
        const refs = teardownRefs({ lockHeld: true, buildStarted, created }, () => []);
        if (refs !== null) {
          teardown.created = true;
          const current: Record<string, string | null> = {};
          for (const tag of refs.image ?? []) {
            const now = imageId(deps.docker, tag);
            if (now.error !== undefined)
              teardown.failed.push(`${tag}: cannot read image ID: ${now.error}`);
            else current[tag] = now.id;
          }
          const decision = removableTags(recorded, current);
          teardown.leftAlone.push(...decision.leftAlone);
          refs.image = decision.remove;
          const { plan, notOurs } = planExact(deps.cleanupDocker, deps.runId, refs);
          teardown.notOurs.push(...notOurs.map((r) => r.ref));
          const applied = applyCleanup(deps.cleanupDocker, deps.runId, plan);
          teardown.removed.push(...applied.removed.map((r) => r.ref));
          teardown.gone.push(...applied.gone.map((r) => r.ref));
          teardown.skipped.push(...applied.skipped.map((s) => `${s.resource.ref}: ${s.reason}`));
          teardown.failed.push(...applied.failed.map((f) => `${f.resource.ref}: ${f.error}`));
          for (const tag of teardown.removed) {
            try {
              if (tagState(deps.docker, tag) !== "free") teardown.remaining.push(tag);
            } catch (err) {
              teardown.remaining.push(`${tag}: ${messageOf(err)}`);
            }
          }
        }
      } catch (err) {
        problems.push(`teardown: ${messageOf(err)}`);
      }
      release();
    }
    unsubscribe();
    const names = [
      ...problems,
      ...teardown.failed,
      ...teardown.notOurs.map((r) => `not ours: ${r}`),
      ...teardown.leftAlone.map((r) => `left alone: ${r}`),
      ...teardown.remaining.map((r) => `remaining: ${r}`),
    ];
    if (names.length > 0) {
      const earlier = result.evidence ? `\n(before teardown: ${result.state}/${result.cause})` : "";
      setState({ state: "failed", cause: "teardown" }, `${names.join("\n")}${earlier}`);
    }
    print(`${TEARDOWN_PREFIX}${JSON.stringify(teardown)}`);
  }

  // (k) The result line.
  result.evidence = result.evidence.slice(0, EVIDENCE_MAX);
  print(`${RESULT_PREFIX}${JSON.stringify(result)}`);
  return result;
}

const DOCKER_CLIENT_VARS = [
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
  "DOCKER_CONFIG",
  "DOCKER_CERT_PATH",
  "DOCKER_TLS_VERIFY",
];

/** The part of a spawned child the build runner uses (a real ChildProcess, or a test fake). */
export interface BuildChild {
  stdout: NodeJS.EventEmitter | null;
  stderr: NodeJS.EventEmitter | null;
  on(event: "error", listener: (err: Error) => void): unknown;
  on(event: "close", listener: (code: number | null, signal: string | null) => void): unknown;
  kill(signal: NodeJS.Signals): boolean;
}
export type SpawnBuild = (
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; stdio: ["ignore", "pipe", "pipe"] },
) => BuildChild;

/** Starts the docker client; ends it after `quietMs` without new output. */
export function buildWithWatchdog(repoRoot: string, spawnBuild: SpawnBuild = spawn) {
  return (
    args: string[],
    logFile: string,
    quietMs: number,
    signal?: AbortSignal,
  ): Promise<BuildOutcome> =>
    new Promise((resolve) => {
      const env: Record<string, string> = {};
      for (const key of ["PATH", "HOME", ...DOCKER_CLIENT_VARS]) {
        const value = process.env[key];
        if (value !== undefined && value !== "") env[key] = value;
      }
      const out = fs.openSync(logFile, "a");
      const child = spawnBuild("docker", args, {
        cwd: repoRoot,
        // Only PATH, HOME and the Docker client variables; the project types NODE_ENV as required.
        env: env as NodeJS.ProcessEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let last = Date.now();
      let watchdogFired = false;
      // A failed spawn emits `error` and then `close` (c-IN-03): settle once, write after neither.
      let done = false;
      const onData = (chunk: Buffer) => {
        if (done) return;
        last = Date.now();
        fs.writeSync(out, chunk);
      };
      child.stdout?.on("data", onData);
      child.stderr?.on("data", onData);
      // SIGTERM once; SIGKILL after the grace if the client has not closed (c-WR-06). The child is
      // killed explicitly, so a SIGTERM that reaches only this Node process still stops the build.
      let killTimer: NodeJS.Timeout | null = null;
      const stopChild = () => {
        if (done || killTimer !== null) return;
        child.kill("SIGTERM");
        killTimer = setTimeout(() => {
          if (!done) child.kill("SIGKILL");
        }, KILL_GRACE_MS);
      };
      const timer = setInterval(() => {
        if (Date.now() - last > quietMs && !watchdogFired) {
          watchdogFired = true;
          stopChild();
        }
      }, 5_000);
      const onAbort = () => stopChild();
      const finish = (code: number) => {
        if (done) return;
        done = true;
        clearInterval(timer);
        if (killTimer !== null) clearTimeout(killTimer);
        signal?.removeEventListener("abort", onAbort);
        fs.closeSync(out);
        resolve({ code, watchdogFired });
      };
      child.on("error", (err) => {
        if (!done) fs.writeSync(out, `spawn error: ${err.message}\n`);
        finish(127);
      });
      child.on("close", (code, killedBy) => finish(code ?? (killedBy ? 143 : 1)));
      if (signal?.aborted) stopChild();
      else signal?.addEventListener("abort", onAbort, { once: true });
    });
}

/**
 * SIGINT and SIGTERM for the CLI. The listeners stay until the run unsubscribes, so a second
 * signal cannot end the process half-way through teardown; SIGKILL remains the hard stop.
 */
export function processInterrupts(onSignal: (signal: string) => void): () => void {
  const listeners = (["SIGINT", "SIGTERM"] as const).map((name) => {
    const listener = () => onSignal(name);
    process.on(name, listener);
    return [name, listener] as const;
  });
  return () => {
    for (const [name, listener] of listeners) process.off(name, listener);
  };
}

async function main(argv: string[]): Promise<number> {
  if (argv[0] === "--verify" && argv.length === 4) {
    const v = verifyImageCheckLog(fs.readFileSync(argv[1], "utf8"), Number(argv[2]), argv[3]);
    console.log(v.line);
    return v.ok ? 0 : 1;
  }
  if (
    argv[0] === "--target" &&
    argv.length === 2 &&
    (IMAGE_CHECK_TARGETS as readonly string[]).includes(argv[1])
  ) {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const cleanupDocker: DockerRunner = (args) => {
      const r = runDocker(args);
      if (r.code !== 0)
        throw new Error(`docker ${args.join(" ")} failed (exit ${r.code}): ${r.stderr}`);
      return r.stdout;
    };
    const result = await runImageCheck(argv[1], {
      runId: testRunId(),
      repoRoot,
      hostDirs: [os.homedir(), repoRoot],
      runDir: fs.mkdtempSync(path.join(os.tmpdir(), "aida-image-check-")),
      docker: runDocker,
      cleanupDocker,
      build: buildWithWatchdog(repoRoot),
      interrupts: processInterrupts,
    });
    return EXIT_CODES[result.state];
  }
  console.error(
    "Usage: test-image-check --target runner|builder | --verify <log> <exit> <runner|builder>",
  );
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(err);
      process.exitCode = 1;
    },
  );
}
