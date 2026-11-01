// ---------------------------------------------------------------------------
// scripts/part-a-gate-check.ts: prints and checks .planning/phases/08-security-hardening/
// 08-GATE-A.md, the Part A gate of the Phase 8 split (plan 08-24, rules A-1 to A-13).
//
// Every header line and every table cell of the gate file is derived from one raw evidence
// directory (logs, `.exit` files holding only an exit code, and the structured vitest and
// Playwright results). `check` re-derives the file from the directory named on its
// `Evidence dir:` line and fails on any difference. Hand-written text goes only under `## Notes`.
//
// `pnpm test:egress` and the 08-09 image checks follow plan 08-19's "Recording rule for
// `pnpm test:egress`" and charter rule J: a stop at J1's 20 GiB preflight is `blocked (space)`,
// never `passed`, and a space stop next to any other error in any suite file is `failed`.
// A row with a Phase 8.1 part is always `moved to Phase 8.1` and never closed here.
//
//   pnpm exec tsx scripts/part-a-gate-check.ts spec
//   pnpm exec tsx scripts/part-a-gate-check.ts derive <evidence dir> [--sections <list>]
//   pnpm exec tsx scripts/part-a-gate-check.ts check <gate file> [--sections <list>]
//
// Section names: header, results, evidence, design, matrix, requirements, human. This script
// reads files only. It starts no process and touches no Docker resource.
// ---------------------------------------------------------------------------
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type Required = "part-a" | "phase-8.1" | "both";

export interface SpecRow {
  n: number;
  requirement: string;
  belongsTo: string;
  item: string;
  required: Required;
  partA: string[];
  phase81: string[];
}

/** The spec table of plan 08-24, cell text identical (Task 1 verify 2 compares the two). */
export const SPEC_ROWS: readonly SpecRow[] = [
  {
    n: 1,
    requirement: "AIDA-25",
    belongsTo: "AIDA-25",
    item: "`pnpm audit --prod --audit-level=high` exits 0",
    required: "part-a",
    partA: ["pnpm audit --prod --audit-level=high"],
    phase81: [],
  },
  {
    n: 2,
    requirement: "AIDA-25",
    belongsTo: "AIDA-25",
    item: "the exit code of plain `pnpm audit --prod` is recorded as it is",
    required: "part-a",
    partA: ["pnpm audit --prod exit recorded"],
    phase81: [],
  },
  {
    n: 3,
    requirement: "AIDA-26",
    belongsTo: "AIDA-26",
    item: "`.github/dependabot.yml` exists",
    required: "part-a",
    partA: ["pnpm test :: tests/unit/build-egress-guards.test.ts"],
    phase81: [],
  },
  {
    n: 4,
    requirement: "AIDA-26",
    belongsTo: "AIDA-26",
    item: "a CI job runs `pnpm audit --prod --audit-level=high` (files only)",
    required: "part-a",
    partA: ["pnpm test :: tests/unit/build-egress-guards.test.ts"],
    phase81: [],
  },
  {
    n: 5,
    requirement: "AIDA-27",
    belongsTo: "AIDA-27",
    item: "`app` and `worker` run with a non-zero UID while up",
    required: "phase-8.1",
    partA: [],
    phase81: ["08-14", "08-16"],
  },
  {
    n: 6,
    requirement: "AIDA-27",
    belongsTo: "AIDA-27",
    item: "the one-shot `migrate` runs with a non-zero UID and exits 0",
    required: "phase-8.1",
    partA: [],
    phase81: ["08-14", "08-16"],
  },
  {
    n: 7,
    requirement: "↳",
    belongsTo: "AIDA-27",
    item: "build path: the runner and builder images are built to run as a non-root user",
    required: "part-a",
    partA: [
      "pnpm test :: tests/unit/container-config.test.ts",
      "image check runner",
      "image check builder",
    ],
    phase81: [],
  },
  {
    n: 8,
    requirement: "AIDA-27",
    belongsTo: "AIDA-27",
    item: "an attachment upload succeeds on a fresh volume",
    required: "phase-8.1",
    partA: [],
    phase81: ["08-14"],
  },
  {
    n: 9,
    requirement: "AIDA-27",
    belongsTo: "AIDA-27",
    item: "the upgrade path for an existing root-owned `uploads_data` volume is documented in docs/OPERATIONS.md",
    required: "part-a",
    partA: ["OPERATIONS.md volume upgrade procedure"],
    phase81: [],
  },
  {
    n: 10,
    requirement: "↳",
    belongsTo: "AIDA-27",
    item: "D-09: the documented procedure works on a real root-owned volume, and backups run as non-root",
    required: "phase-8.1",
    partA: [],
    phase81: ["08-23"],
  },
  {
    n: 11,
    requirement: "AIDA-28",
    belongsTo: "AIDA-28",
    item: "an E2E test asserts the CSP header and zero CSP violations on login, inbox, ticket, public request and public status pages",
    required: "part-a",
    partA: ["pnpm test:e2e :: tests/e2e/csp.spec.ts"],
    phase81: [],
  },
  {
    n: 12,
    requirement: "↳",
    belongsTo: "AIDA-28",
    item: "review C6: the same pages under `next start` with the production policy",
    required: "phase-8.1",
    partA: [],
    phase81: ["08-21"],
  },
  {
    n: 13,
    requirement: "↳",
    belongsTo: "AIDA-28",
    item: "D-11: inline script without a nonce is blocked and `connect-src` is `'self'` in production",
    required: "phase-8.1",
    partA: [],
    phase81: ["08-21"],
  },
  {
    n: 14,
    requirement: "AIDA-29",
    belongsTo: "AIDA-29",
    item: "unit tests cover the shipped Caddy topology and a spoofed header",
    required: "part-a",
    partA: ["pnpm test :: tests/unit/client-ip.test.ts"],
    phase81: [],
  },
  {
    n: 15,
    requirement: "AIDA-29",
    belongsTo: "AIDA-29",
    item: "all public routes use the helper",
    required: "part-a",
    partA: [
      "pnpm test:integration :: tests/integration/public-route-limits.test.ts",
      "pnpm test:integration :: tests/integration/auth-ip-source.test.ts",
    ],
    phase81: [],
  },
  {
    n: 16,
    requirement: "AIDA-29",
    belongsTo: "AIDA-29",
    item: "the deployment constraint is documented in docs/OPERATIONS.md",
    required: "part-a",
    partA: ["OPERATIONS.md client IP section"],
    phase81: [],
  },
  {
    n: 17,
    requirement: "↳",
    belongsTo: "AIDA-29",
    item: "D-19: a spoofed X-Forwarded-For through real Caddy does not change the identity",
    required: "phase-8.1",
    partA: [],
    phase81: ["08-22"],
  },
  {
    n: 18,
    requirement: "↳",
    belongsTo: "AIDA-29",
    item: "review C7: over real HTTP against `next start` the client-sent `x-aida-client-ip` is overwritten and the sign-in limiter is per identity",
    required: "phase-8.1",
    partA: [],
    phase81: ["08-21"],
  },
  {
    n: 19,
    requirement: "AIDA-30",
    belongsTo: "AIDA-30",
    item: "`/api/health` is throttled",
    required: "part-a",
    partA: ["pnpm test :: tests/unit/health.test.ts"],
    phase81: [],
  },
  {
    n: 20,
    requirement: "AIDA-30",
    belongsTo: "AIDA-30",
    item: "the throttle does not break the container healthcheck",
    required: "phase-8.1",
    partA: [],
    phase81: ["08-21", "08-22"],
  },
  {
    n: 21,
    requirement: "AIDA-30",
    belongsTo: "AIDA-30",
    item: "`/api/public/status/[token]/attachments/[id]` is throttled",
    required: "part-a",
    partA: ["pnpm test:integration :: tests/integration/public-route-limits.test.ts"],
    phase81: [],
  },
  {
    n: 22,
    requirement: "AIDA-30",
    belongsTo: "AIDA-30",
    item: "`follow-up` enforces a combined request-size cap",
    required: "part-a",
    partA: ["pnpm test:integration :: tests/integration/public-upload-caps.test.ts"],
    phase81: [],
  },
  {
    n: 23,
    requirement: "AIDA-30",
    belongsTo: "AIDA-30",
    item: "both status POST routes check the rate limit before the token lookup",
    required: "part-a",
    partA: ["pnpm test:integration :: tests/integration/public-route-limits.test.ts"],
    phase81: [],
  },
  {
    n: 24,
    requirement: "↳",
    belongsTo: "AIDA-30",
    item: "D-24: bodies above the old 12 MB Caddy cut pass through Caddy within the product limits",
    required: "phase-8.1",
    partA: [],
    phase81: ["08-14"],
  },
  {
    n: 25,
    requirement: "↳",
    belongsTo: "AIDA-30",
    item: "review R2-7: the probe never reaches the upstream through Caddy, and both health routes stay within one database read per 3-second window on the production build",
    required: "phase-8.1",
    partA: [],
    phase81: ["08-21", "08-22"],
  },
  {
    n: 26,
    requirement: "AIDA-31",
    belongsTo: "AIDA-31",
    item: "all four call sites return a fixed category",
    required: "part-a",
    partA: [
      "pnpm test :: tests/unit/connection-test-errors.test.ts",
      "pnpm test :: tests/unit/settings-connection-actions.test.ts",
    ],
    phase81: [],
  },
  {
    n: 27,
    requirement: "AIDA-32",
    belongsTo: "AIDA-32",
    item: "`NEXT_TELEMETRY_DISABLED=1` is set in the image build and runtime",
    required: "both",
    partA: ["pnpm test :: tests/unit/container-config.test.ts"],
    phase81: ["08-14"],
  },
  {
    n: 28,
    requirement: "AIDA-32",
    belongsTo: "AIDA-32",
    item: "`next build` makes no request to Google Fonts",
    required: "part-a",
    partA: [
      "pnpm test :: tests/unit/build-egress-guards.test.ts",
      "pnpm build",
      "build log has no Google Fonts host",
    ],
    phase81: [],
  },
  {
    n: 29,
    requirement: "AIDA-32",
    belongsTo: "AIDA-32",
    item: "`addTag` gates before validating",
    required: "part-a",
    partA: ["pnpm test :: tests/unit/add-tag-gate.test.ts"],
    phase81: [],
  },
  {
    n: 30,
    requirement: "AIDA-32",
    belongsTo: "AIDA-32",
    item: "`sla-flag` documents why its raw SQL has no org filter",
    required: "part-a",
    partA: ["sla-flag raw SQL comment"],
    phase81: [],
  },
  {
    n: 31,
    requirement: "AIDA-32",
    belongsTo: "AIDA-32",
    item: "`docs/SECURITY.md` matches the code",
    required: "phase-8.1",
    partA: [],
    phase81: ["08-15"],
  },
];

