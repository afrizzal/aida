import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PROJECT_OPERATIONS, type ProjectOperationSpec } from "../../src/lib/projects/contract";

/**
 * Phase 14 operation inventory (plan 14-13, contract sections 1 and 17; review C5 and C7).
 *
 * This test is a completeness check only: it shows that the expected exports, test blocks and
 * names exist for every operation of the frozen table (PROJECT_OPERATIONS). It proves nothing
 * about behaviour. The proof of isolation and activity is the behaviour tests themselves, which
 * assert per actor the result, snapshot equality and the verb values; no gate or SUMMARY cites
 * this inventory as that proof.
 *
 * The block parser and every rule are pure functions over a map from path to source text, so the
 * real run (the repository files) and the negative cases (fixed strings) use the same code.
 * Lines whose first non-space characters are //, /* or * are left out of a block's text, so a
 * call or marker written only in a comment never counts.
 */

type Ops = Readonly<Record<string, ProjectOperationSpec>>;
type Sources = Readonly<Record<string, string>>;

// Contract sections 1 and 17: the nine operations that take no project, task, comment,
// attachment, label, milestone or team id, so their isolation block needs no missingId().
const NO_TARGET_ID_OPERATIONS = [
  "createProject",
  "listProjects",
  "listWorkspaceTasks",
  "listWorkspaceMilestones",
  "listFavorites",
  "listTeams",
  "createTeam",
  "getProjectsProgress",
  "resolveTaskKey",
] as const;

// Contract sections 1 and 17: write operations are those with at least one verb, plus the four
// favorite toggles (they write a row but no activity, D-05). Their isolation block compares
// projectTableSnapshot() and checks ProjectActivity.
const WRITES_WITHOUT_VERB = [
  "favoriteProject",
  "unfavoriteProject",
  "favoriteTask",
  "unfavoriteTask",
] as const;

const TEAM_WITHOUT_HIDDEN_LINK = "createTeam";
const HIDDEN_LINK_MARKER = "hidden private link";
const ISOLATION_FILE = /^tests\/integration\/project-[^/]*-isolation\.test\.ts$/;
const PROJECT_INTEGRATION_FILE = /^tests\/integration\/project-[^/]*\.test\.ts$/;
const PROJECT_TEST_FILE = /^tests\/(?:integration|unit)\/projects?-[^/]*\.test\.ts$/;
const SERVICE_FILE = /^src\/lib\/projects\/[^/]*\.ts$/;
const FIXTURES_FILE = "tests/support/project-fixtures.ts";
const SINGLE_ROW_MEMBERSHIP_READ = "findActiveMembership";

type BlockKind = "describe" | "it" | "test";
interface Block {
  file: string;
  kind: BlockKind;
  title: string;
  startLine: number;
  /** Every non-comment line from the opening line to the closing line. */
  text: string;
}

function isCommentLine(line: string): boolean {
  return /^\s*(?:\/\/|\/\*|\*)/.test(line);
}

function stripStrings(line: string): string {
  return line.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""');
}

function parenBalance(line: string): number {
  const bare = stripStrings(line);
  return (bare.match(/\(/g)?.length ?? 0) - (bare.match(/\)/g)?.length ?? 0);
}

const OPENER = /^(\s*)(describe|it|test)(?:\.each\(.*\))?\(/;

/** The closing line of a block opened at `start` with indentation `indent`, or -1. */
function closingLine(lines: string[], start: number, indent: string): number {
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith(indent) && /^[})]/.test(line.slice(indent.length))) return i;
  }
  return -1;
}

