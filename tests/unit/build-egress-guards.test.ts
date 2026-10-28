/// <reference types="node" />
// Permanent guards for the build-path egress and CI cost decisions of Phase 8 (plan 08-05):
// - D-26 / AIDA-32: no Google-hosted font loader, one system font stack, so `next build`
//   makes no request to Google Fonts.
// - D-27: telemetry and the Prisma checkpoint ping are off for every pnpm step in CI.
// - D-06, D-07 / AIDA-26: Dependabot and the `audit` workflow exist on the owner's triggers.
// - Charter rule I (owner decision 2026-11-11, no GitHub cost): every job on ubuntu-latest,
//   no scheduled trigger outside the existing integration.yml nightly, Dependabot limit 3.
// Plain text checks on file contents only; no YAML package is a dependency of the repo.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const read = (rel: string): string => fs.readFileSync(path.join(PROJECT_ROOT, rel), "utf-8");

function walk(relDir: string, exts: string[]): { rel: string; content: string }[] {
  const out: { rel: string; content: string }[] = [];
  const abs = path.join(PROJECT_ROOT, relDir);
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(relDir, entry.name);
    if (entry.isDirectory()) {
      // Generated Prisma client is gitignored output, not source.
      if (rel === path.join("src", "generated")) continue;
      out.push(...walk(rel, exts));
    } else if (exts.some((e) => entry.name.endsWith(e))) {
      out.push({ rel, content: fs.readFileSync(path.join(PROJECT_ROOT, rel), "utf-8") });
    }
  }
  return out;
}

const GOOGLE_FONT_LOADER = ["next", "font", "google"].join("/");

describe("build-path egress guards (D-26, D-27, AIDA-32)", () => {
  const srcFiles = walk("src", [".ts", ".tsx", ".css"]);

  it("D-26: no .ts or .tsx file under src/ imports the Google-hosted font loader", () => {
    const hits = srcFiles
      .filter((f) => /\.tsx?$/.test(f.rel) && f.content.includes(GOOGLE_FONT_LOADER))
      .map((f) => f.rel);
    expect(srcFiles.length).toBeGreaterThan(0);
    expect(hits).toEqual([]);
  });

  it("D-26: the root layout puts no font .variable class on the html element", () => {
    const layout = read("src/app/layout.tsx");
    const html = layout.match(/<html\b[^>]*>/);
    const htmlTag = html?.[0] ?? "";
    expect(htmlTag).toMatch(/^<html\b/);
    expect(htmlTag).not.toMatch(/\.variable/);
    expect(htmlTag).toContain("suppressHydrationWarning");
    expect(layout).not.toMatch(/\.variable\b/);
  });

  it("D-26: globals.css defines --font-system once and sans, heading and body all use it", () => {
    const css = read("src/app/globals.css");
    expect(css.match(/--font-system\s*:/g) ?? []).toHaveLength(1);
    expect(css).toMatch(/--font-sans:\s*var\(--font-system\);/);
    expect(css).toMatch(/--font-heading:\s*var\(--font-system\);/);
    const body = css.match(/\bbody\s*\{[^}]*\}/);
    expect(body?.[0] ?? "").toMatch(/font-family:\s*var\(--font-system\);/);
  });

  it("D-26: no file under src/ references --font-inter", () => {
    const hits = srcFiles.filter((f) => f.content.includes("--font-inter")).map((f) => f.rel);
    expect(hits).toEqual([]);
  });
});

// ---- YAML text helpers (no YAML package; every check runs on comment-stripped text) ----