type RowKind = "host" | "docker" | "fixed";

const RESULT_ROWS: readonly { key: string; slug: string; kind: RowKind }[] = [
  { key: "pnpm lint", slug: "lint", kind: "host" },
  { key: "pnpm typecheck", slug: "typecheck", kind: "host" },
  { key: "pnpm test", slug: "test", kind: "host" },
  { key: "pnpm build", slug: "build", kind: "host" },
  { key: "pnpm audit --prod", slug: "audit", kind: "host" },
  { key: "pnpm audit --prod --audit-level=high", slug: "audit-high", kind: "host" },
  { key: "pnpm test:integration", slug: "integration", kind: "docker" },
  { key: "pnpm test:e2e", slug: "e2e", kind: "docker" },
  { key: "pnpm test:egress", slug: "egress", kind: "docker" },
  { key: "image check runner", slug: "image-runner", kind: "docker" },
  { key: "image check builder", slug: "image-builder", kind: "docker" },
  { key: "pnpm test:docker-cleanup --run", slug: "cleanup", kind: "docker" },
  { key: "compose stack gate", slug: "none", kind: "fixed" },
];

const EVIDENCE_ROWS: readonly { key: string; slug: string | null; docker: boolean }[] = [
  { key: "pnpm audit --prod exit recorded", slug: null, docker: false },
  { key: "build log has no Google Fonts host", slug: null, docker: false },
  { key: "OPERATIONS.md volume upgrade procedure", slug: "ops-volume", docker: false },
  { key: "OPERATIONS.md client IP section", slug: "ops-client-ip", docker: false },
  { key: "sla-flag raw SQL comment", slug: "sla-flag-comment", docker: false },
  { key: "foreign resources unchanged", slug: null, docker: true },
  { key: "no foreign project named in gate logs", slug: null, docker: true },
];

const DESIGN_ITEMS: readonly string[] = [
  "new tokens live in globals.css, not hardcoded",
  "empty state uses halo and icon box",
  "sidebar uses `sidebar-*` tokens",
  "top bar is sticky with backdrop blur",
  "auth page does not wrap itself",
  "typography uses explicit `text-[Npx]`",
  "dark mode tested",
  "`tsc --noEmit` clean",
];

/** Per requirement: [rows, rows with a Phase 8.1 part] (the counts under the plan's table). */
const SPEC_COUNTS: Record<string, [number, number]> = {
  "AIDA-25": [2, 0],
  "AIDA-26": [2, 0],
  "AIDA-27": [6, 4],
  "AIDA-28": [3, 2],
  "AIDA-29": [5, 2],
  "AIDA-30": [7, 3],
  "AIDA-31": [1, 0],
  "AIDA-32": [5, 2],
};

export const SPEC = {
  rows: SPEC_ROWS,
  results: RESULT_ROWS,
  evidence: EVIDENCE_ROWS,
  design: DESIGN_ITEMS,
};

/** "Manual items" of plan 08-24, the first part of `## Human items still open` (rule A-12). */
const MANUAL_ITEMS: readonly string[] = [
  'Owner: decide whether the Part A commit on the candidate line is enough for `v1.0.0` (08-SPLIT "Release safe point"). This plan offers it only as a candidate.',
  "Owner: Docker VM space (queue item 0a2). Until the host and the VM each have at least 20 GiB free, `pnpm test:egress` and both 08-09 image checks stay `blocked (space)`. Re-run those rows once space is added. The build-path halves of AIDA-27 and AIDA-32 stay open until then.",
  "Owner: Phase 8.1 (Part B, queue row 08.1). The rows marked `moved to Phase 8.1`, the open HIGH findings R4-1 (plan 08-16) and R4-2 (plan 08-05b), and the blockers 0a2 and 08-o2 wait for the owner's decision on how Part B proceeds.",
  "Human: visual approval of the system font stack in light and dark mode, and re-capture of the screenshots and hero GIF in `docs/assets` (plan 08-05, D-26). Never claimed here.",
  "Human: every design-system checklist item recorded as `not run (manual: ...)`.",
  "Orchestrator: if the cleanup dry run listed resources, apply `pnpm test:docker-cleanup --run <run id> --apply` (rule H) and record it in RUN-LOG.md. This plan removes nothing.",
];

export const WORDS: readonly string[] = [
  "passed",
  "failed",
  "blocked (space)",
  "blocked (with evidence)",
  "blocked (docker unhealthy)",
  "not run (<reason>)",
  "moved to Phase 8.1",
  "not applicable (<reason>)",
];

/** J1's assertEnoughSpace text (tests/support/docker-test-preflight.ts), rule A-6. */
export const SPACE_LINE =
  /Free space on (the host|the Docker VM) is [0-9.]+ GiB, below the 20.0 GiB rule J requires before an image build/;

