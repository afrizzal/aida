// Red-window compile checker (Phase 12.1 only; review C4 and review R2-2).
//
// Plan 12.1-01 removes the TicketStatus enum, so the repository does not typecheck until plan
// 12.1-15 has migrated every reader. During that window each plan from 12.1-03 to 12.1-14 runs
// `tsc --noEmit --pretty false` into a log that ends with one `TSC_EXIT=<code>` line and checks
// the log with this script, so its compile check can never pass vacuously. Plan 12.1-15 deletes
// this file together with tests/support/red-window-baseline.json once the whole repository
// typechecks. Plain Node ESM with no dependency and no TypeScript, so it runs while tsc is red.
//
// Rules (evaluateRedWindow):
// - Freshness: the last non-empty line is TSC_EXIT=<integer>, it occurs exactly once, and the
//   log was modified at most 15 minutes ago; else the log is rejected as a whole.
// - Form: every other non-empty line is a diagnostic `<path>(<line>,<col>): error TS<n>: <text>`
//   (the path is everything before the first `(<digits>,<digits>): error TS`, so route groups and
//   dynamic segments stay whole) or a whitespace-led continuation of the diagnostic above it.
// - Exit agreement: TSC_EXIT 0 with a diagnostic, a non-zero TSC_EXIT without one, and a TSC_EXIT
//   outside 0, 1 and 2 are rejected.
// - Ownership: the window is 12.1-15 and every plan that does not depend on it. A diagnostic in a
//   file f is ignored only when f is not the checked plan's own file and either the plan lists f
//   only in a task after --through-task, or some other owner of f is unfinished (neither a
//   dependency of the checked plan nor completed, i.e. without SUMMARY) and the baseline rule
//   allows it. A path under .next/ is always rejected.
// - Baseline rule (review R2-2): the signature of a diagnostic is (file, TS code, first-line
//   message). When no owner of f is finished, f has no finished part and the diagnostic is
//   allowed. When a finished owner other than the baseline's recorder exists, f was left clean by
//   that owner and nothing in f is allowed. Otherwise the only finished owner is the recorder, and
//   a signature is allowed only when the baseline lists it and the log's count does not exceed it.
//
// CLI: node tests/support/red-window-tsc.mjs <plan-id> <log-path> [--through-task N]
//      [--baseline PATH]   (default baseline tests/support/red-window-baseline.json)
// Exit 0: no violation. Exit 1: at least one violation (each printed). Exit 2: the log does not
// exist, the baseline is missing or invalid, fewer than 15 plans parse, the plan id is unknown, or
// the arguments are malformed.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PHASE_DIR = ".planning/phases/12.1-ticket-lifecycle-custom-states-and-sla-pause";
export const DEFAULT_BASELINE = "tests/support/red-window-baseline.json";
export const WINDOW_END = "12.1-15";
export const MAX_LOG_AGE_MS = 15 * 60 * 1000;

export const REASONS = {
  freshness: "log missing, stale or not finished by this run",
  unparsed: "line is neither a path(line,col) diagnostic nor its continuation",
  orphanContinuation: "indented line before any diagnostic",
  exitZeroWithDiagnostics: "TSC_EXIT=0 but the log holds diagnostics",
  exitNonZeroWithout: "non-zero TSC_EXIT without any diagnostic",
  exitOutOfRange: "TSC_EXIT outside 0, 1 and 2",
  nextDir:
    "path under .next/: run `pnpm exec next typegen` and run the check again; never delete .next/; if it persists, stop and report",
  ownFile: "own file of the checked plan",
  unowned: "owned by no plan of the window",
  allFinished: "every owner already a dependency or completed",
  alreadyMigrated: "file already migrated by",
  newSignature: "new red-window diagnostic",
  increasedSignature: "increased red-window diagnostic",
};

/**
 * @typedef {{ id: string, dependsOn: string[], files: string[], taskFiles: string[][], completed?: boolean }} Plan
 */

export class BaselineError extends Error {
  constructor(message) {
    super(message);
    this.name = "BaselineError";
  }
}

const signatureKey = (file, code, message) => `${file}\u0000${code}\u0000${message}`;

/**
 * Reads the baseline plan 12.1-01 records: { recordedBy, entries: [{ file, code, message, count }] }.
 * Throws BaselineError when it is missing, not JSON or malformed.
 */
