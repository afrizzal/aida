// Names and labels for every Docker resource a test creates (run charter rule J, run decisions
// K108 and K110 in .planning/run-loop/J1-RENCANA.md).
//
// Each resource carries `aida.test=1`, `aida.test.run=<run id>` and a name that starts with
// `aida-test-`. scripts/test-docker-cleanup.ts removes a resource only when all three match one
// run. This module has no Docker or Testcontainers import, so the cleanup script and unit tests
// can use it without side effects.
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const TEST_LABEL = "aida.test";
export const RUN_LABEL = "aida.test.run";
export const TEST_NAME_PREFIX = "aida-test-";
export const RUN_ID_ENV = "AIDA_TEST_RUN_ID";

const RUN_ID_PATTERN = /^[0-9a-z]{6,12}-[0-9a-f]{16}$/;
const KIND_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type ResourceType = "container" | "network" | "volume" | "image";

/** `<time in base 36>-<16 hex chars from 8 random bytes>`. */
export function newRunId(now: number = Date.now(), random: Buffer = randomBytes(8)): string {
  if (random.length !== 8) throw new Error("A run id needs exactly 8 random bytes");
  return `${now.toString(36)}-${random.toString("hex")}`;
}

export function isRunId(value: string): boolean {
  return RUN_ID_PATTERN.test(value);
}

function assertRunId(runId: string): void {
  if (!isRunId(runId)) throw new Error(`Not a valid test run id: ${JSON.stringify(runId)}`);
}

/**
 * The run id of this process tree. A caller (the orchestrator, or a parent test process) that
 * sets AIDA_TEST_RUN_ID decides it; otherwise the first call creates one and stores it in the
 * environment so child processes inherit it.
 */
export function testRunId(env: Record<string, string | undefined> = process.env): string {
  const inherited = env[RUN_ID_ENV];
  if (inherited !== undefined && inherited !== "") {
    assertRunId(inherited);
    return inherited;
  }
  const created = newRunId();
  env[RUN_ID_ENV] = created;
  return created;
}

export function testLabels(runId: string): Record<string, string> {
  assertRunId(runId);
  return { [TEST_LABEL]: "1", [RUN_LABEL]: runId };
}

/** `aida-test-<kind>-<run id>-<6 hex>`: unique per call, so parallel test files never collide. */
export function testResourceName(
  kind: string,
  runId: string,
  random: Buffer = randomBytes(3),
): string {
  if (!KIND_PATTERN.test(kind))
    throw new Error(`Not a valid resource kind: ${JSON.stringify(kind)}`);
  assertRunId(runId);
  return `${TEST_NAME_PREFIX}${kind}-${runId}-${random.toString("hex")}`;
}

export function ledgerPath(runId: string, tmpDir: string = os.tmpdir()): string {
  assertRunId(runId);
  return path.join(tmpDir, "aida-test-runs", `${runId}.jsonl`);
}

export interface LedgerEntry {
  type: ResourceType;
  name: string;
  id?: string;
  state: "planned" | "created";
}

/**
 * Appends one line to the run's ledger, so the resources of a run that crashed can still be
 * named. The ledger is evidence only; cleanup always re-reads labels from Docker.
 */
export function recordResource(
  runId: string,
  entry: LedgerEntry,
  tmpDir: string = os.tmpdir(),
): void {
  const file = ledgerPath(runId, tmpDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const line = JSON.stringify({ ...entry, at: new Date().toISOString(), pid: process.pid });
  fs.appendFileSync(file, `${line}\n`);
}
