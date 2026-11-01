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
// 1 failed, 3 blocked, 4 not run, 2 usage.
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
  applyCleanup,
  type DockerRunner,
  type ExactRefs,
  planExact,
  teardownRefs,
} from "./test-docker-cleanup";

export const IMAGE_CHECK_TARGETS = ["runner", "builder"] as const;
export type ImageCheckTarget = (typeof IMAGE_CHECK_TARGETS)[number];

export const RESULT_PREFIX = "IMAGE-CHECK-RESULT ";
export const TEARDOWN_PREFIX = "IMAGE-CHECK-TEARDOWN ";
export const VERIFY_PREFIX = "IMAGE-CHECK-VERIFY ";

export type CheckState = "passed" | "failed" | "blocked" | "not run";
export const EXIT_CODES: Record<CheckState, number> = {
  passed: 0,
  failed: 1,
  blocked: 3,
  "not run": 4,
};

/** Ten minutes without new build output ends the build (the binaries.prisma.sh stall, 2026-11-08). */
export const BUILD_QUIET_MS = 600_000;

/** The text J1's assertEnoughSpace throws inside runBuildPreflight. */
export const J1_SPACE_STOP =
  /Free space on (the host|the Docker VM) is \d+\.\d GiB, below the 20\.0 GiB rule J requires before an image build\. Stopped; report to the owner\./;

const BASE_IMAGE = "node:22-alpine";
const TELEMETRY_VARS = ["NEXT_TELEMETRY_DISABLED", "CHECKPOINT_DISABLE"] as const;
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

export function summaryWord(state: CheckState, cause: string): string {
  if (state === "passed") return "passed";
  if (state === "blocked") return cause === "space" ? "blocked (space)" : "blocked (with evidence)";
  if (state === "not run") return `not run (parked: ${cause})`;
  return "failed";
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
  build(args: string[], logFile: string, quietMs: number): Promise<BuildOutcome>;
  preflight?: (docker: Docker, options: PreflightOptions) => void;
  lock?: (runId: string) => () => void;
  record?: (runId: string, entry: LedgerEntry) => void;
  print?: (line: string) => void;
}

export interface ImageCheckResult {
  target: string;
  tag: string;
  runId: string;
  state: CheckState;
  cause: string;
  evidence: string;
  imageId: string | null;
  user: string | null;
  env: string[];
  labels: Record<string, string>;
  baseImageBefore: string | null;
  baseImageAfter: string | null;
  runDir: string;
}

