/// <reference types="node" />
// Proofs for the Phase 12.1 red-window compile checker (review C4, review R2-2). Deleted by plan
// 12.1-15 together with tests/support/red-window-tsc.mjs.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  BaselineError,
  evaluateRedWindow,
  loadBaseline,
  loadPhasePlans,
  parsePlanFile,
  transitiveDeps,
  validateBaseline,
  windowPlans,
} from "../support/red-window-tsc.mjs";

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const SCRIPT = path.join(PROJECT_ROOT, "tests/support/red-window-tsc.mjs");
const PHASE_DIR = path.join(
  PROJECT_ROOT,
  ".planning/phases/12.1-ticket-lifecycle-custom-states-and-sla-pause",
);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "red-window-tsc-"));

afterAll(() => {
  for (const name of fs.readdirSync(TMP)) fs.unlinkSync(path.join(TMP, name));
  fs.rmdirSync(TMP);
});

const NOW = 1_800_000_000_000;
const M1 = "Property 'status' does not exist on type 'Row'.";

// Synthetic graph: A; B depends on A; C depends on B; D independent; E independent and completed.
// f.ts is owned by A and D, g.ts by B and D, d.ts and the route-group page by D alone.
const ROUTE_PAGE = "src/app/(app)/tickets/[id]/page.tsx";
const PLANS = [
  {
    id: "A",
    dependsOn: [],
    files: ["src/a.ts", "src/f.ts"],
    taskFiles: [["src/a.ts", "src/f.ts"]],
    completed: false,
  },
  {
    id: "B",
    dependsOn: ["A"],
    files: ["src/b.ts", "src/g.ts"],
    taskFiles: [["src/b.ts", "src/g.ts"]],
    completed: false,
  },
  {
    id: "C",
    dependsOn: ["B"],
    files: ["src/c1.ts", "src/c2.ts"],
    taskFiles: [["src/c1.ts"], ["src/c2.ts"]],
    completed: false,
  },
  {
    id: "D",
    dependsOn: [],
    files: ["src/d.ts", "src/f.ts", "src/g.ts", ROUTE_PAGE],
    taskFiles: [["src/d.ts", "src/f.ts", "src/g.ts", ROUTE_PAGE]],
    completed: false,
  },
  { id: "E", dependsOn: [], files: ["src/e.ts"], taskFiles: [["src/e.ts"]], completed: true },
];

const BASELINE = validateBaseline({
  recordedBy: "A",
  entries: [
    { file: "src/f.ts", code: "TS2339", message: M1, count: 2 },
    { file: "src/g.ts", code: "TS2339", message: M1, count: 1 },
  ],
});

function diag(file: string, opts: { code?: string; message?: string; at?: string } = {}): string {
  return `${file}(${opts.at ?? "3,7"}): error ${opts.code ?? "TS2339"}: ${opts.message ?? M1}`;
}

function log(lines: string[], exit: number | null = lines.length > 0 ? 2 : 0): string {
  return `${[...lines, ...(exit === null ? [] : [`TSC_EXIT=${exit}`])].join("\n")}\n`;
}

function check(logText: string, opts: { throughTask?: number; mtime?: number } = {}) {
  return evaluateRedWindow({
    planId: "C",
    throughTask: opts.throughTask,
    logText,
    logMtimeMs: opts.mtime ?? NOW,
    nowMs: NOW,
    plans: PLANS,
    baseline: BASELINE,
  });
}

const reasons = (r: { violations: { reason: string }[] }) => r.violations.map((v) => v.reason);

describe("red-window checker: freshness", () => {
  it("rejects a log without a TSC_EXIT line", () => {
    const r = check(log([diag("src/d.ts")], null));
    expect(r.ok).toBe(false);
    expect(reasons(r)).toEqual(["log missing, stale or not finished by this run"]);
  });

  it("rejects a log with two TSC_EXIT lines", () => {
    const r = check("TSC_EXIT=0\nTSC_EXIT=0\n");
    expect(reasons(r)).toEqual(["log missing, stale or not finished by this run"]);
  });

  it("rejects a TSC_EXIT line that is not the last non-empty line", () => {
    const r = check(`TSC_EXIT=2\n${diag("src/d.ts")}\n`);
    expect(reasons(r)).toEqual(["log missing, stale or not finished by this run"]);
  });

  it("rejects a log modified 16 minutes before now", () => {
    const r = check(log([]), { mtime: NOW - 16 * 60 * 1000 });
    expect(r.ok).toBe(false);
    expect(reasons(r)).toEqual(["log missing, stale or not finished by this run"]);
  });
});