const MOVED = "moved to Phase 8.1";
const DIRTY = "not run (dirty tree)";
const UNHEALTHY = "blocked (docker unhealthy)";
const ERROR_HEADER =
  /^\s*(?:[A-Za-z]+Error|Error)(?: \[[^\]]*\])?: |Unhandled Error|Unhandled Rejection/;
const AUDIT_NETWORK =
  /ERR_PNPM_AUDIT_BAD_RESPONSE|ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|getaddrinfo|socket hang up/;
/** c-WR-09: the registry answered with advisory data (a summary, a count, a table or a link). */
const AUDIT_ADVISORY =
  /^\s*Severity: |^\s*\d+ vulnerabilit(?:y|ies) found|│\s*(?:Package|Vulnerable versions|Patched versions|More info)\s*│|github\.com\/advisories\/GHSA-/;
/** c-WR-09: a network failure counts only on pnpm's ` ERR_PNPM_<CODE>` or an `Error:` line. */
const AUDIT_ERROR_LINE = /^\s*(?:ERR_PNPM_\w+|[A-Za-z]*Error(?: \[[^\]]*\])?:)/;
const GOOGLE_FONTS = /fonts[.]googleapis[.]com|fonts[.]gstatic[.]com|Failed to fetch font/;
const FOREIGN = /aida-dev-db|(-p|--project-name)[ =]aida( |$)|smartcv-/;
const NAMED_TEXT_SIZE = /\btext-(xs|sm|base|lg|xl|[2-9]xl)\b/;
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, "g");
const UI_ALLOWLIST = ["src/app/layout.tsx", "src/app/globals.css"];

export function isWord(w: string): boolean {
  return /^(passed|failed|blocked \((space|with evidence|docker unhealthy)\)|not run \(.+\)|moved to Phase 8\.1|not applicable \(.+\))$/.test(
    w,
  );
}

function rank(w: string): number {
  if (w === "failed") return 0;
  if (w === UNHEALTHY) return 1;
  if (w === "blocked (with evidence)") return 2;
  if (w === "blocked (space)") return 3;
  if (w.startsWith("not run (")) return 4;
  if (w === "passed") return 5;
  return 0;
}

/** Worst word, rule A-11 order; among `not run (...)` words the first in cell order wins. */
export function worstOf(words: readonly string[]): string {
  let worst = "passed";
  for (const w of words) if (rank(w) < rank(worst)) worst = w;
  return worst;
}

// --- quoting (rule A-1) --------------------------------------------------------------------

function stripAnsi(s: string): string {
  return s.replace(ANSI, "");
}

export function quote(text: string): string {
  let s = stripAnsi(text).split(/\r?\n/)[0];
  const home = os.homedir();
  if (home && home !== "/") s = s.split(home).join("~");
  s = s.replace(
    /(PASSWORD|SECRET|PEPPER|_KEY)(\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)/gi,
    "$1$2<redacted>",
  );
  if (s.length > 300) s = s.slice(0, 300);
  return `"${s}"`;
}

/** The space stop from its match to the end of the message (a JSON string ends at `"`). */
function spaceQuote(line: string): string {
  const m = line.match(SPACE_LINE) ?? line.match(/no space left on device/);
  return m ? quote(line.slice(m.index).split('"')[0]) : quote(line);
}

function firstSpace(text: string): string | null {
  return (
    lines(text).find((l) => SPACE_LINE.test(l)) ??
    lines(text).find((l) => /no space left on device/.test(l)) ??
    null
  );
}

function lines(text: string): string[] {
  return stripAnsi(text).split(/\r?\n/);
}

function lastLine(text: string): string {
  const l = lines(text).filter((x) => x.trim() !== "");
  return l.length ? l[l.length - 1] : "";
}

// --- structured results (rule A-5) ---------------------------------------------------------

interface VitestFile {
  name: string;
  status: string;
  message: string;
  passed: number;
  failed: number;
  other: number;
}

function parseVitest(raw: string | null): VitestFile[] | null {
  if (raw === null) return null;
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    return null;
  }
  const tr = (j as { testResults?: unknown }).testResults;
  if (!Array.isArray(tr)) return null;
  return tr.map((t) => {
    const a: { status?: string }[] = Array.isArray(t?.assertionResults) ? t.assertionResults : [];
    const passed = a.filter((x) => x.status === "passed").length;
    const failed = a.filter((x) => x.status === "failed").length;
    return {
      name: String(t?.name ?? ""),
      status: String(t?.status ?? ""),
      message: typeof t?.message === "string" ? t.message : "",
      passed,
      failed,
      other: a.length - passed - failed,
    };
  });
}

function repoPath(name: string): string {
  const i = name.lastIndexOf("/tests/");
  return i === -1 ? name : name.slice(i + 1);
}

interface PwSpec {
  file: string;
  ok: boolean;
  statuses: string[];
}

function parsePlaywright(
  raw: string | null,
): { specs: PwSpec[]; stats: Record<string, number> } | null {
  if (raw === null) return null;
  let j: { suites?: unknown; stats?: Record<string, number> };
  try {
    j = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(j.suites)) return null;
  const specs: PwSpec[] = [];
  const walk = (suites: unknown[]) => {
    for (const s of suites as { specs?: unknown[]; suites?: unknown[] }[]) {
      for (const sp of (s?.specs ?? []) as { file?: string; ok?: boolean; tests?: unknown[] }[])
        specs.push({
          file: String(sp?.file ?? ""),
          ok: sp?.ok === true,
          statuses: ((sp?.tests ?? []) as { status?: string }[]).map((t) => String(t?.status)),
        });
      if (Array.isArray(s?.suites)) walk(s.suites);
    }
  };
  walk(j.suites);
  return { specs, stats: j.stats ?? {} };
}

export type FileCommand = "pnpm test" | "pnpm test:integration" | "pnpm test:e2e";

/** The word of one named test file inside a command's structured result (rule A-5). */
export function fileWord(
  command: FileCommand,
  raw: string | null,
  file: string,
): { word: string; note: string } {
  const missing = { word: "failed", note: `not in result: ${file}` };
  if (command === "pnpm test:e2e") {
    const pw = parsePlaywright(raw);
    if (!pw) return missing;
    const specs = pw.specs.filter(
      (s) => s.file !== "" && (s.file === file || file.endsWith(`/${s.file}`)),
    );
    if (!specs.length) return missing;
    const ok = specs.filter(
      (s) => s.ok && s.statuses.length && s.statuses.every((x) => x === "expected"),
    );
    return {
      word: ok.length === specs.length ? "passed" : "failed",
      note: `${file}: specs=${specs.length} ok=${ok.length}`,
    };
  }
  const v = parseVitest(raw);
  if (!v) return missing;
  const hits = v.filter((t) => t.name.endsWith(`/${file}`));
  if (hits.length !== 1) return missing;
  const t = hits[0];
  return {
    word: t.status === "passed" && t.passed > 0 && t.failed === 0 ? "passed" : "failed",
    note: `${file}: passed=${t.passed} failed=${t.failed} skipped=${t.other}`,
  };
}

// --- egress (rule A-6) ---------------------------------------------------------------------