function parseBlocks(file: string, source: string): Block[] {
  const lines = source.split(/\r?\n/);
  const blocks: Block[] = [];
  lines.forEach((line, start) => {
    const match = OPENER.exec(line);
    if (!match || isCommentLine(line)) return;
    const indent = match[1];
    const end = parenBalance(line) <= 0 ? start : closingLine(lines, start, indent);
    const last = end === -1 ? lines.length - 1 : end;
    const raw = lines.slice(start, last + 1);
    const fromCall = [raw[0].slice(match[0].length), ...raw.slice(1)].join("\n");
    const title = /(["'`])((?:\\.|(?!\1)[\s\S])*)\1/.exec(fromCall)?.[2] ?? "";
    blocks.push({
      file,
      kind: match[2] as BlockKind,
      title,
      startLine: start + 1,
      text: raw.filter((l) => !isCommentLine(l)).join("\n"),
    });
  });
  return blocks;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasWord(text: string, word: string): boolean {
  return new RegExp(`(?<![A-Za-z0-9_$])${escapeRegExp(word)}(?![A-Za-z0-9_$])`).test(text);
}

function callsOperation(text: string, op: string): boolean {
  return new RegExp(`(?<![A-Za-z0-9_$])${escapeRegExp(op)}\\(`).test(text);
}

function filesMatching(sources: Sources, pattern: RegExp): string[] {
  return Object.keys(sources)
    .filter((file) => pattern.test(file))
    .sort();
}

function blocksOf(sources: Sources, pattern: RegExp): Block[] {
  return filesMatching(sources, pattern).flatMap((file) => parseBlocks(file, sources[file]));
}

// Run decision K70: a marker also counts when it sits in a helper function or constant that the
// block itself references, defined at module level in the same test file or in tests/support/*.ts,
// following that helper's own references in turn. A sibling block is never a definition, so its
// text still never counts, and a helper that the block does not reference never counts. The
// marker functions themselves (projectTableSnapshot, missingId) are not expanded: what they read
// is checked by their own rule (snapshotGaps), so calling projectTableSnapshot( never stands in
// for the separate ProjectActivity check.
const SUPPORT_FILE = /^tests\/support\/[^/]*\.ts$/;
const NOT_EXPANDED = new Set(["projectTableSnapshot", "missingId"]);
const DEFINITION =
  /^(?:export\s+)?(?:(?:async\s+)?function\s*\*?\s*|(?:const|let|var)\s+)([A-Za-z_$][\w$]*)/;

/** Module-level function and constant definitions of one file: name to non-comment text. */
function moduleDefinitions(source: string): Map<string, string> {
  const lines = source.split(/\r?\n/);
  const defs = new Map<string, string>();
  lines.forEach((line, start) => {
    const match = DEFINITION.exec(line);
    if (!match) return;
    let end = start + 1;
    while (end < lines.length && !/^[^\s})\]]/.test(lines[end])) end++;
    const text = lines
      .slice(start, end)
      .filter((l) => !isCommentLine(l))
      .join("\n");
    defs.set(match[1], text);
  });
  return defs;
}

/**
 * The block's own text plus the text of every module-level helper or constant it references,
 * transitively (K70). Definitions of the block's own file win over tests/support ones.
 */
function resolvedText(sources: Sources, file: string, text: string): string {
  const own = moduleDefinitions(sources[file] ?? "");
  const support = new Map<string, string>();
  for (const f of filesMatching(sources, SUPPORT_FILE)) {
    for (const [name, def] of moduleDefinitions(sources[f])) {
      if (!support.has(name)) support.set(name, def);
    }
  }
  const seen = new Set<string>();
  const parts = [text];
  const queue = [text];
  while (queue.length > 0) {
    const current = queue.shift() ?? "";
    for (const [name] of current.matchAll(/[A-Za-z_$][\w$]*/g)) {
      if (seen.has(name) || NOT_EXPANDED.has(name)) continue;
      const def = own.get(name) ?? support.get(name);
      if (def === undefined) continue;
      seen.add(name);
      parts.push(def);
      queue.push(def);
    }
  }
  return parts.join("\n");
}

function isWriteOperation(op: string, spec: ProjectOperationSpec): boolean {
  return spec.verbs.length > 0 || (WRITES_WITHOUT_VERB as readonly string[]).includes(op);
}