describe("red-window checker: form and exit agreement", () => {
  it("rejects a pathless error line", () => {
    const r = check(log(["error TS5023: Unknown compiler option 'foo'."], 1));
    expect(r.ok).toBe(false);
    expect(r.violations[0].line).toBe("error TS5023: Unknown compiler option 'foo'.");
  });

  it("rejects an indented line before any diagnostic", () => {
    const r = check(log(["  Type 'x' is not assignable.", diag("src/d.ts")]));
    expect(reasons(r)).toEqual(["indented line before any diagnostic"]);
  });

  it("accepts indented continuation lines after a diagnostic", () => {
    const r = check(log([diag("src/d.ts"), "  Type 'x' is not assignable.", "    Details."]));
    expect(r.ok).toBe(true);
    expect(r.diagnostics).toBe(1);
  });

  it("rejects TSC_EXIT=2 with no diagnostic", () => {
    expect(check(log([], 2)).ok).toBe(false);
  });

  it("rejects TSC_EXIT=0 with a diagnostic", () => {
    expect(check(log([diag("src/d.ts")], 0)).ok).toBe(false);
  });

  it("rejects TSC_EXIT=127", () => {
    expect(reasons(check(log([], 127)))).toEqual(["TSC_EXIT outside 0, 1 and 2"]);
  });

  it("accepts TSC_EXIT=0 with no other line", () => {
    const r = check("TSC_EXIT=0\n");
    expect(r).toMatchObject({ ok: true, tscExit: 0, diagnostics: 0, violations: [] });
  });
});

describe("red-window checker: ownership on a synthetic graph (checking C)", () => {
  it("rejects a diagnostic in a file of C", () => {
    expect(reasons(check(log([diag("src/c1.ts")])))).toEqual(["own file of the checked plan (C)"]);
  });

  it("rejects a diagnostic in a file of A (a transitive dependency)", () => {
    expect(reasons(check(log([diag("src/a.ts")])))).toEqual([
      "every owner already a dependency or completed",
    ]);
  });

  it("ignores a diagnostic in a file of D and counts it under D", () => {
    const r = check(log([diag("src/d.ts", { code: "TS9999", message: "Not in any baseline." })]));
    expect(r.ok).toBe(true);
    expect(r.ignoredByOwner).toEqual({ D: 1 });
  });

  it("rejects a diagnostic in a file of E (completed)", () => {
    expect(reasons(check(log([diag("src/e.ts")])))).toEqual([
      "every owner already a dependency or completed",
    ]);
  });

  it("rejects a diagnostic in a file owned by no plan", () => {
    expect(reasons(check(log([diag("src/nobody.ts")])))).toEqual([
      "owned by no plan of the window",
    ]);
  });

  it("rejects a path under .next/ with the typegen instruction", () => {
    const r = check(log([diag(".next/types/app/page.ts")]));
    expect(r.ok).toBe(false);
    expect(r.violations[0].reason).toContain("pnpm exec next typegen");
    expect(r.violations[0].reason).toContain("never delete .next/");
  });

  it("ignores a file listed only in C's Task 2 with --through-task 1 and rejects it with --through-task 2", () => {
    const one = check(log([diag("src/c2.ts")]), { throughTask: 1 });
    expect(one.ok).toBe(true);
    expect(one.ignoredByOwner).toEqual({ "C (later task)": 1 });
    const two = check(log([diag("src/c2.ts")]), { throughTask: 2 });
    expect(reasons(two)).toEqual(["own file of the checked plan (C)"]);
  });

  it("parses a path with parentheses and brackets whole", () => {
    const r = check(log([diag(ROUTE_PAGE, { at: "12,5" })]));
    expect(r.ok).toBe(true);
    expect(r.ignoredByOwner).toEqual({ D: 1 });
  });
});

describe("red-window checker: baseline rule (review R2-2)", () => {
  it("ignores two baseline S1 diagnostics in f (owned by A and D) and counts them under D", () => {
    const r = check(log([diag("src/f.ts"), diag("src/f.ts", { at: "9,1" })]));
    expect(r.ok).toBe(true);
    expect(r.ignoredByOwner).toEqual({ D: 2 });
  });

  it("rejects three S1 diagnostics in f as an increased signature naming both counts", () => {
    const r = check(log([diag("src/f.ts"), diag("src/f.ts"), diag("src/f.ts", { at: "1,1" })]));
    expect(r.ok).toBe(false);
    expect(r.violations[0].reason).toContain("increased");
    expect(r.violations[0].reason).toContain("log count 3");
    expect(r.violations[0].reason).toContain("baseline count 2");
  });

  it("rejects a new message or a new code in the finished part of f", () => {
    const otherMessage = check(log([diag("src/f.ts", { message: "Another message." })]));
    expect(reasons(otherMessage)).toEqual(["new red-window diagnostic"]);
    const otherCode = check(log([diag("src/f.ts", { code: "TS2724" })]));
    expect(reasons(otherCode)).toEqual(["new red-window diagnostic"]);
  });

  it("rejects a diagnostic in g (owned by B, a non-recorder dependency, and D) as already migrated even when the baseline lists it", () => {
    const r = check(log([diag("src/g.ts")]));
    expect(reasons(r)).toEqual(["file already migrated by B"]);
  });

  it("ignores a diagnostic absent from the baseline in a file owned by D alone", () => {
    const r = check(log([diag("src/d.ts", { message: "Fresh message." })]));
    expect(r.ok).toBe(true);
    expect(r.ignoredByOwner).toEqual({ D: 1 });
  });

  it("matches S1 at another line and column, and continuation lines do not change the signature", () => {
    const r = check(
      log([
        diag("src/f.ts", { at: "100,20" }),
        "  Did you mean 'state'?",
        diag("src/f.ts", { at: "1,2" }),
      ]),
    );
    expect(r.ok).toBe(true);
    expect(r.ignoredByOwner).toEqual({ D: 2 });
  });
});