export function classifyEgress(
  exit: number | null,
  raw: string | null,
  log: string,
): { word: string; note: string } {
  const files = parseVitest(raw);
  const spaceHit = lines(log).find((l) => SPACE_LINE.test(l));
  const space = spaceHit !== undefined;
  const tail = spaceHit !== undefined ? `; ${spaceQuote(spaceHit)}` : "";
  if (raw === null) return { word: "failed", note: `missing: egress.json${tail}` };
  if (!files)
    return { word: "failed", note: `egress.json does not parse or has no testResults${tail}` };
  if (!files.length) return { word: "failed", note: `egress.json has no testResults${tail}` };
  if (!files.some((f) => f.name.endsWith("/tests/integration/egress-isolation.test.ts")))
    return {
      word: "failed",
      note: `not in result: tests/integration/egress-isolation.test.ts${tail}`,
    };
  const headers = lines(log).filter((l) => ERROR_HEADER.test(l));
  const spaceOnly = space && headers.every((l) => SPACE_LINE.test(l));
  const per = files.map((f) => {
    let w: string;
    if (f.status === "passed" && f.passed > 0 && f.failed === 0 && f.message === "") w = "passed";
    else if (f.passed === 0 && f.failed === 0 && (f.message === "" || SPACE_LINE.test(f.message)))
      w = "candidate";
    else w = "failed";
    return { f, w };
  });
  for (const p of per) {
    if (p.w !== "candidate") continue;
    if (exit === 0 || per.some((x) => x.w === "failed")) p.w = "failed";
    else p.w = spaceOnly ? "blocked (space)" : "failed";
  }
  let word = worstOf(per.map((p) => p.w));
  if (exit === 0 && per.some((p) => p.w !== "passed")) word = "failed";
  if (exit !== 0 && per.every((p) => p.w === "passed")) word = "failed";
  const detail = per
    .map(
      (p) =>
        `file=${repoPath(p.f.name)} passed=${p.f.passed} failed=${p.f.failed} other=${p.f.other} word=${p.w}`,
    )
    .join("; ");
  return { word, note: `${detail}${tail}` };
}

// --- evidence directory --------------------------------------------------------------------

class Evidence {
  readonly missing: string[] = [];
  constructor(readonly dir: string) {}
  path(name: string): string {
    return path.join(this.dir, name);
  }
  read(name: string): string | null {
    try {
      return fs.readFileSync(this.path(name), "utf8");
    } catch {
      return null;
    }
  }
  /** A required file: when absent it is listed as MISSING (rule A-2). */
  need(name: string): string {
    const s = this.read(name);
    if (s === null) {
      if (!this.missing.includes(name)) this.missing.push(name);
      return "";
    }
    return s;
  }
  /** c-WR-08: a log a row cites as `log <path>` is required; when absent it is MISSING. */
  cite(name: string): string {
    this.need(name);
    return `log ${this.path(name)}`;
  }
  exit(slug: string, required: boolean): number | null {
    const s = required ? this.need(`${slug}.exit`) : this.read(`${slug}.exit`);
    if (s === null || !/^\s*-?\d+\s*$/.test(s)) return null;
    return Number(s.trim());
  }
}

export interface ResultRow {
  key: string;
  exit: string;
  word: string;
  note: string;
}
export interface EvidenceRow {
  key: string;
  word: string;
  note: string;
}
export interface DesignRow {
  key: string;
  word: string;
  evidence: string;
}
export interface MatrixRow {
  n: string;
  requirement: string;
  item: string;
  required: string;
  partAEvidence: string;
  partAState: string;
  phase81Part: string;
  phase81State: string;
  closed: string;
  notes: string[];
}
export interface RequirementRow {
  requirement: string;
  partAClosed: string;
  moved: string;
  closed: string;
}

export interface GateModel {
  header: string[];
  results: ResultRow[];
  evidence: EvidenceRow[];
  design: DesignRow[];
  matrix: MatrixRow[];
  requirements: RequirementRow[];
  human: string[];
}

export const SECTIONS = [
  "header",
  "results",
  "evidence",
  "design",
  "matrix",
  "requirements",
  "human",
] as const;
export type Section = (typeof SECTIONS)[number];

const HEADINGS: Record<Exclude<Section, "header">, string> = {
  results: "## Results",
  evidence: "## Evidence checks",
  design: "## Design-system checklist (§9)",
  matrix: "## Evidence matrix",
  requirements: "## Requirement status",
  human: "## Human items still open",
};

const COLUMNS: Record<Exclude<Section, "header" | "human">, string[]> = {
  results: ["Command", "Exit code", "Result", "Note"],
  evidence: ["Check", "Result", "Note"],
  design: ["Item", "Result", "Evidence"],
  matrix: [
    "#",
    "Requirement",
    "Acceptance item",
    "Required",
    "Part A evidence",
    "Part A state",
    "Phase 8.1 part",
    "Phase 8.1 state",
    "Closed in Part A",
  ],
  requirements: ["Requirement", "Part A rows closed", "Moved to Phase 8.1", "Requirement closed"],
};

function exitText(n: number | null): string {
  return n === null ? "-" : String(n);
}

function vitestRow(ev: Evidence, slug: string, json: string): ResultRow {
  const exit = ev.exit(slug, true);
  const files = parseVitest(ev.read(json));
  const log = ev.cite(`${slug}.log`);
  if (!files)
    return {
      key: "",
      exit: exitText(exit),
      word: "failed",
      note: `${log}; missing or unparsable: ${json}`,
    };
  const raw = JSON.parse(ev.read(json) ?? "{}") as { numFailedTests?: number };
  const sum = (k: "passed" | "failed" | "other") => files.reduce((a, f) => a + f[k], 0);
  const ok =
    exit === 0 &&
    files.length > 0 &&
    raw.numFailedTests === 0 &&
    files.every((f) => f.status === "passed");
  return {
    key: "",
    exit: exitText(exit),
    word: ok ? "passed" : "failed",
    note: `${log}; files=${files.length} passed=${sum("passed")} failed=${sum("failed")} skipped=${sum("other")}`,
  };
}

function hostRow(ev: Evidence, slug: string): ResultRow {
  if (slug === "test") return vitestRow(ev, slug, "test.json");
  const exit = ev.exit(slug, true);
  const log = ev.cite(`${slug}.log`);
  if (slug === "audit" || slug === "audit-high") {
    const text = ev.need(`${slug}.log`);
    if (exit === 0) return { key: "", exit: "0", word: "passed", note: log };
    const advisories = lines(text).some((l) => AUDIT_ADVISORY.test(l));
    const net = advisories
      ? undefined
      : lines(text).find((l) => AUDIT_ERROR_LINE.test(l) && AUDIT_NETWORK.test(l));
    if (net && exit !== null)
      return {
        key: "",
        exit: exitText(exit),
        word: "blocked (with evidence)",
        note: `${log}; ${quote(net)}`,
      };
    const sev = lines(text).find((l) => /^Severity: /.test(l.trim()));
    return {
      key: "",
      exit: exitText(exit),
      word: "failed",
      note: `${log}; exit ${exitText(exit)}${sev ? `; ${quote(sev.trim())}` : ""}`,
    };
  }
  return { key: "", exit: exitText(exit), word: exit === 0 ? "passed" : "failed", note: log };
}

/**
 * c-CR-02: the exit test-image-check.ts gives each summary word (its EXIT_CODES: passed 0,
 * blocked 3, not run 4). `failed` and anything else has none, so it can never be backed.
 */
export function imageWordExit(word: string): number | null {
  if (word === "passed") return 0;
  if (word === "blocked (space)" || word === "blocked (with evidence)") return 3;
  if (/^not run \(parked: [a-z-]+\)$/.test(word)) return 4;
  return null;
}

/** test-image-check.ts summaryWord, restated so this script imports nothing that runs Docker. */
function imageSummaryWord(state: unknown, cause: unknown): string {
  if (state === "passed") return "passed";
  if (state === "blocked") return cause === "space" ? "blocked (space)" : "blocked (with evidence)";
  if (state === "not run") return `not run (parked: ${String(cause)})`;
  return "failed";
}

/**
 * c-CR-02: the cross-checks that tie one image row together: the recorded exit, the verify line,
 * the image log's own IMAGE-CHECK-RESULT line and the gate's run id. Returns the disagreements.
 */
