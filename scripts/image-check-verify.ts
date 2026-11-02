// ---------------------------------------------------------------------------
// scripts/image-check-verify.ts: the pure --verify validation of the 08-09 image check (K133).
//
// test-image-check.ts prints one IMAGE-CHECK-TEARDOWN and one IMAGE-CHECK-RESULT line; this module
// re-reads them with the exit code and refuses failed, inconsistent or unevidenced results. Both
// scripts/test-image-check.ts (`--verify`) and scripts/part-a-gate-check.ts (the image rows, at
// derive and at check time) import it, so the gate runs the same validation over the actual image
// log and exit file instead of trusting a verify log's word. It reads strings only: no Docker, no
// child process, no file system.
// ---------------------------------------------------------------------------
import { RUN_LABEL, TEST_LABEL } from "../tests/support/docker-test-labels";

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

/** The text J1's assertEnoughSpace throws inside runBuildPreflight. */
export const J1_SPACE_STOP =
  /Free space on (the host|the Docker VM) is \d+\.\d GiB, below the 20\.0 GiB rule J requires before an image build\. Stopped; report to the owner\./;

/** The base image the Dockerfile builds from; shared daemon state the check never touches. */
export const BASE_IMAGE = "node:22-alpine";
export const TELEMETRY_VARS = ["NEXT_TELEMETRY_DISABLED", "CHECKPOINT_DISABLE"] as const;

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

export function summaryWord(state: CheckState, cause: string): string {
  if (state === "passed") return "passed";
  if (state === "blocked") return cause === "space" ? "blocked (space)" : "blocked (with evidence)";
  if (state === "not run") return `not run (parked: ${cause})`;
  return "failed";
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

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

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
    line: `${VERIFY_PREFIX}state=${r.state} cause=${r.cause} word="${summaryWord(r.state, r.cause)}" target=${target} tag=${r.tag} exit=${exitCode}`,
  };
}