const INVALID_BASELINES: [string, string | null][] = [
  ["a missing file", null],
  ["malformed JSON", "{ not json"],
  ["a missing recordedBy", JSON.stringify({ entries: [] })],
  [
    "a code that does not match ^TS[0-9]+$",
    JSON.stringify({
      recordedBy: "12.1-01",
      entries: [{ file: "a.ts", code: "E1", message: "m", count: 1 }],
    }),
  ],
  [
    "an empty message",
    JSON.stringify({
      recordedBy: "12.1-01",
      entries: [{ file: "a.ts", code: "TS1", message: "", count: 1 }],
    }),
  ],
  [
    "a multi-line message",
    JSON.stringify({
      recordedBy: "12.1-01",
      entries: [{ file: "a.ts", code: "TS1", message: "a\nb", count: 1 }],
    }),
  ],
  [
    "a count below 1",
    JSON.stringify({
      recordedBy: "12.1-01",
      entries: [{ file: "a.ts", code: "TS1", message: "m", count: 0 }],
    }),
  ],
  [
    "a count that is not an integer",
    JSON.stringify({
      recordedBy: "12.1-01",
      entries: [{ file: "a.ts", code: "TS1", message: "m", count: 1.5 }],
    }),
  ],
  [
    "two entries with one signature",
    JSON.stringify({
      recordedBy: "12.1-01",
      entries: [
        { file: "a.ts", code: "TS1", message: "m", count: 1 },
        { file: "a.ts", code: "TS1", message: "m", count: 2 },
      ],
    }),
  ],
];

let tmpCounter = 0;
function tmpFile(content: string, ext = "log"): string {
  tmpCounter += 1;
  const file = path.join(TMP, `f${tmpCounter}.${ext}`);
  fs.writeFileSync(file, content);
  return file;
}