/** The markers the isolation block of `op` must contain (contract section 17). */
function isolationMarkers(
  op: string,
  spec: ProjectOperationSpec,
): [string, (t: string) => boolean][] {
  const markers: [string, (t: string) => boolean][] = [
    [`${op}(`, (t) => callsOperation(t, op)],
    ["MEMBERSHIP_ENDED", (t) => t.includes("MEMBERSHIP_ENDED")],
  ];
  if (!(NO_TARGET_ID_OPERATIONS as readonly string[]).includes(op)) {
    markers.push(["missingId(", (t) => /(?<![A-Za-z0-9_$])missingId\(/.test(t)]);
  }
  if (spec.isolation === "TEAM" && op !== TEAM_WITHOUT_HIDDEN_LINK) {
    markers.push([`"${HIDDEN_LINK_MARKER}"`, (t) => t.includes(HIDDEN_LINK_MARKER)]);
  }
  if (isWriteOperation(op, spec)) {
    markers.push([
      "projectTableSnapshot(",
      (t) => /(?<![A-Za-z0-9_$])projectTableSnapshot\(/.test(t),
    ]);
    markers.push(["projectActivity or ProjectActivity", (t) => /[pP]rojectActivity/.test(t)]);
  }
  return markers;
}

function isolationGaps(sources: Sources, ops: Ops): string[] {
  const files = filesMatching(sources, ISOLATION_FILE);
  const blocks = blocksOf(sources, ISOLATION_FILE);
  const gaps: string[] = [];
  for (const [op, spec] of Object.entries(ops)) {
    const titled = blocks.filter((block) => hasWord(block.title, op));
    const label = `${op} (${spec.isolation})`;
    if (titled.length === 0) {
      gaps.push(
        `${label}: no block titled with ${op} in ${files.join(", ") || "(no isolation file)"}`,
      );
      continue;
    }
    const [callMarker, ...otherMarkers] = isolationMarkers(op, spec);
    const missingPerBlock = titled.map((block) => {
      // The operation call must be in the block's own text; the other markers may also sit in a
      // helper or constant the block references (K70).
      const resolved = resolvedText(sources, block.file, block.text);
      return {
        block,
        missing: [
          ...(callMarker[1](block.text) ? [] : [callMarker[0]]),
          ...otherMarkers.filter(([, test]) => !test(resolved)).map(([name]) => name),
        ],
      };
    });
    if (missingPerBlock.some(({ missing }) => missing.length === 0)) continue;
    const best = missingPerBlock.reduce((a, b) => (b.missing.length < a.missing.length ? b : a));
    gaps.push(
      `${label}: no single titled block holds every marker; closest "${best.block.title}" ` +
        `(${best.block.file}:${best.block.startLine}) lacks ${best.missing.join(", ")}`,
    );
  }
  return gaps;
}

function activityGaps(sources: Sources, ops: Ops): string[] {
  const cases = blocksOf(sources, PROJECT_INTEGRATION_FILE).filter((b) => b.kind !== "describe");
  const gaps: string[] = [];
  for (const [op, spec] of Object.entries(ops)) {
    for (const verb of spec.verbs) {
      const found = cases.some((b) => callsOperation(b.text, op) && hasWord(b.text, verb));
      if (!found) gaps.push(`${op} / ${verb}: no it or test block calls ${op}( and names ${verb}`);
    }
  }
  return gaps;
}

function skipFocusGaps(sources: Sources): string[] {
  const gaps: string[] = [];
  for (const file of filesMatching(sources, PROJECT_TEST_FILE)) {
    sources[file].split(/\r?\n/).forEach((line, index) => {
      if (isCommentLine(line)) return;
      if (/\b(?:describe|it|test)(?:\.\w+)*\.(?:skip|only|todo)\b/.test(line)) {
        gaps.push(`${file}:${index + 1}: skipped or focused case: ${line.trim()}`);
      }
    });
  }
  return gaps;
}

function exportGaps(sources: Sources, ops: Ops): string[] {
  const declared = new Map<string, string[]>();
  for (const file of filesMatching(sources, SERVICE_FILE)) {
    const pattern = /export\s+async\s+function\s+(\w+)\(\s*actor\b/g;
    for (const match of sources[file].matchAll(pattern)) {
      declared.set(match[1], [...(declared.get(match[1]) ?? []), file]);
    }
  }
  const gaps: string[] = [];
  for (const [op, spec] of Object.entries(ops)) {
    const files = declared.get(op);
    const expected = `src/lib/projects/${spec.module}.ts`;
    if (!files) gaps.push(`${op} (${spec.module}): not exported as an operation from ${expected}`);
    else if (files.length !== 1 || files[0] !== expected) {
      gaps.push(`${op} (${spec.module}): declared in ${files.join(", ")}, expected ${expected}`);
    }
  }
  for (const [name, files] of declared) {
    if (!(name in ops))
      gaps.push(`${name}: exported operation not in PROJECT_OPERATIONS (${files.join(", ")})`);
  }
  return gaps;
}

function importGaps(sources: Sources): string[] {
  const gaps: string[] = [];
  for (const file of filesMatching(sources, SERVICE_FILE)) {
    const text = sources[file];
    if (/(?:from|import\()\s*["']@\//.test(text)) gaps.push(`${file}: path-alias import`);
    if (/(?:from|import\()\s*["']next(?:\/[^"']*)?["']/.test(text))
      gaps.push(`${file}: import from next`);
    if (text.includes(SINGLE_ROW_MEMBERSHIP_READ))
      gaps.push(`${file}: uses ${SINGLE_ROW_MEMBERSHIP_READ}`);
  }
  return gaps;
}

function snapshotGaps(sources: Sources): string[] {
  const source = sources[FIXTURES_FILE];
  if (source === undefined) return [`${FIXTURES_FILE}: missing`];
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((l) =>
    /^(\s*)(?:export\s+)?(?:async\s+)?function\s+projectTableSnapshot\b/.test(l),
  );
  if (start === -1) return [`${FIXTURES_FILE}: no projectTableSnapshot function`];
  // The whole function up to the next module-level statement: biome puts the `): Type {` line of
  // a wrapped signature at column 0, so a closing-line search would stop before the body.
  const text = moduleDefinitions(source).get("projectTableSnapshot") ?? "";
  // K70: module-level constants the function references (such as SNAPSHOT_ORDER) count.
  return /[pP]rojectActivity/.test(resolvedText(sources, FIXTURES_FILE, text))
    ? []
    : [
        `${FIXTURES_FILE}:${start + 1}: the projectTableSnapshot function block names no projectActivity or ProjectActivity`,
      ];
}

function noTargetIdGaps(ops: Ops): string[] {
  const expected = Object.entries(ops)
    .filter(
      ([op, spec]) =>
        ["CREATE", "LIST", "KEY"].includes(spec.isolation) ||
        op === "listTeams" ||
        op === "createTeam",
    )
    .map(([op]) => op)
    .sort();
  const actual = [...NO_TARGET_ID_OPERATIONS].sort();
  return JSON.stringify(expected) === JSON.stringify(actual)
    ? []
    : [`NO_TARGET_ID_OPERATIONS ${actual.join(", ")} differs from ${expected.join(", ")}`];
}

// ---------------------------------------------------------------------------------------------
// Repository run

const ROOT = path.resolve(__dirname, "../..");
const SELF = "tests/unit/project-operation-inventory.test.ts";

function readDir(dir: string, pattern: RegExp): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(path.join(ROOT, dir))) {
    const file = `${dir}/${name}`;
    if (pattern.test(file) && file !== SELF)
      out[file] = readFileSync(path.join(ROOT, file), "utf8");
  }
  return out;
}

const REPO: Sources = {
  ...readDir("src/lib/projects", SERVICE_FILE),
  ...readDir("tests/integration", PROJECT_TEST_FILE),
  ...readDir("tests/unit", PROJECT_TEST_FILE),
  ...readDir("tests/support", SUPPORT_FILE),
  [FIXTURES_FILE]: readFileSync(path.join(ROOT, FIXTURES_FILE), "utf8"),
};

function report(gaps: string[]): string {
  return gaps.length === 0 ? "" : `${gaps.length} gap(s):\n${gaps.join("\n")}`;
}

describe("project operation inventory (completeness check only)", () => {
  it("PROJECT_OPERATIONS has 76 operations and NO_TARGET_ID_OPERATIONS is its CREATE, LIST, KEY set plus listTeams and createTeam", () => {
    expect(Object.keys(PROJECT_OPERATIONS)).toHaveLength(76);
    expect(report(noTargetIdGaps(PROJECT_OPERATIONS))).toBe("");
  });

  it("the exported operations of src/lib/projects are exactly PROJECT_OPERATIONS, each in its module", () => {
    expect(report(exportGaps(REPO, PROJECT_OPERATIONS))).toBe("");
  });

  it("every operation has an isolation block with its call, MEMBERSHIP_ENDED and the markers of its class", () => {
    expect(report(isolationGaps(REPO, PROJECT_OPERATIONS))).toBe("");
  });

  it("the projectTableSnapshot fixture reads ProjectActivity", () => {
    expect(report(snapshotGaps(REPO))).toBe("");
  });

  it("every (operation, verb) pair is named in an it or test block that calls the operation", () => {
    expect(report(activityGaps(REPO, PROJECT_OPERATIONS))).toBe("");
  });

  it("no project test case is skipped or focused", () => {
    expect(report(skipFocusGaps(REPO))).toBe("");
  });

  it("no Phase 14 module uses a path-alias import, a Next.js import or the single-row membership read", () => {
    expect(report(importGaps(REPO))).toBe("");
  });
});

// ---------------------------------------------------------------------------------------------
// Parser and rule cases over fixed source strings (review C7)

const ISO = "tests/integration/project-fixture-isolation.test.ts";
const ACT = "tests/integration/project-fixture.test.ts";
const pick = (...names: string[]): Ops =>
  Object.fromEntries(
    names.map((name) => [name, PROJECT_OPERATIONS[name as keyof typeof PROJECT_OPERATIONS]]),
  );

const WELL_FORMED_ISOLATION = `
describe("getTask (TARGET)", () => {
  it("refused actors equal a missing id", async () => {
    expect(await getTask(actor, missingId())).toEqual(refused);
    expect(await getTask(outsiderInA, id)).toEqual({ ok: false, code: "MEMBERSHIP_ENDED" });
  });
});

describe("updateTask (TARGET)", () => {
  it("refusals change nothing", async () => {
    const before = await projectTableSnapshot(prisma, orgA);
    const count = await prisma.projectActivity.count();
    expect(await updateTask(actor, missingId(), 0, {})).toEqual(refused);
    expect(await updateTask(outsiderInA, id, 0, {})).toEqual({ ok: false, code: "MEMBERSHIP_ENDED" });
    expect(await projectTableSnapshot(prisma, orgA)).toEqual(before);
  });
});

describe("getTeam (TEAM)", () => {
  it("hidden private link: two teams give equal results", async () => {
    expect(await getTeam(outsider, missingId())).toEqual(await getTeam(outsider, teamId));
    expect(await getTeam(outsiderInA, teamId)).toEqual({ ok: false, code: "MEMBERSHIP_ENDED" });
  });
});

describe("createProject (CREATE)", () => {
  it("every member creates", async () => {
    const before = await projectTableSnapshot(prisma, orgA);
    expect(await createProject(outsiderInA, input)).toEqual({ ok: false, code: "MEMBERSHIP_ENDED" });
    expect(await prisma.projectActivity.count()).toBe(0);
  });
});

describe("listProjects (LIST)", () => {
  it("lists", async () => {
    expect(await listProjects(outsiderInA)).toEqual({ ok: false, code: "MEMBERSHIP_ENDED" });
  });
});

describe("resolveTaskKey (KEY)", () => {
  it("resolves", async () => {
    expect(await resolveTaskKey(outsiderInA, key)).toEqual({ ok: false, code: "MEMBERSHIP_ENDED" });
  });
});
`;

const WELL_FORMED_ACTIVITY = `
describe("tasks", () => {
  it("updateTask writes TASK_UPDATED", async () => {
    await updateTask(actor, id, 0, { title: "x" });
    expect(rows.map((r) => r.verb)).toEqual(["TASK_UPDATED"]);
  });
  test("createProject writes PROJECT_CREATED", async () => {
    await createProject(actor, input);
    expect(row.verb).toBe(ProjectActivityVerb.PROJECT_CREATED);
  });
});
`;

describe("inventory rules on fixed sources", () => {
  it("positive control: a well-formed source gives no gap, and CREATE, LIST and KEY blocks need no missingId()", () => {
    const sources = { [ISO]: WELL_FORMED_ISOLATION, [ACT]: WELL_FORMED_ACTIVITY };
    const ops = pick(
      "getTask",
      "updateTask",
      "getTeam",
      "createProject",
      "listProjects",
      "resolveTaskKey",
    );
    expect(isolationGaps(sources, ops)).toEqual([]);
    expect(activityGaps(sources, pick("updateTask", "createProject"))).toEqual([]);
    expect(skipFocusGaps(sources)).toEqual([]);
    expect(noTargetIdGaps(PROJECT_OPERATIONS)).toEqual([]);
  });

  it("negative: a block titled getTaskProgress is not offered for getTask", () => {
    const source = `
describe("getTaskProgress (TARGET)", () => {
  it("x", async () => {
    expect(await getTask(actor, missingId())).toEqual({ ok: false, code: "MEMBERSHIP_ENDED" });
  });
});
`;
    const gaps = isolationGaps({ [ISO]: source }, pick("getTask"));
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatch(/^getTask \(TARGET\): no block titled with getTask/);
  });

  it("negative: a block whose title names the operation but whose text never calls it", () => {
    const source = `
describe("getTask (TARGET)", () => {
  it("x", async () => {
    expect(await getProject(actor, missingId())).toEqual({ ok: false, code: "MEMBERSHIP_ENDED" });
  });
});
`;
    expect(isolationGaps({ [ISO]: source }, pick("getTask"))[0]).toMatch(/lacks getTask\($/);
  });

  it("negative: MEMBERSHIP_ENDED present only in a sibling block", () => {
    const source = `
describe("getTask (TARGET)", () => {
  it("x", async () => {
    expect(await getTask(actor, missingId())).toEqual(refused);
  });
});

describe("sibling", () => {
  it("y", () => {
    expect(code).toBe("MEMBERSHIP_ENDED");
  });
});
`;
    expect(isolationGaps({ [ISO]: source }, pick("getTask"))[0]).toMatch(/lacks MEMBERSHIP_ENDED$/);
  });

  it("negative: the call present only in a comment line", () => {
    const source = `
describe("getTask (TARGET)", () => {
  it("x", async () => {
    // await getTask(actor, missingId())
    expect(await other(actor, missingId())).toEqual({ ok: false, code: "MEMBERSHIP_ENDED" });
  });
});
`;
    expect(isolationGaps({ [ISO]: source }, pick("getTask"))[0]).toMatch(/lacks getTask\($/);
  });

  it("negative: a write block without projectTableSnapshot(", () => {
    const source = `
describe("updateTask (TARGET)", () => {
  it("x", async () => {
    const count = await prisma.projectActivity.count();
    expect(await updateTask(actor, missingId(), 0, {})).toEqual({ ok: false, code: "MEMBERSHIP_ENDED" });
  });
});
`;
    expect(isolationGaps({ [ISO]: source }, pick("updateTask"))[0]).toMatch(
      /lacks projectTableSnapshot\($/,
    );
  });

  it("negative: a TARGET block without missingId(", () => {
    const source = `
describe("getTask (TARGET)", () => {
  it("x", async () => {
    expect(await getTask(actor, "unknown")).toEqual({ ok: false, code: "MEMBERSHIP_ENDED" });
  });
});
`;
    expect(isolationGaps({ [ISO]: source }, pick("getTask"))[0]).toMatch(/lacks missingId\($/);
  });

  it("negative: a TEAM block other than createTeam without the hidden private link case", () => {
    const source = `
describe("getTeam (TEAM)", () => {
  it("x", async () => {
    expect(await getTeam(actor, missingId())).toEqual({ ok: false, code: "MEMBERSHIP_ENDED" });
  });
});
`;
    expect(isolationGaps({ [ISO]: source }, pick("getTeam"))[0]).toMatch(
      /lacks "hidden private link"$/,
    );
  });

  it("negative: a verb named in a different it block than the call", () => {
    const source = `
describe("tasks", () => {
  it("calls", async () => {
    await updateTask(actor, id, 0, { title: "x" });
  });
  it("asserts", () => {
    expect(row.verb).toBe("TASK_UPDATED");
  });
});
`;
    expect(activityGaps({ [ACT]: source }, pick("updateTask"))).toEqual([
      "updateTask / TASK_UPDATED: no it or test block calls updateTask( and names TASK_UPDATED",
    ]);
  });

  it("negative: a helper holding the marker is defined but not called by the block (K70)", () => {
    const source = `
const ENDED = { ok: false, code: "MEMBERSHIP_ENDED" };

async function expectEnded(call: () => Promise<unknown>): Promise<void> {
  expect(await call()).toEqual({ ok: false, code: "MEMBERSHIP_ENDED" });
}

describe("getTask (TARGET)", () => {
  it("x", async () => {
    expect(await getTask(actor, missingId())).toEqual(refused);
  });
});
`;
    expect(isolationGaps({ [ISO]: source }, pick("getTask"))[0]).toMatch(/lacks MEMBERSHIP_ENDED$/);
  });

  it("negative: projectTableSnapshot( never stands in for the ProjectActivity check (K70)", () => {
    const support = `
const ORDER = { ProjectActivity: [{ id: "asc" }] } as const;

export async function projectTableSnapshot(prisma: PrismaClient, orgId: string) {
  return Object.keys(ORDER);
}
`;
    const source = `
describe("updateTask (TARGET)", () => {
  it("x", async () => {
    const before = await projectTableSnapshot(prisma, orgA);
    expect(await updateTask(actor, missingId(), 0, {})).toEqual({ ok: false, code: "MEMBERSHIP_ENDED" });
    expect(await projectTableSnapshot(prisma, orgA)).toEqual(before);
  });
});
`;
    const sources = { [ISO]: source, [FIXTURES_FILE]: support };
    expect(isolationGaps(sources, pick("updateTask"))[0]).toMatch(
      /lacks projectActivity or ProjectActivity$/,
    );
    expect(snapshotGaps(sources)).toEqual([]);
  });

  it("positive: markers reached through helpers and constants the block references count (K70)", () => {
    const support = `
export function missingId(): string {
  return "missing";
}
`;
    const source = `
const ENDED = { ok: false, code: "MEMBERSHIP_ENDED" };

async function activityCount(orgId: string): Promise<number> {
  return prisma.projectActivity.count({ where: { organizationId: orgId } });
}

async function refusedWrite(w: World, run: () => Promise<unknown>): Promise<unknown> {
  const before = await projectTableSnapshot(prisma, w.orgA);
  const count = await activityCount(w.orgA);
  const result = await run();
  expect(await projectTableSnapshot(prisma, w.orgA)).toEqual(before);
  expect(await activityCount(w.orgA)).toBe(count);
  return result;
}

async function expectTargetWrite(w: World, call: Call): Promise<void> {
  expect(await refusedWrite(w, () => call(actor, missingId()))).toEqual(refused);
  expect(await refusedWrite(w, () => call(outsiderInA(w), id))).toEqual(ENDED);
}

describe("updateTask (TARGET)", () => {
  it("x", async () => {
    await expectTargetWrite(w, (actor, id) => updateTask(actor, id, 0, {}));
  });
});
`;
    const sources = { [ISO]: source, "tests/support/project-fixtures.ts": support };
    expect(isolationGaps(sources, pick("updateTask"))).toEqual([]);
  });

  it("negative: an it.skip( case", () => {
    const source = `describe("a", () => {\n  it.skip("b", () => {});\n});\n`;
    expect(skipFocusGaps({ [ACT]: source })).toHaveLength(1);
  });

  it("negative: a describe.only( case", () => {
    const source = `describe.only("a", () => {\n  it("b", () => {});\n});\n`;
    expect(skipFocusGaps({ [ACT]: source })).toHaveLength(1);
  });
});