function imageDisagreements(
  word: string,
  exit: number | null,
  verify: string,
  clog: string,
  target: string,
  runId: string,
): string[] {
  const out: string[] = [];
  const want = imageWordExit(word);
  if (want === null || exit !== want)
    out.push(`exit ${exitText(exit)} disagrees with ${word} (expects ${want ?? "none"})`);
  const field = (k: string) => verify.match(new RegExp(` ${k}=(\\S+)`))?.[1] ?? null;
  const tag = `aida-test-nonroot-${target}:${runId}`;
  if (field("target") !== target) out.push(`verify target ${field("target")}, expects ${target}`);
  if (field("tag") !== tag) out.push(`verify tag ${field("tag")}, expects tag ${tag}`);
  const echoed = field("exit");
  if (echoed !== null && echoed !== exitText(exit))
    out.push(`verify exit=${echoed}, image exit file ${exitText(exit)}`);
  const results = lines(clog).filter((l) => l.startsWith("IMAGE-CHECK-RESULT "));
  if (results.length !== 1) {
    out.push(`${results.length} IMAGE-CHECK-RESULT lines in image-${target}.log, expects 1`);
    return out;
  }
  let r: Record<string, unknown>;
  try {
    r = JSON.parse(results[0].slice("IMAGE-CHECK-RESULT ".length)) as Record<string, unknown>;
  } catch {
    out.push(`unreadable IMAGE-CHECK-RESULT line in image-${target}.log`);
    return out;
  }
  if (r.runId !== runId) out.push(`IMAGE-CHECK-RESULT run id ${String(r.runId)}, expects ${runId}`);
  if (r.target !== target)
    out.push(`IMAGE-CHECK-RESULT target ${String(r.target)}, expects ${target}`);
  if (r.tag !== tag) out.push(`IMAGE-CHECK-RESULT tag ${String(r.tag)}, expects ${tag}`);
  const own = imageSummaryWord(r.state, r.cause);
  if (own !== word) out.push(`IMAGE-CHECK-RESULT says ${own}, verify says ${word}`);
  return out;
}

function imageRow(ev: Evidence, target: string, runId: string): ResultRow {
  const exit = ev.exit(`image-${target}`, true);
  const vexit = ev.exit(`image-${target}-verify`, false);
  const vlog = ev.read(`image-${target}-verify.log`) ?? "";
  const clog = ev.read(`image-${target}.log`) ?? "";
  const vlines = lines(vlog).filter((l) => l.startsWith("IMAGE-CHECK-VERIFY state="));
  const failedLine = lines(vlog).find((l) => l.startsWith("IMAGE-CHECK-VERIFY FAILED:"));
  const space = firstSpace(clog);
  let word = "failed";
  let note: string;
  if (vlines.length === 1) note = quote(vlines[0]);
  else if (failedLine) note = quote(failedLine);
  else note = `${vlines.length} IMAGE-CHECK-VERIFY state= lines in image-${target}-verify.log`;
  if (vexit === 0 && !failedLine && vlines.length === 1) {
    const m = vlines[0].match(/ word="([^"]*)"/);
    const w = m ? m[1] : "";
    if (isWord(w)) word = w;
    if (word === "blocked (space)" && !space) {
      word = "failed";
      note += `; no space line in image-${target}.log`;
    }
    if (word !== "failed") {
      const problems = imageDisagreements(word, exit, vlines[0], clog, target, runId);
      if (problems.length > 0) {
        word = "failed";
        note += `; ${problems.join("; ")}`;
      }
    }
  }
  if (vexit !== 0) note += `; verify exit ${exitText(vexit)}`;
  if (space && word === "blocked (space)") note += `; ${spaceQuote(space)}`;
  return { key: "", exit: exitText(exit), word, note };
}

function cleanupRow(ev: Evidence, runId: string): ResultRow {
  const exit = ev.exit("cleanup", true);
  const last = lastLine(ev.read("cleanup.log") ?? "");
  const want = `0 resource(s) of run ${runId}; dry run, nothing removed.`;
  const ok = exit === 0 && last === want;
  return { key: "", exit: exitText(exit), word: ok ? "passed" : "failed", note: quote(last) };
}

function dockerHealth(ev: Evidence): { healthy: boolean; note: string } {
  const part = (slug: string, cmd: string) => {
    const exit = ev.exit(slug, true);
    const log = ev.read(`${slug}.log`) ?? "";
    const first = lines(log).find((l) => l.trim() !== "") ?? "";
    const bad = exit !== 0 || lines(log).some((l) => /^\s*(error|fatal)\b/i.test(l));
    return { bad, note: `${cmd} exit ${exitText(exit)}: ${quote(first)}` };
  };
  const c = part("docker-health.colima", "colima status");
  const d = part("docker-health.info", "docker info");
  return { healthy: !c.bad && !d.bad, note: `${c.note}; ${d.note}` };
}

/** Changed `.tsx` and `.css` paths of the Part A source patch, and their added lines. */
function patchUi(patch: string): { paths: string[]; added: string[] } {
  const paths: string[] = [];
  const added: string[] = [];
  let current: string | null = null;
  for (const l of lines(patch)) {
    if (l.startsWith("+++ ")) {
      const p = l.startsWith("+++ b/") ? l.slice(6) : null;
      current = p && /\.(tsx|css)$/.test(p) ? p : null;
      if (current && !paths.includes(current)) paths.push(current);
      continue;
    }
    if (current && l.startsWith("+")) added.push(l.slice(1));
  }
  return { paths, added };
}