function cli(args: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: PROJECT_ROOT,
    encoding: "utf-8",
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

describe("red-window checker: baseline validity (review R2-2)", () => {
  it.each(INVALID_BASELINES)("loadBaseline throws BaselineError on %s", (_label, content) => {
    const file = content === null ? path.join(TMP, "absent.json") : tmpFile(content, "json");
    expect(() => loadBaseline(file)).toThrow(BaselineError);
  });

  it.each(INVALID_BASELINES)("the CLI exits 2 on %s (--baseline)", (_label, content) => {
    const baseline = content === null ? path.join(TMP, "absent.json") : tmpFile(content, "json");
    const logFile = tmpFile(log([]));
    expect(cli(["12.1-03", logFile, "--baseline", baseline]).status).toBe(2);
  });
});

const TRIPWIRE = [
  "src/app/(app)/contacts/[id]/page.tsx",
  "src/app/(app)/tickets/[id]/actions.ts",
  "src/app/(app)/tickets/[id]/page.tsx",
  "src/app/(app)/tickets/bulk-action-bar.tsx",
  "src/app/(app)/tickets/filter-chip-row.tsx",
  "src/app/(app)/tickets/ticket-list-row.tsx",
  "src/app/api/public/status/[token]/csat/route.ts",
  "src/components/command-palette.tsx",
  "src/components/tickets/merge-ticket-dialog.tsx",
  "src/components/tickets/snooze-control.tsx",
  "src/components/tickets/status-chip.tsx",
  "src/components/tickets/ticket-actions-menu.tsx",
  "src/components/tickets/ticket-meta-header.tsx",
  "src/components/tickets/ticket-picker.tsx",
  "src/lib/channels/email/ingest-message.ts",
  "src/lib/demo/seed-demo-data.ts",
  "src/lib/tickets/list-query.ts",
  "src/lib/tickets/merge.ts",
  "src/lib/tickets/mutations.ts",
  "src/lib/tickets/status-page-data.ts",
  "tests/e2e/activity-feed.spec.ts",
  "tests/e2e/auto-close.spec.ts",
  "tests/e2e/bulk-actions.spec.ts",
  "tests/e2e/inbox.spec.ts",
  "tests/e2e/mutations.spec.ts",
  "tests/e2e/saved-views.spec.ts",
  "tests/e2e/snooze.spec.ts",
  "tests/e2e/ticket-merge.spec.ts",
  "tests/integration/auto-close.test.ts",
  "tests/integration/email-ingest.test.ts",
  "tests/integration/search-isolation.test.ts",
  "tests/integration/sla-flag-handler.test.ts",
  "tests/integration/snooze-race.test.ts",
  "tests/integration/snooze.test.ts",
  "tests/integration/ticket-merge.test.ts",
  "tests/integration/ticket-mutations.test.ts",
  "tests/support/inbox-fixtures.ts",
  "tests/support/lifecycle-fixtures.ts",
];

describe("red-window checker: the real plan files", () => {
  const plans = loadPhasePlans(PHASE_DIR);

  it("parses 17 plans and the window is 12.1-01 to 12.1-15", () => {
    expect(plans).toHaveLength(17);
    const ids = windowPlans(plans).map((p) => p.id);
    expect(ids).toEqual(
      Array.from({ length: 15 }, (_, i) => `12.1-${String(i + 1).padStart(2, "0")}`),
    );
  });

  it("the transitive dependencies of 12.1-07 include 01, 02, 04, 05, 06, 09 and 10", () => {
    const deps = transitiveDeps(plans, "12.1-07");
    for (const id of [
      "12.1-01",
      "12.1-02",
      "12.1-04",
      "12.1-05",
      "12.1-06",
      "12.1-09",
      "12.1-10",
    ]) {
      expect(deps.has(id), id).toBe(true);
    }
  });

  it("parsePlanFile reads this plan's frontmatter and task files", () => {
    const own = parsePlanFile(fs.readFileSync(path.join(PHASE_DIR, "12.1-02-PLAN.md"), "utf-8"));
    expect(own.id).toBe("12.1-02");
    expect(own.dependsOn).toEqual([]);
    expect(own.files).toContain("tests/support/red-window-tsc.mjs");
    expect(own.taskFiles).toHaveLength(3);
    expect(own.taskFiles[0]).toContain("src/lib/tickets/state-colors.ts");
  });

  it("every one of the 38 files measured red at planning time has an owning plan in the window", () => {
    expect(TRIPWIRE).toHaveLength(38);
    const window = windowPlans(plans);
    const unowned = TRIPWIRE.filter(
      (f) => !window.some((p) => p.files.includes(f) || p.taskFiles.some((t) => t.includes(f))),
    );
    expect(unowned).toEqual([]);
  });
});

describe("red-window checker: CLI on the real plans", () => {
  const MERGE_MESSAGE = "Property 'status' does not exist on type 'LockedTicketRow'.";
  const baselineWith = (entries: unknown[]) =>
    tmpFile(JSON.stringify({ recordedBy: "12.1-01", entries }), "json");
  const listed = () =>
    baselineWith([
      { file: "src/lib/tickets/merge.ts", code: "TS2339", message: MERGE_MESSAGE, count: 1 },
    ]);

  it("exits 2 when the log path does not exist", () => {
    expect(cli(["12.1-03", path.join(TMP, "no-such.log"), "--baseline", listed()]).status).toBe(2);
  });

  it("exits 0 for 12.1-03 on a fresh log holding only TSC_EXIT=0", () => {
    const r = cli(["12.1-03", tmpFile("TSC_EXIT=0\n"), "--baseline", listed()]);
    expect(r.status, r.out).toBe(0);
  });

  it("exits 1 and prints the line for a diagnostic in a file of 12.1-02 (a dependency of 12.1-03)", () => {
    const line = diag("src/lib/tickets/state-colors.ts", {
      code: "TS2304",
      message: "Cannot find name 'x'.",
    });
    const r = cli(["12.1-03", tmpFile(log([line], 2)), "--baseline", listed()]);
    expect(r.status).toBe(1);
    expect(r.out).toContain(line);
  });

  it("merge.ts (12.1-01 and 12.1-07): exits 0 when the baseline lists the signature and 1 when it does not", () => {
    const line = diag("src/lib/tickets/merge.ts", { message: MERGE_MESSAGE, at: "88,14" });
    const ok = cli(["12.1-03", tmpFile(log([line], 2)), "--baseline", listed()]);
    expect(ok.status, ok.out).toBe(0);
    const other = baselineWith([
      { file: "src/lib/tickets/merge.ts", code: "TS2724", message: "Something else.", count: 1 },
    ]);
    const missing = cli(["12.1-03", tmpFile(log([line], 2)), "--baseline", other]);
    expect(missing.status).toBe(1);
    expect(missing.out).toContain("new red-window diagnostic");
  });
});