export function loadBaseline(baselinePath) {
  let text;
  try {
    text = fs.readFileSync(baselinePath, "utf-8");
  } catch {
    throw new BaselineError(`baseline not found: ${baselinePath}`);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BaselineError(`baseline is not JSON: ${baselinePath}`);
  }
  return validateBaseline(data);
}

/** Validates a parsed baseline object; returns { recordedBy, entries, counts }. */
export function validateBaseline(data) {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new BaselineError("baseline is not an object");
  }
  if (typeof data.recordedBy !== "string" || data.recordedBy.trim() === "") {
    throw new BaselineError("baseline has no recordedBy");
  }
  if (!Array.isArray(data.entries)) throw new BaselineError("baseline has no entries array");
  const counts = new Map();
  for (const [i, entry] of data.entries.entries()) {
    if (entry === null || typeof entry !== "object") {
      throw new BaselineError(`entry ${i} is not an object`);
    }
    if (typeof entry.file !== "string" || entry.file === "") {
      throw new BaselineError(`entry ${i} has no file`);
    }
    if (typeof entry.code !== "string" || !/^TS[0-9]+$/.test(entry.code)) {
      throw new BaselineError(`entry ${i} has an invalid code`);
    }
    if (typeof entry.message !== "string" || entry.message === "" || /[\r\n]/.test(entry.message)) {
      throw new BaselineError(`entry ${i} has an empty or multi-line message`);
    }
    if (!Number.isInteger(entry.count) || entry.count < 1) {
      throw new BaselineError(`entry ${i} has an invalid count`);
    }
    const key = signatureKey(entry.file, entry.code, entry.message);
    if (counts.has(key)) throw new BaselineError(`entry ${i} repeats a signature`);
    counts.set(key, entry.count);
  }
  return { recordedBy: data.recordedBy, entries: data.entries, counts };
}

function frontmatterOf(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return match ? match[1].split(/\r?\n/) : [];
}

const unquote = (value) => value.trim().replace(/^["']|["']$/g, "");

function frontmatterList(lines, key) {
  const index = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (index < 0) return [];
  const inline = lines[index].slice(key.length + 1).trim();
  if (inline.startsWith("[")) {
    const body = inline.replace(/^\[|\]$/g, "").trim();
    return body === "" ? [] : body.split(",").map(unquote).filter(Boolean);
  }
  const items = [];
  for (const line of lines.slice(index + 1)) {
    const item = line.match(/^\s+-\s+(.*)$/);
    if (!item) break;
    items.push(unquote(item[1]));
  }
  return items;
}

/**
 * Parses one PLAN.md text into { id, dependsOn, files, taskFiles }.
 * @param {string} text
 * @returns {Plan}
 */
export function parsePlanFile(text) {
  const lines = frontmatterOf(text);
  const planLine = lines.find((line) => /^plan:/.test(line));
  if (!planLine) throw new Error("plan file has no plan number");
  const number = unquote(planLine.slice("plan:".length));
  const id = `12.1-${number.padStart(2, "0")}`;
  const taskFiles = [];
  const taskRe = /^<task\b[^>]*>([\s\S]*?)^<\/task>/gm;
  for (const task of text.matchAll(taskRe)) {
    const files = task[1].match(/<files>([\s\S]*?)<\/files>/);
    taskFiles.push(
      files
        ? files[1]
            .split(",")
            .map((f) => f.trim())
            .filter(Boolean)
        : [],
    );
  }
  return {
    id,
    dependsOn: frontmatterList(lines, "depends_on"),
    files: frontmatterList(lines, "files_modified"),
    taskFiles,
  };
}

/**
 * Parses every 12.1-NN-PLAN.md in the directory; a plan is completed when its SUMMARY exists.
 * @param {string} phaseDir
 * @returns {Plan[]}
 */
export function loadPhasePlans(phaseDir) {
  return fs
    .readdirSync(phaseDir)
    .filter((name) => /^12\.1-\d{2}-PLAN\.md$/.test(name))
    .sort()
    .map((name) => {
      const plan = parsePlanFile(fs.readFileSync(path.join(phaseDir, name), "utf-8"));
      const summary = name.replace(/-PLAN\.md$/, "-SUMMARY.md");
      return { ...plan, completed: fs.existsSync(path.join(phaseDir, summary)) };
    });
}

/**
 * The transitive closure of dependsOn (the plan itself excluded).
 * @param {Plan[]} plans
 * @param {string} planId
 * @returns {Set<string>}
 */
export function transitiveDeps(plans, planId) {
  const byId = new Map(plans.map((p) => [p.id, p]));
  const seen = new Set();
  const stack = [...(byId.get(planId)?.dependsOn ?? [])];
  while (stack.length > 0) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(byId.get(id)?.dependsOn ?? []));
  }
  seen.delete(planId);
  return seen;
}