/** Drops full-line comments and cuts a trailing comment that starts with whitespace + `#`. */
function stripYamlComments(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .map((line) => line.replace(/\s+#.*$/, ""))
    .join("\n");
}

/** Lines of the column-0 block `key:` (exclusive), up to the next column-0 key. */
function columnZeroBlock(text: string, key: string): string[] | null {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l === `${key}:` || l.startsWith(`${key}: `));
  if (start === -1) return null;
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^[^\s]/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out;
}

/** Keys indented exactly two spaces inside the column-0 block `key:`. */
function blockKeys(text: string, key: string): string[] {
  const block = columnZeroBlock(text, key) ?? [];
  return block.flatMap((l) => {
    const m = l.match(/^ {2}([A-Za-z0-9_-]+):/);
    return m ? [m[1]] : [];
  });
}

/** Each job id under `jobs:` with the lines of its block. */
function jobBlocks(text: string): { id: string; lines: string[] }[] {
  const block = columnZeroBlock(text, "jobs") ?? [];
  const jobs: { id: string; lines: string[] }[] = [];
  for (const line of block) {
    const m = line.match(/^ {2}([A-Za-z0-9_-]+):/);
    if (m) jobs.push({ id: m[1], lines: [] });
    else if (jobs.length > 0) jobs[jobs.length - 1].lines.push(line);
  }
  return jobs;
}

/** Text of the two-space sub-block `sub:` inside column-0 block `key:`. */
function subBlock(text: string, key: string, sub: string): string {
  const block = columnZeroBlock(text, key) ?? [];
  const start = block.findIndex((l) => new RegExp(`^ {2}${sub}:`).test(l));
  if (start === -1) return "";
  const out = [block[start]];
  for (let i = start + 1; i < block.length; i++) {
    if (/^ {2}[^\s]/.test(block[i])) break;
    out.push(block[i]);
  }
  return out.join("\n");
}

const WORKFLOWS_DIR = ".github/workflows";
const wf = (name: string): string => stripYamlComments(read(`${WORKFLOWS_DIR}/${name}`));
const exists = (rel: string): boolean => fs.existsSync(path.join(PROJECT_ROOT, rel));

describe("CI telemetry, dependency automation and GitHub cost guards (D-06, D-07, D-27, rule I)", () => {
  it("D-27: ci.yml, integration.yml and audit.yml set both telemetry opt-outs at workflow level", () => {
    for (const name of ["ci.yml", "integration.yml", "audit.yml"]) {
      expect(exists(`${WORKFLOWS_DIR}/${name}`), name).toBe(true);
      const env = (columnZeroBlock(wf(name), "env") ?? []).map((l) => l.trim());
      expect(env, name).toContain('NEXT_TELEMETRY_DISABLED: "1"');
      expect(env, name).toContain('CHECKPOINT_DISABLE: "1"');
    }
  });

  it("D-07, rule I: audit.yml runs pnpm audit on pull_request, push to master and dispatch only", () => {
    expect(exists(`${WORKFLOWS_DIR}/audit.yml`)).toBe(true);
    const audit = wf("audit.yml");
    expect(audit).toContain("pnpm audit --prod --audit-level=high");
    expect(jobBlocks(audit).map((j) => j.id)).toContain("audit");
    // A GitHub expression, not a JS template: built from parts so the linter reads it as text.
    expect(audit).toContain(["group: audit-", "$", "{{ github.ref }}"].join(""));
    expect(audit).toMatch(/cancel-in-progress: false/);
    expect(blockKeys(audit, "on").sort()).toEqual(["pull_request", "push", "workflow_dispatch"]);
    expect(subBlock(audit, "on", "push")).toMatch(/branches: \[master\]/);
  });

  it("D-06, rule I: dependabot.yml has four weekly entries, each limited to 3 open PRs, minor+patch grouped", () => {
    expect(exists(".github/dependabot.yml")).toBe(true);
    const dep = stripYamlComments(read(".github/dependabot.yml"));
    const entries = dep.split("- package-ecosystem:").slice(1);
    const unquote = (v: string | undefined) => (v ?? "").trim().replace(/^["']|["']$/g, "");
    const ids = entries
      .map((e) => `${unquote(e.split("\n")[0])} ${unquote(e.match(/directory:(.*)/)?.[1])}`)
      .sort();
    expect(ids).toEqual(["docker /", "github-actions /", "npm /", "npm /website"]);
    for (const e of entries) {
      expect(e).toMatch(/interval: weekly/);
      expect(e).toMatch(/open-pull-requests-limit: 3\b/);
      expect(e).toMatch(/update-types:.*minor/);
      expect(e).toMatch(/update-types:.*patch/);
    }
    const limits = dep.split("\n").filter((l) => l.includes("open-pull-requests-limit"));
    expect(limits).toHaveLength(4);
    for (const l of limits) expect(l.trim()).toBe("open-pull-requests-limit: 3");
  });

  it("rule I, K113: integration.yml keeps its one nightly job and cron unchanged and never runs egress", () => {
    const integration = wf("integration.yml");
    const jobs = jobBlocks(integration);
    expect(jobs.map((j) => j.id)).toEqual(["integration"]);
    expect(jobs[0].lines.join("\n")).toMatch(/run: pnpm test:integration\b/);
    expect(blockKeys(integration, "on").sort()).toEqual(["schedule", "workflow_dispatch"]);
    const crons = integration.split("\n").filter((l) => /\bcron:/.test(l));
    expect(crons).toHaveLength(1);
    expect(crons[0]).toMatch(/cron: "0 3 \* \* \*"$/);
    expect(integration).not.toMatch(/pnpm test:egress/);
  });

  it("rule I: every workflow job runs on ubuntu-latest and only integration.yml is scheduled", () => {
    const files = fs
      .readdirSync(path.join(PROJECT_ROOT, WORKFLOWS_DIR))
      .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      const text = wf(name);
      const jobs = jobBlocks(text);
      expect(jobs.length, name).toBeGreaterThan(0);
      for (const job of jobs) {
        const runsOn = job.lines.filter((l) => /^\s+runs-on:/.test(l));
        expect(runsOn, `${name} job ${job.id}`).toHaveLength(1);
        expect(runsOn[0].trim(), `${name} job ${job.id}`).toBe("runs-on: ubuntu-latest");
      }
      if (name !== "integration.yml") {
        expect(blockKeys(text, "on"), name).not.toContain("schedule");
      }
    }
    // Plan 08-05b (Phase 8.1) adds egress.yml; never required here (Revision 5).
    if (exists(`${WORKFLOWS_DIR}/egress.yml`)) {
      expect(blockKeys(wf("egress.yml"), "on").sort()).toEqual([
        "pull_request",
        "workflow_dispatch",
      ]);
    }
  });
});