export function deriveGate(
  dir: string,
  sections: readonly Section[] = SECTIONS,
): { text: string; missing: string[]; model: GateModel } {
  const ev = new Evidence(path.resolve(dir));
  const head = ev.need("head.txt").trim();
  const date = ev.need("date.txt").trim();
  const runId = ev.need("run-id.txt").trim();
  const tree = ev.need("tree-state.txt");
  const dirtyPaths = tree
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .map((l) => (/^.. /.test(l) ? l.slice(3) : l.trim()));
  const dirty = dirtyPaths.length > 0;

  const header = [
    "# Phase 8 Part A gate",
    "",
    `Tested commit: ${head}`,
    `Date: ${date}`,
    `Run id: ${runId}`,
    `Evidence dir: ${ev.dir}`,
    `Tree state: ${dirty ? "dirty" : "clean"}`,
    ...(dirty ? ["Dirty paths:", ...dirtyPaths.map((p) => `  ${p}`)] : []),
    "",
    `Candidate safe point for v1.0.0 (owner decides; not the Phase 8 safe point): ${dirty ? "none (dirty tree)" : head}`,
  ];

  // Results (rules A-3, A-4).
  const health = dirty ? { healthy: true, note: "" } : dockerHealth(ev);
  const results: ResultRow[] = RESULT_ROWS.map((r) => {
    let row: ResultRow;
    if (r.kind === "fixed")
      row = {
        key: "",
        exit: "-",
        word: MOVED,
        note: "Part B: plan 08-16 (deferred-8.1); not run by this gate (08-SPLIT)",
      };
    else if (dirty) row = { key: "", exit: "-", word: DIRTY, note: "-" };
    else if (r.kind === "docker" && !health.healthy)
      row = { key: "", exit: "-", word: UNHEALTHY, note: health.note };
    else if (r.kind === "host") row = hostRow(ev, r.slug);
    else if (r.slug === "integration") row = vitestRow(ev, "integration", "integration.json");
    else if (r.slug === "e2e") {
      const exit = ev.exit("e2e", true);
      const pw = parsePlaywright(ev.read("e2e.json"));
      const log = ev.need("e2e.log");
      const st = pw?.stats ?? {};
      const n = (k: string) => (typeof st[k] === "number" ? st[k] : 0);
      const leak = lines(log).some((l) => /taskkill.*not found/i.test(l));
      const ok = exit === 0 && !!pw && n("unexpected") === 0 && !leak;
      row = {
        key: "",
        exit: exitText(exit),
        word: ok ? "passed" : "failed",
        note: `${ev.cite("e2e.log")}; ${pw ? "" : "missing or unparsable: e2e.json; "}expected=${n("expected")} unexpected=${n("unexpected")} skipped=${n("skipped")} flaky=${n("flaky")}${leak ? "; taskkill not found in log" : ""}`,
      };
    } else if (r.slug === "egress") {
      const exit = ev.exit("egress", true);
      const e = classifyEgress(exit, ev.read("egress.json"), ev.need("egress.log"));
      row = {
        key: "",
        exit: exitText(exit),
        word: e.word,
        note: `${ev.cite("egress.log")}; ${e.note}`,
      };
    } else if (r.slug === "image-runner") row = imageRow(ev, "runner", runId);
    else if (r.slug === "image-builder") row = imageRow(ev, "builder", runId);
    else row = cleanupRow(ev, runId);
    return { ...row, key: r.key };
  });
  const resultWord = (k: string) => results.find((r) => r.key === k)?.word ?? "failed";

  // Evidence checks (rule A-9).
  const evidence: EvidenceRow[] = EVIDENCE_ROWS.map((e) => {
    if (dirty) return { key: e.key, word: DIRTY, note: "-" };
    if (e.docker && !health.healthy) return { key: e.key, word: UNHEALTHY, note: health.note };
    if (e.slug) {
      const exit = ev.exit(e.slug, true);
      const last = lastLine(ev.need(`${e.slug}.log`));
      const cited = ev.cite(`${e.slug}.log`);
      if (last === "")
        return { key: e.key, word: "failed", note: `${cited}: no output to evidence the check` };
      return {
        key: e.key,
        word: exit === 0 ? "passed" : "failed",
        note: `${cited}: ${quote(last)}`,
      };
    }
    if (e.key === "pnpm audit --prod exit recorded") {
      const raw = ev.read("audit.exit");
      const log = ev.read("audit.log") ?? "";
      const ok = raw !== null && /^\s*-?\d+\s*$/.test(raw) && log.trim() !== "";
      return {
        key: e.key,
        word: ok ? "passed" : "failed",
        note: `exit ${raw === null ? "-" : raw.trim()}`,
      };
    }
    if (e.key === "build log has no Google Fonts host") {
      const log = ev.read("build.log");
      if (log === null || log.trim() === "")
        return { key: e.key, word: "failed", note: "build.log missing or empty" };
      const hit = lines(log).find((l) => GOOGLE_FONTS.test(l));
      return hit
        ? { key: e.key, word: "failed", note: quote(hit) }
        : { key: e.key, word: "passed", note: `log ${ev.path("build.log")}: no Google Fonts host` };
    }
    if (e.key === "foreign resources unchanged") {
      const a = ev.read("foreign-before.txt");
      const b = ev.read("foreign-after.txt");
      if (a === null || b === null)
        return {
          key: e.key,
          word: "failed",
          note: `missing: ${a === null ? "foreign-before.txt" : "foreign-after.txt"}`,
        };
      if (a === b)
        return {
          key: e.key,
          word: "passed",
          note: `${a.split("\n").filter((l) => l).length} listed line(s), identical`,
        };
      const al = a.split("\n");
      const bl = b.split("\n");
      let i = 0;
      while (al[i] === bl[i]) i++;
      return {
        key: e.key,
        word: "failed",
        note: `first difference: ${quote(bl[i] ?? al[i] ?? "")}`,
      };
    }
    // no foreign project named in gate logs
    let names: string[] = [];
    try {
      names = fs
        .readdirSync(ev.dir)
        .filter((n) => n.endsWith(".log"))
        .sort();
    } catch {
      names = [];
    }
    for (const n of names) {
      const hit = lines(ev.read(n) ?? "").find((l) => FOREIGN.test(l));
      if (hit) return { key: e.key, word: "failed", note: `${n}: ${quote(hit)}` };
    }
    return { key: e.key, word: "passed", note: `${names.length} log file(s) scanned` };
  });
  const evidenceWord = (k: string) => evidence.find((r) => r.key === k)?.word ?? "failed";

  // Named sources (rule A-5) and their words.
  const testJson = ev.read("test.json");
  const integrationJson = ev.read("integration.json");
  const e2eJson = ev.read("e2e.json");
  const sourceWord = (s: string): { word: string; note: string } => {
    const [cmd, file] = s.split(" :: ");
    if (file) {
      const command = cmd as FileCommand;
      const row = resultWord(command);
      if (row.startsWith("not run") || row === UNHEALTHY)
        return { word: row, note: `${file}: ${row}` };
      const raw =
        command === "pnpm test"
          ? testJson
          : command === "pnpm test:integration"
            ? integrationJson
            : e2eJson;
      const f = fileWord(command, raw, file);
      return { word: worstOf([row, f.word]), note: f.note };
    }
    if (RESULT_ROWS.some((r) => r.key === s))
      return { word: resultWord(s), note: `${s}: ${resultWord(s)}` };
    if (EVIDENCE_ROWS.some((r) => r.key === s))
      return { word: evidenceWord(s), note: `${s}: ${evidenceWord(s)}` };
    return { word: "failed", note: `unknown source: ${s}` };
  };

  // Design-system checklist (rule A-10).
  const patch = ev.read("part-a-src.patch");
  const ui = patch === null ? null : patchUi(patch);
  const design: DesignRow[] = DESIGN_ITEMS.map((item, i) => {
    const key = `${i + 1} ${item}`;
    if (dirty) return { key, word: DIRTY, evidence: "-" };
    const n = i + 1;
    if (n === 1) {
      const src = [
        "pnpm test :: tests/unit/design-tokens.test.ts",
        "pnpm test :: tests/unit/build-egress-guards.test.ts",
      ];
      return { key, word: worstOf(src.map((s) => sourceWord(s).word)), evidence: src.join("; ") };
    }
    if (n >= 2 && n <= 5) {
      if (!ui) return { key, word: "failed", evidence: "missing: part-a-src.patch" };
      if (!ui.paths.length)
        return {
          key,
          word: "not applicable (Part A changed no .tsx or .css file)",
          evidence: "part-a-src.patch",
        };
      if (ui.paths.every((p) => UI_ALLOWLIST.includes(p))) {
        const only = UI_ALLOWLIST.filter((p) => ui.paths.includes(p)).join(", ");
        return {
          key,
          word: `not applicable (Part A changed only ${only})`,
          evidence: "part-a-src.patch",
        };
      }
      return {
        key,
        word: `not run (manual: ${ui.paths.length} UI files changed)`,
        evidence: `part-a-src.patch: ${ui.paths.join(", ")}`,
      };
    }
    if (n === 6) {
      if (!ui) return { key, word: "failed", evidence: "missing: part-a-src.patch" };
      const hit = ui.added.find((l) => NAMED_TEXT_SIZE.test(l));
      return hit
        ? { key, word: "failed", evidence: quote(hit.trim()) }
        : {
            key,
            word: "passed",
            evidence: `part-a-src.patch: ${ui.added.length} added .tsx/.css line(s), no named text size`,
          };
    }
    if (n === 7) return { key, word: "not run (manual: visual check)", evidence: "human item" };
    return { key, word: resultWord("pnpm typecheck"), evidence: "pnpm typecheck" };
  });

  // Matrix and requirement status (rule A-11).
  const matrix: MatrixRow[] = SPEC_ROWS.map((r) => {
    const words = r.partA.map(sourceWord);
    const partAState = r.required === "phase-8.1" ? "-" : worstOf(words.map((w) => w.word));
    return {
      n: String(r.n),
      requirement: r.requirement,
      item: r.item,
      required: r.required,
      partAEvidence: r.partA.length ? r.partA.join("; ") : "-",
      partAState,
      phase81Part: r.phase81.length ? r.phase81.join(", ") : "-",
      phase81State: r.required === "part-a" ? "-" : MOVED,
      closed: r.required === "part-a" && partAState === "passed" ? "yes" : "no",
      notes: words.map((w) => w.note),
    };
  });
  const requirements: RequirementRow[] = Object.keys(SPEC_COUNTS).map((req) => {
    const own = SPEC_ROWS.map((r, i) => ({ r, m: matrix[i] })).filter((x) => x.r.belongsTo === req);
    const withA = own.filter((x) => x.r.required !== "phase-8.1");
    const partAClosed =
      withA.length > 0 && withA.every((x) => x.m.partAState === "passed") ? "yes" : "no";
    const movedRows = own.filter((x) => x.r.phase81.length > 0).map((x) => String(x.r.n));
    const moved = movedRows.length ? movedRows.join(", ") : "-";
    const closed = partAClosed === "yes" ? (moved === "-" ? "yes" : "no (split: Phase 8.1)") : "no";
    return { requirement: req, partAClosed, moved, closed };
  });

  // Human items (rule A-12).
  const human = MANUAL_ITEMS.map((m) => `- ${m}`);
  const openDesign = design.filter(
    (d) => d.word !== "passed" && !d.word.startsWith("not applicable ("),
  );
  if (openDesign.length)
    human.push("", "Design-system checklist:", ...openDesign.map((d) => `- ${d.key}: ${d.word}`));
  const rerun = [
    ...results
      .filter((r) => r.word !== "passed" && r.word !== MOVED)
      .map((r) => `- Results: ${r.key}: ${r.word}`),
    ...evidence
      .filter((r) => r.word !== "passed" && r.word !== MOVED)
      .map((r) => `- Evidence checks: ${r.key}: ${r.word}`),
  ];
  if (rerun.length) human.push("", "Re-run once the cause is gone:", ...rerun);

  const model: GateModel = { header, results, evidence, design, matrix, requirements, human };
  const out: string[] = [];
  if (sections.includes("header")) out.push(...header, "");
  const table = (s: Exclude<Section, "header" | "human">, rows: string[][]) => {
    out.push(
      HEADINGS[s],
      "",
      row(COLUMNS[s]),
      row(COLUMNS[s].map(() => "---")),
      ...rows.map(row),
      "",
    );
  };
  if (sections.includes("results"))
    table(
      "results",
      results.map((r) => [r.key, r.exit, r.word, r.note]),
    );
  if (sections.includes("evidence"))
    table(
      "evidence",
      evidence.map((r) => [r.key, r.word, r.note]),
    );
  if (sections.includes("design"))
    table(
      "design",
      design.map((r) => [r.key, r.word, r.evidence]),
    );
  if (sections.includes("matrix"))
    table(
      "matrix",
      matrix.map((m) => [
        m.n,
        m.requirement,
        m.item,
        m.required,
        m.partAEvidence,
        m.partAState,
        m.phase81Part,
        m.phase81State,
        m.closed,
      ]),
    );
  if (sections.includes("requirements"))
    table(
      "requirements",
      requirements.map((r) => [r.requirement, r.partAClosed, r.moved, r.closed]),
    );
  if (sections.includes("human")) out.push(HEADINGS.human, "", ...human, "");
  return { text: out.join("\n"), missing: ev.missing, model };
}