/**
 * The plans of the red window: 12.1-15 and every plan that does not depend on it.
 * @param {Plan[]} plans
 * @returns {Plan[]}
 */
export function windowPlans(plans) {
  return plans.filter((p) => p.id === WINDOW_END || !transitiveDeps(plans, p.id).has(WINDOW_END));
}

const DIAGNOSTIC_RE = /\((\d+),(\d+)\): error (TS\d+): /;

function parseLog(logText) {
  const lines = logText.split(/\r?\n/).filter((line) => line.trim() !== "");
  const exitLines = lines.filter((line) => /^TSC_EXIT=/.test(line));
  const last = lines.at(-1) ?? "";
  const exitMatch = last.match(/^TSC_EXIT=(-?\d+)$/);
  if (exitLines.length !== 1 || !exitMatch) return { finished: false };
  const diagnostics = [];
  const formViolations = [];
  for (const line of lines.slice(0, -1)) {
    if (/^\s/.test(line)) {
      if (diagnostics.length === 0) {
        formViolations.push({ reason: REASONS.orphanContinuation, line });
      }
      continue;
    }
    const match = line.match(DIAGNOSTIC_RE);
    const file = match ? line.slice(0, match.index).replace(/\\/g, "/") : "";
    if (!match || file === "") {
      formViolations.push({ reason: REASONS.unparsed, line });
      continue;
    }
    const message = line.slice(match.index + match[0].length).trimEnd();
    diagnostics.push({ file, code: match[3], message, line });
  }
  return { finished: true, tscExit: Number(exitMatch[1]), diagnostics, formViolations };
}

/**
 * Evaluates a tsc log for plan `planId` (optionally only through task `throughTask`).
 * Returns { ok, tscExit, diagnostics, ignoredByOwner, violations }.
 */
export function evaluateRedWindow({
  planId,
  throughTask,
  logText,
  logMtimeMs,
  nowMs,
  plans,
  baseline,
}) {
  const plan = plans.find((p) => p.id === planId);
  if (!plan) throw new Error(`unknown plan id: ${planId}`);
  const parsed = parseLog(logText);
  const fresh = typeof logMtimeMs === "number" && nowMs - logMtimeMs <= MAX_LOG_AGE_MS;
  if (!parsed.finished || !fresh) {
    return {
      ok: false,
      tscExit: null,
      diagnostics: 0,
      ignoredByOwner: {},
      violations: [{ reason: REASONS.freshness, line: "" }],
    };
  }

  const { tscExit, diagnostics } = parsed;
  const violations = [...parsed.formViolations];
  if (![0, 1, 2].includes(tscExit)) violations.push({ reason: REASONS.exitOutOfRange, line: "" });
  else if (tscExit === 0 && diagnostics.length > 0) {
    violations.push({ reason: REASONS.exitZeroWithDiagnostics, line: "" });
  } else if (tscExit !== 0 && diagnostics.length === 0) {
    violations.push({ reason: REASONS.exitNonZeroWithout, line: "" });
  }

  const window = windowPlans(plans);
  const deps = transitiveDeps(plans, planId);
  const through = throughTask ?? plan.taskFiles.length;
  const ownTasks = new Set(plan.taskFiles.slice(0, through).flat());
  const laterTasks = new Set(plan.taskFiles.slice(through).flat());
  const anyTask = new Set(plan.taskFiles.flat());
  const isOwn = (f) => ownTasks.has(f) || (plan.files.includes(f) && !anyTask.has(f));
  const ownersOf = (f) =>
    window
      .filter((p) => p.files.includes(f) || p.taskFiles.some((task) => task.includes(f)))
      .map((p) => p.id);
  const finished = (id) => deps.has(id) || plans.find((p) => p.id === id)?.completed === true;

  const logCounts = new Map();
  for (const d of diagnostics) {
    const key = signatureKey(d.file, d.code, d.message);
    logCounts.set(key, (logCounts.get(key) ?? 0) + 1);
  }

  const ignoredByOwner = {};
  const ignore = (owner) => {
    ignoredByOwner[owner] = (ignoredByOwner[owner] ?? 0) + 1;
  };

  for (const d of diagnostics) {
    const f = d.file;
    if (f === ".next" || f.startsWith(".next/") || f.startsWith("./.next/")) {
      violations.push({ reason: REASONS.nextDir, line: d.line });
      continue;
    }
    if (isOwn(f)) {
      violations.push({ reason: `${REASONS.ownFile} (${planId})`, line: d.line });
      continue;
    }
    if (laterTasks.has(f)) {
      ignore(`${planId} (later task)`);
      continue;
    }
    const others = ownersOf(f).filter((id) => id !== planId);
    if (others.length === 0) {
      violations.push({ reason: REASONS.unowned, line: d.line });
      continue;
    }
    const unfinished = others.filter((id) => !finished(id)).sort();
    if (unfinished.length === 0) {
      violations.push({ reason: REASONS.allFinished, line: d.line });
      continue;
    }
    const finishedOwners = others.filter(finished);
    if (finishedOwners.length === 0) {
      ignore(unfinished[0]);
      continue;
    }
    const migratedBy = finishedOwners.find((id) => id !== baseline.recordedBy);
    if (migratedBy) {
      violations.push({ reason: `${REASONS.alreadyMigrated} ${migratedBy}`, line: d.line });
      continue;
    }
    const key = signatureKey(d.file, d.code, d.message);
    const allowed = baseline.counts.get(key);
    if (allowed === undefined) {
      violations.push({ reason: REASONS.newSignature, line: d.line });
      continue;
    }
    const seen = logCounts.get(key) ?? 0;
    if (seen > allowed) {
      violations.push({
        reason: `${REASONS.increasedSignature} (log count ${seen}, baseline count ${allowed})`,
        line: d.line,
      });
      continue;
    }
    ignore(unfinished[0]);
  }

  return {
    ok: violations.length === 0,
    tscExit,
    diagnostics: diagnostics.length,
    ignoredByOwner,
    violations,
  };
}