export interface TeardownLine {
  created: boolean;
  removed: string[];
  gone: string[];
  skipped: string[];
  notOurs: string[];
  leftAlone: string[];
  failed: string[];
  remaining: string[];
  runId: string;
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

/**
 * c-WR-04: the base image is shared daemon state this run did not create (K109). When the build
 * pulled it or moved its tag, the run cannot pass; the base image itself is never touched.
 */
export function baseImageProblem(before: string | null, after: string | null): string | null {
  if (before !== null && after !== null && before === after && before.startsWith("sha256:"))
    return null;
  return `Base image ${BASE_IMAGE} was ${before ?? "not recorded"} before the build and ${after ?? "not recorded"} after it (a pull or a moved tag); it was not touched (K109)`;
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

    // (f) The build.
    record(deps.runId, { type: "image", name: result.tag, state: "planned" });
    created.image = [result.tag];
    buildStarted = true;
    const logFile = path.join(deps.runDir, "build.log");
    const outcome = await deps.build(
      imageBuildArgs(target, result.tag, deps.runId),
      logFile,
      BUILD_QUIET_MS,
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

function linesWith(log: string, prefix: string): string[] {
  return log.split("\n").filter((line) => line.startsWith(prefix));
}

/** Re-reads a check's log; refuses failed, inconsistent or unevidenced results. */
export function verifyImageCheckLog(
  log: string,
  exitCode: number,
  target: string,
): { ok: boolean; line: string } {
  const refuse = (reason: string) => ({ ok: false, line: `${VERIFY_PREFIX}FAILED: ${reason}` });
  const results = linesWith(log, RESULT_PREFIX);
  const teardowns = linesWith(log, TEARDOWN_PREFIX);
  if (results.length !== 1) return refuse(`expected one result line, found ${results.length}`);
  if (teardowns.length !== 1)
    return refuse(`expected one teardown line, found ${teardowns.length}`);
  let r: ImageCheckResult;
  let t: TeardownLine;
  try {
    r = JSON.parse(results[0].slice(RESULT_PREFIX.length)) as ImageCheckResult;
    t = JSON.parse(teardowns[0].slice(TEARDOWN_PREFIX.length)) as TeardownLine;
  } catch (err) {
    return refuse(`unreadable line: ${messageOf(err)}`);
  }
  if (r.target !== target) return refuse(`target ${r.target}, expected ${target}`);
  if (!(r.state in EXIT_CODES)) return refuse(`unknown state ${JSON.stringify(r.state)}`);
  if (exitCode !== EXIT_CODES[r.state]) {
    return refuse(`exit ${exitCode} disagrees with state ${r.state} (${EXIT_CODES[r.state]})`);
  }
  if (r.state === "failed") return refuse(`the check failed (${r.cause}): ${r.evidence}`);
  if ((r.state === "blocked" || r.state === "not run") && !r.evidence?.trim()) {
    return refuse(`${r.state} without evidence`);
  }
  if (r.state === "blocked" && !["space", "measure", "docker", "external"].includes(r.cause)) {
    return refuse(`blocked cause ${r.cause} is not space, measure, docker or external`);
  }
  if (r.state === "not run" && !["lock", "foreign"].includes(r.cause)) {
    return refuse(`not-run cause ${r.cause} is not lock or foreign`);
  }
  if (
    r.cause === "space" &&
    !J1_SPACE_STOP.test(r.evidence) &&
    !r.evidence.includes("no space left on device")
  ) {
    return refuse("a space cause without J1's space text or no space left on device");
  }
  for (const key of ["failed", "notOurs", "leftAlone", "remaining"] as const) {
    if ((t[key] ?? []).length > 0) return refuse(`teardown ${key}: ${t[key].join(", ")}`);
  }
  if (!t.created && (t.removed ?? []).length > 0)
    return refuse("teardown removed something it did not create");
  if (r.state === "passed") {
    if (!r.imageId) return refuse("passed without an image ID");
    if (r.user !== "node") return refuse(`passed with user ${JSON.stringify(r.user)}`);
    for (const name of TELEMETRY_VARS) {
      if (!r.env?.includes(`${name}=1`)) return refuse(`passed without ${name}=1`);
    }
    if (r.labels?.[TEST_LABEL] !== "1" || r.labels?.[RUN_LABEL] !== r.runId) {
      return refuse("passed without the run labels");
    }
    if (!(t.removed ?? []).includes(r.tag)) return refuse(`passed but ${r.tag} was not removed`);
    const base = baseImageProblem(r.baseImageBefore, r.baseImageAfter);
    if (base !== null) return refuse(`passed but ${base}`);
  }
  return {
    ok: true,
    line: `${VERIFY_PREFIX}state=${r.state} cause=${r.cause} word="${summaryWord(r.state, r.cause)}" target=${target} tag=${r.tag}`,
  };
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
  return (args: string[], logFile: string, quietMs: number): Promise<BuildOutcome> =>
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
      const timer = setInterval(() => {
        if (Date.now() - last > quietMs && !watchdogFired) {
          watchdogFired = true;
          child.kill("SIGTERM");
        }
      }, 5_000);
      const finish = (code: number) => {
        if (done) return;
        done = true;
        clearInterval(timer);
        fs.closeSync(out);
        resolve({ code, watchdogFired });
      };
      child.on("error", (err) => {
        if (!done) fs.writeSync(out, `spawn error: ${err.message}\n`);
        finish(127);
      });
      child.on("close", (code, signal) => finish(code ?? (signal ? 143 : 1)));
    });
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