// --- tables --------------------------------------------------------------------------------

function escapeCell(s: string): string {
  return s.replace(/\|/g, "\\|");
}

function row(cells: string[]): string {
  return `| ${cells.map(escapeCell).join(" | ")} |`;
}

/** Split a table line on unescaped `|` only (rule A-1). */
export function splitRow(line: string): string[] {
  const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === "\\" && inner[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (inner[i] === "|") {
      cells.push(cur.trim());
      cur = "";
    } else cur += inner[i];
  }
  cells.push(cur.trim());
  return cells;
}

/** An ATX heading as `## text`: up to 3 leading spaces, closing `#`s and spaces dropped. */
function normHeading(line: string): string | null {
  const m = line.match(/^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/);
  return m ? `${m[1]} ${m[2]}` : null;
}

function headingCount(text: string, heading: string): number {
  return text.split(/\r?\n/).filter((l) => normHeading(l) === heading).length;
}

/** The lines of the first section with this heading, up to the next `#` or `##` heading. */
function sectionAt(text: string, heading: string): { start: number; body: string[] } | null {
  const all = text.split(/\r?\n/);
  const i = all.findIndex((l) => normHeading(l) === heading);
  if (i === -1) return null;
  let e = i + 1;
  while (e < all.length && !/^#{1,2} /.test(normHeading(all[e]) ?? "")) e++;
  return { start: i + 1, body: all.slice(i + 1, e) };
}

function sectionLines(text: string, heading: string): string[] | null {
  return sectionAt(text, heading)?.body ?? null;
}

/**
 * c-WR-07: a gated section holds one table and blank lines, nothing else. Every line that starts
 * with `|` (after optional spaces) is a table line, with or without a space after the pipe; any
 * other non-blank line, a second table, a bad delimiter row and a row of the wrong width fail.
 */
function parseTable(
  start: number,
  body: string[],
  width: number,
): { header: string[] | null; rows: string[][]; problems: string[] } {
  const problems: string[] = [];
  const table: { cells: string[]; n: number }[] = [];
  let phase: "before" | "in" | "after" = "before";
  body.forEach((l, i) => {
    const n = start + i + 1;
    if (l.trim() === "") {
      if (phase === "in") phase = "after";
      return;
    }
    if (!/^\s*\|/.test(l)) {
      problems.push(`line ${n} is not a table row: ${JSON.stringify(l.slice(0, 80))}`);
      return;
    }
    if (phase === "after") {
      problems.push(`line ${n} starts a second table`);
      return;
    }
    phase = "in";
    table.push({ cells: splitRow(l), n });
  });
  const header = table[0]?.cells ?? null;
  const delim = table[1];
  if (delim && (delim.cells.length !== width || !delim.cells.every((c) => /^:?-{3,}:?$/.test(c))))
    problems.push(`line ${delim.n} is not the delimiter row`);
  const rows: string[][] = [];
  for (const r of table.slice(2)) {
    if (r.cells.length !== width)
      problems.push(`line ${r.n} has ${r.cells.length} cells, expects ${width}`);
    else rows.push(r.cells);
  }
  return { header, rows, problems };
}

// --- check ---------------------------------------------------------------------------------

const HEADER_KEYS = [
  "# Phase 8 Part A gate",
  "Tested commit",
  "Date",
  "Run id",
  "Evidence dir",
  "Tree state",
  "Candidate safe point",
];

function headerKey(line: string): string | null {
  return (
    HEADER_KEYS.find((k) => line === k || line.startsWith(`${k}:`) || line.startsWith(`${k} `)) ??
    null
  );
}

export function checkGate(
  text: string,
  sections: readonly Section[] = SECTIONS,
): { ok: boolean; lines: string[] } {
  const fail: string[] = [];
  const f = (s: string, k: string, d: string) =>
    fail.push(`PART-A-GATE-CHECK FAILED: ${s}: ${k}: ${d}`);
  const dirLine = text.split(/\r?\n/).find((l) => l.startsWith("Evidence dir: "));
  if (!dirLine) {
    f("header", "Evidence dir", "no Evidence dir line");
    return { ok: false, lines: fail };
  }
  const derived = deriveGate(dirLine.slice("Evidence dir: ".length), SECTIONS);
  for (const m of derived.missing) f("header", "Evidence dir", `evidence file missing: ${m}`);
  const want = derived.model;

  if (sections.includes("header")) {
    const all = text.split(/\r?\n/);
    const firstSection = all.findIndex((l) => l.startsWith("## "));
    const top = firstSection === -1 ? all : all.slice(0, firstSection);
    for (const k of HEADER_KEYS) {
      const exp = want.header.filter((l) => headerKey(l) === k);
      const got = top.filter((l) => headerKey(l) === k);
      if (JSON.stringify(exp) !== JSON.stringify(got))
        f(
          "header",
          k,
          `expected ${JSON.stringify(exp.join(" / "))}, found ${JSON.stringify(got.join(" / "))}`,
        );
    }
    const dp = (ls: string[]) => {
      const i = ls.indexOf("Dirty paths:");
      if (i === -1) return [];
      const out = [];
      for (let j = i + 1; j < ls.length && ls[j].startsWith("  "); j++) out.push(ls[j]);
      return ["Dirty paths:", ...out];
    };
    if (JSON.stringify(dp(want.header)) !== JSON.stringify(dp(top)))
      f(
        "header",
        "Dirty paths",
        `expected ${JSON.stringify(dp(want.header))}, found ${JSON.stringify(dp(top))}`,
      );
  }

  const once = (s: Exclude<Section, "header">) => {
    const n = headingCount(text, HEADINGS[s]);
    if (n > 1) f(s, "section", `${HEADINGS[s]} occurs ${n} times`);
  };
  const compare = (s: Exclude<Section, "header" | "human">, expRows: string[][]) => {
    once(s);
    const sec = sectionAt(text, HEADINGS[s]);
    if (!sec) {
      f(s, "section", `missing ${HEADINGS[s]}`);
      return;
    }
    const t = parseTable(sec.start, sec.body, COLUMNS[s].length);
    for (const p of t.problems) f(s, "table", p);
    if (!t.header || JSON.stringify(t.header) !== JSON.stringify(COLUMNS[s]))
      f(s, "columns", `expected ${COLUMNS[s].join(" | ")}`);
    const got = t.rows;
    for (let i = 0; i < Math.max(expRows.length, got.length); i++) {
      const e = expRows[i];
      const g = got[i];
      if (!e) {
        f(s, g[0], "extra row");
        continue;
      }
      if (!g) {
        f(s, e[0], "row missing");
        continue;
      }
      for (let c = 0; c < COLUMNS[s].length; c++)
        if (e[c] !== g[c])
          f(
            s,
            e[0],
            `${COLUMNS[s][c]}: expected ${JSON.stringify(e[c])}, found ${JSON.stringify(g[c] ?? "")}`,
          );
    }
  };
  if (sections.includes("results"))
    compare(
      "results",
      want.results.map((r) => [r.key, r.exit, r.word, r.note]),
    );
  if (sections.includes("evidence"))
    compare(
      "evidence",
      want.evidence.map((r) => [r.key, r.word, r.note]),
    );
  if (sections.includes("design"))
    compare(
      "design",
      want.design.map((r) => [r.key, r.word, r.evidence]),
    );
  if (sections.includes("matrix"))
    compare(
      "matrix",
      want.matrix.map((m) => [
        m.n,
        m.requirement,
        m.item,
        m.required,
        m.partAEvidence,
        m.partAState,
        m.phase81Part,
        m.phase81State,
        m.closed,
      ]),
    );
  if (sections.includes("requirements"))
    compare(
      "requirements",
      want.requirements.map((r) => [r.requirement, r.partAClosed, r.moved, r.closed]),
    );
  if (sections.includes("human")) {
    once("human");
    const body = sectionLines(text, HEADINGS.human);
    if (!body) f("human", "section", `missing ${HEADINGS.human}`);
    else
      for (const b of want.human.filter((l) => l !== ""))
        if (!body.includes(b)) f("human", b, "missing");
  }
  return { ok: fail.length === 0, lines: fail };
}

// --- CLI (rule A-13) -----------------------------------------------------------------------

export function assertSpec(): void {
  const keys = [...RESULT_ROWS.map((r) => r.key), ...EVIDENCE_ROWS.map((r) => r.key)];
  for (const [req, [rows, moved]] of Object.entries(SPEC_COUNTS)) {
    const own = SPEC_ROWS.filter((r) => r.belongsTo === req);
    if (own.length !== rows || own.filter((r) => r.phase81.length).length !== moved)
      throw new Error(
        `spec: ${req} has ${own.length} rows, expected ${rows} (${moved} with a Phase 8.1 part)`,
      );
  }
  for (const r of SPEC_ROWS) {
    if ((r.required === "part-a") !== (r.phase81.length === 0))
      throw new Error(`spec: row ${r.n} Required vs Phase 8.1 part`);
    if ((r.required === "phase-8.1") !== (r.partA.length === 0))
      throw new Error(`spec: row ${r.n} Required vs Part A sources`);
    for (const s of r.partA)
      if (!keys.includes(s) && !/^(pnpm test|pnpm test:integration|pnpm test:e2e) :: \S+$/.test(s))
        throw new Error(`spec: row ${r.n} source ${s} names no row key and no file`);
  }
}

export interface Io {
  out: (s: string) => void;
  err: (s: string) => void;
}

const defaultIo: Io = {
  out: (s) => process.stdout.write(`${s}\n`),
  err: (s) => process.stderr.write(`${s}\n`),
};

function parseSections(argv: string[]): Section[] | null {
  const i = argv.indexOf("--sections");
  if (i === -1) return [...SECTIONS];
  const list = (argv[i + 1] ?? "").split(",").filter(Boolean);
  if (!list.length || !list.every((s) => (SECTIONS as readonly string[]).includes(s))) return null;
  return list as Section[];
}

export function main(argv: string[], io: Io = defaultIo): number {
  assertSpec();
  const [cmd, target] = argv;
  const rest = argv.slice(2);
  const okRest = rest.length === 0 || (rest.length === 2 && rest[0] === "--sections");
  if (cmd === "spec" && argv.length === 1) {
    io.out(
      JSON.stringify(
        { rows: SPEC_ROWS, results: RESULT_ROWS, evidence: EVIDENCE_ROWS, design: DESIGN_ITEMS },
        null,
        2,
      ),
    );
    return 0;
  }
  const sections = parseSections(argv);
  if ((cmd === "derive" || cmd === "check") && target && okRest && sections) {
    if (cmd === "derive") {
      const d = deriveGate(target, sections);
      if (d.missing.length) {
        for (const m of d.missing) io.err(`PART-A-GATE-DERIVE MISSING: ${m}`);
        return 1;
      }
      io.out(d.text.replace(/\n+$/, ""));
      return 0;
    }
    let text: string;
    try {
      text = fs.readFileSync(target, "utf8");
    } catch {
      io.out(`PART-A-GATE-CHECK FAILED: header: file: cannot read ${target}`);
      return 1;
    }
    const r = checkGate(text, sections);
    if (!r.ok) {
      for (const l of r.lines) io.out(l);
      return 1;
    }
    const all = sections.length === SECTIONS.length;
    const counts: string[] = [];
    if (sections.includes("results")) counts.push(`results=${RESULT_ROWS.length}`);
    if (sections.includes("evidence")) counts.push(`evidence=${EVIDENCE_ROWS.length}`);
    if (sections.includes("design")) counts.push(`design=${DESIGN_ITEMS.length}`);
    if (sections.includes("matrix")) counts.push(`matrix=${SPEC_ROWS.length}`);
    if (sections.includes("requirements"))
      counts.push(`requirements=${Object.keys(SPEC_COUNTS).length}`);
    io.out(
      `PART-A-GATE-CHECK ok sections=${all ? "all" : sections.join(",")} ${counts.join(" ")}`.trimEnd(),
    );
    return 0;
  }
  io.err(
    "Usage: part-a-gate-check spec | derive <evidence dir> [--sections <list>] | check <gate file> [--sections <list>]",
  );
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