function runCli(argv) {
  const args = [...argv];
  let throughTask;
  let baselinePath = DEFAULT_BASELINE;
  const positional = [];
  while (args.length > 0) {
    const arg = args.shift();
    if (arg === "--through-task") {
      const value = Number(args.shift());
      if (!Number.isInteger(value) || value < 1) {
        console.error("--through-task needs a positive integer");
        return 2;
      }
      throughTask = value;
    } else if (arg === "--baseline") {
      baselinePath = args.shift();
      if (!baselinePath) {
        console.error("--baseline needs a path");
        return 2;
      }
    } else {
      positional.push(arg);
    }
  }
  const [planId, logPath] = positional;
  if (!planId || !logPath || positional.length !== 2) {
    console.error(
      "usage: node tests/support/red-window-tsc.mjs <plan-id> <log-path> [--through-task N] [--baseline PATH]",
    );
    return 2;
  }
  if (!fs.existsSync(logPath)) {
    console.error(`${REASONS.freshness}: ${logPath} does not exist`);
    return 2;
  }
  let baseline;
  try {
    baseline = loadBaseline(baselinePath);
  } catch (error) {
    console.error(`baseline refused: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  const plans = loadPhasePlans(path.resolve(process.cwd(), PHASE_DIR));
  if (plans.length < 15) {
    console.error(`only ${plans.length} plans parsed from ${PHASE_DIR}`);
    return 2;
  }
  if (!plans.some((p) => p.id === planId)) {
    console.error(`unknown plan id: ${planId}`);
    return 2;
  }
  const result = evaluateRedWindow({
    planId,
    throughTask,
    logText: fs.readFileSync(logPath, "utf-8"),
    logMtimeMs: fs.statSync(logPath).mtimeMs,
    nowMs: Date.now(),
    plans,
    baseline,
  });
  console.log(`tsc exit: ${result.tscExit}`);
  console.log(`diagnostics: ${result.diagnostics}`);
  const ignored = Object.entries(result.ignoredByOwner)
    .map(([owner, n]) => `${owner}=${n}`)
    .join(", ");
  console.log(`ignored by owner: ${ignored === "" ? "none" : ignored}`);
  for (const v of result.violations) {
    console.log(`VIOLATION ${v.reason}${v.line ? `: ${v.line}` : ""}`);
  }
  console.log(result.ok ? "red-window check: PASS" : "red-window check: FAIL");
  return result.ok ? 0 : 1;
}

const isMain =
  typeof process.argv[1] === "string" &&
  fs.existsSync(process.argv[1]) &&
  fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));

if (isMain) process.exit(runCli(process.argv.slice(2)));
