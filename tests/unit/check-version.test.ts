// Unit tests for scripts/check-version.mjs and .github/workflows/check-version.yml
// (Phase 9 plan 09-03, U-05, U-06, U-18, AIDA-40). The pure functions are checked over the
// U-18 cases and SemVer 2.0.0 precedence; two CLI runs use temporary files; the workflow is
// checked as text against charter rule I (ubuntu-latest only, no scheduled trigger, only
// pull_request, push to master and workflow_dispatch). No Docker, no network.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  compareSemver,
  evaluateVersions,
  main,
  parseSemver,
  shown,
} from "../../scripts/check-version.mjs";

const ROOT = path.resolve(__dirname, "../..");
const WORKFLOW = path.join(ROOT, ".github/workflows/check-version.yml");

const file = (version?: unknown) =>
  ({
    kind: "file",
    json: version === undefined ? { name: "aida" } : { name: "aida", version },
  }) as const;
const head = (version?: unknown) =>
  version === undefined ? { name: "aida" } : { name: "aida", version };

function annotation(line: string): string {
  return line.split("::")[1] ?? "plain";
}

describe("evaluateVersions (U-18)", () => {
  it("fails with ::error:: when the head package.json has no version", () => {
    const result = evaluateVersions({ head: head(), base: file("1.0.0") });
    expect(result.exitCode).toBe(1);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatch(/^::error::package\.json has no "version" field/);
  });

  it("fails with ::error:: when the head version is not SemVer", () => {
    const result = evaluateVersions({ head: head("1.0"), base: file("1.0.0") });
    expect(result.exitCode).toBe(1);
    expect(result.lines[0]).toMatch(/^::error::package\.json version "1\.0" is not a valid SemVer/);
  });

  it("fails when the head version is not a string", () => {
    expect(evaluateVersions({ head: head(1), base: file("1.0.0") }).exitCode).toBe(1);
    expect(evaluateVersions({ head: head(null), base: file("1.0.0") }).exitCode).toBe(1);
    expect(evaluateVersions({ head: [], base: file("1.0.0") }).exitCode).toBe(1);
  });

  it("passes with ::notice:: when the base package.json has no version (the PR that adds 1.0.0)", () => {
    const result = evaluateVersions({ head: head("1.0.0"), base: file() });
    expect(result.exitCode).toBe(0);
    expect(result.lines[0]).toMatch(/^::notice::The base package\.json has no "version" field/);
  });

  it("passes with ::notice:: when the base commit has no package.json", () => {
    const result = evaluateVersions({ head: head("1.0.0"), base: { kind: "no-file" } });
    expect(result.exitCode).toBe(0);
    expect(result.lines[0]).toMatch(/^::notice::The base commit has no package\.json/);
  });

  it("passes with a ::notice:: naming the owner decision when head equals base", () => {
    const result = evaluateVersions({ head: head("1.0.0"), base: file("1.0.0") });
    expect(result.exitCode).toBe(0);
    expect(result.lines).toHaveLength(1);
    expect(annotation(result.lines[0])).toBe("notice");
    expect(result.lines[0]).toContain("unchanged");
    expect(result.lines[0]).toContain("owner decision");
  });

  it("passes without an annotation when head is one patch above base", () => {
    const result = evaluateVersions({ head: head("1.0.1"), base: file("1.0.0") });
    expect(result.exitCode).toBe(0);
    expect(result.lines.join("\n")).not.toMatch(/::(error|warning|notice)::/);
  });

  it("fails with ::error:: when head is one patch below base", () => {
    const result = evaluateVersions({ head: head("1.0.0"), base: file("1.0.1") });
    expect(result.exitCode).toBe(1);
    expect(result.lines[0]).toMatch(/^::error::.*is lower than the base version "1\.0\.1"/);
  });

  it("compares components numerically: 1.10.0 is above 1.9.0", () => {
    expect(evaluateVersions({ head: head("1.10.0"), base: file("1.9.0") }).exitCode).toBe(0);
    expect(evaluateVersions({ head: head("1.9.0"), base: file("1.10.0") }).exitCode).toBe(1);
  });

  it("ranks a pre-release below its release: 1.0.0-rc.1 after 1.0.0 fails", () => {
    expect(evaluateVersions({ head: head("1.0.0-rc.1"), base: file("1.0.0") }).exitCode).toBe(1);
    expect(evaluateVersions({ head: head("1.0.0"), base: file("1.0.0-rc.1") }).exitCode).toBe(0);
  });

  it("fails with ::error:: when the base version is invalid", () => {
    const result = evaluateVersions({ head: head("1.0.0"), base: file("01.0.0") });
    expect(result.exitCode).toBe(1);
    expect(result.lines[0]).toMatch(
      /^::error::The base package\.json version "01\.0\.0" is not a valid SemVer/,
    );
  });

  it("no-base validates the head only and names the reason in a ::notice::", () => {
    const ok = evaluateVersions({
      head: head("1.0.0"),
      base: { kind: "no-base", reason: "manual run" },
    });
    expect(ok.exitCode).toBe(0);
    expect(ok.lines[0]).toMatch(/^::notice::No base to compare \("manual run"\)/);
    const bad = evaluateVersions({
      head: head("one"),
      base: { kind: "no-base", reason: "new branch" },
    });
    expect(bad.exitCode).toBe(1);
    expect(annotation(bad.lines[0])).toBe("error");
  });

  it("cannot be turned into a second workflow command by an untrusted version string", () => {
    const hostile = "1.0.0\n::add-mask::x%0A";
    const result = evaluateVersions({ head: head(hostile), base: file("1.0.0") });
    expect(result.exitCode).toBe(1);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).not.toMatch(/[\r\n]/);
    expect(result.lines[0]).not.toContain("%0A::");
    expect(shown("a\r\nb%")).toBe('"a\\r\\nb%25"');
  });
});

describe("parseSemver and compareSemver (SemVer 2.0.0)", () => {
  it("parses core, pre-release and build metadata", () => {
    expect(parseSemver("1.2.3-alpha.1+build.5")).toMatchObject({
      major: 1n,
      minor: 2n,
      patch: 3n,
      prerelease: ["alpha", "1"],
      build: ["build", "5"],
    });
  });

  it("rejects leading zeros, a leading v, whitespace and partial versions", () => {
    for (const bad of [
      "01.0.0",
      "1.01.0",
      "1.0.01",
      "1.0.0-01",
      "v1.0.0",
      " 1.0.0",
      "1.0.0 ",
      "1.0",
      "1",
      "",
      "1.0.0-",
      "1.0.0+",
      "1.0.0-a..b",
    ]) {
      expect(parseSemver(bad), bad).toBeNull();
    }
    expect(parseSemver("1.0.0-0")).not.toBeNull();
    expect(parseSemver("1.0.0-0a")).not.toBeNull(); // alphanumeric id may start with a zero
  });

  it("ignores build metadata for precedence", () => {
    expect(compareSemver("1.0.0+build.1", "1.0.0+build.2")).toBe(0);
    expect(compareSemver("1.0.0+zzz", "1.0.0")).toBe(0);
    expect(evaluateVersions({ head: head("1.0.0+sha.abc"), base: file("1.0.0") }).exitCode).toBe(0);
  });

  it("ranks a numeric identifier below an alphanumeric one: 1.0.0-alpha.1 < 1.0.0-alpha.beta", () => {
    expect(compareSemver("1.0.0-alpha.1", "1.0.0-alpha.beta")).toBe(-1);
    expect(compareSemver("1.0.0-alpha.beta", "1.0.0-alpha.1")).toBe(1);
  });

  it("ranks a longer identifier set higher: 1.0.0-alpha < 1.0.0-alpha.1", () => {
    expect(compareSemver("1.0.0-alpha", "1.0.0-alpha.1")).toBe(-1);
  });

  it("compares numeric pre-release identifiers numerically: rc.2 < rc.11", () => {
    expect(compareSemver("1.0.0-rc.2", "1.0.0-rc.11")).toBe(-1);
  });

  it("orders the SemVer 2.0.0 specification example chain", () => {
    const chain = [
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-beta",
      "1.0.0-beta.2",
      "1.0.0-beta.11",
      "1.0.0-rc.1",
      "1.0.0",
      "1.9.0",
      "1.10.0",
      "1.11.0",
      "2.0.0",
    ];
    for (let i = 0; i + 1 < chain.length; i++) {
      expect(compareSemver(chain[i], chain[i + 1]), `${chain[i]} < ${chain[i + 1]}`).toBe(-1);
      expect(compareSemver(chain[i + 1], chain[i])).toBe(1);
    }
  });

  it("handles components beyond the safe integer range", () => {
    expect(compareSemver("9007199254740993.0.0", "9007199254740992.0.0")).toBe(1);
  });

  it("throws on an invalid version string", () => {
    expect(() => compareSemver("1.0", "1.0.0")).toThrow(TypeError);
  });
});

describe("check-version CLI", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  function tempJson(json: unknown): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "check-version-"));
    dirs.push(dir);
    const target = path.join(dir, "package.json");
    fs.writeFileSync(target, JSON.stringify(json));
    return target;
  }

  function run(args: string[]): { status: number; stdout: string } {
    try {
      const stdout = execFileSync(process.execPath, ["scripts/check-version.mjs", ...args], {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { status: 0, stdout };
    } catch (err) {
      const e = err as { status: number; stdout: string };
      return { status: e.status, stdout: e.stdout };
    }
  }

  it("the repository package.json carries version 1.0.0 (U-05)", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    expect(pkg.version).toBe("1.0.0");
  });

  it("the repository package.json against a base holding 0.9.0 exits 0", () => {
    const base = tempJson({ name: "aida", version: "0.9.0" });
    const result = run(["--head", "package.json", "--base", base]);
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("::error::");
  });

  it("a head holding 0.9.0 against the repository package.json exits 1", () => {
    const headFile = tempJson({ name: "aida", version: "0.9.0" });
    const result = run(["--head", headFile, "--base", "package.json"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/^::error::.*lower than the base version "1\.0\.0"/m);
  });

  it("an unreadable or unparseable base file fails loudly", () => {
    const lines: string[] = [];
    const io = { out: (line: string) => lines.push(line) };
    expect(
      main(
        ["--head", "package.json", "--base", path.join(os.tmpdir(), "no-such-dir-cv", "x.json")],
        io,
      ),
    ).toBe(1);
    expect(lines[0]).toMatch(/^::error::Cannot read the base package\.json file/);
    const broken = tempJson({});
    fs.writeFileSync(broken, "{ not json");
    lines.length = 0;
    expect(main(["--head", "package.json", "--base", broken], io)).toBe(1);
    expect(lines[0]).toMatch(/^::error::The base package\.json file .* is not valid JSON/);
  });

  it("requires --head and exactly one base form", () => {
    const io = { out: () => {} };
    expect(main([], io)).toBe(2);
    expect(main(["--head", "package.json"], io)).toBe(2);
    expect(main(["--head", "package.json", "--base-without-file", "--no-base", "x"], io)).toBe(2);
    expect(main(["--head", "package.json", "--base"], io)).toBe(2);
    expect(main(["--head", "package.json", "--base-without-file"], io)).toBe(0);
  });
});

describe("check-version.yml (charter rule I, U-06)", () => {
  const text = fs.readFileSync(WORKFLOW, "utf8");
  const lines = text.split(/\r?\n/);
  const code = lines.filter((line) => !/^\s*#/.test(line));
  const codeText = code.join("\n");

  function block(name: string, indent: number): string[] {
    const start = code.indexOf(`${" ".repeat(indent)}${name}:`);
    if (start === -1) return [];
    const rest = code.slice(start + 1);
    const end = rest.findIndex(
      (line) => line.trim() !== "" && line.length - line.trimStart().length <= indent,
    );
    return end === -1 ? rest : rest.slice(0, end);
  }

  it("runs every job on ubuntu-latest only", () => {
    const runsOn = [...codeText.matchAll(/^\s*runs-on:\s*(.*)$/gm)].map((m) => m[1].trim());
    expect(runsOn.length).toBeGreaterThan(0);
    expect(new Set(runsOn)).toEqual(new Set(["ubuntu-latest"]));
  });

  it("has no scheduled trigger and no privileged pull request trigger", () => {
    expect(codeText).not.toMatch(/^\s*schedule\s*:/m);
    expect(codeText).not.toMatch(/cron/);
    expect(codeText).not.toContain("pull_request_target");
  });

  it("triggers only on pull_request, push to master and workflow_dispatch", () => {
    const on = block("on", 0);
    const keys = on
      .filter((line) => /^ {2}[a-z_]+:/.test(line))
      .map((line) => line.trim().replace(/:.*$/, ""));
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(["pull_request", "push", "workflow_dispatch"]).toContain(key);
    const push = block("push", 2).filter((line) => line.trim() !== "");
    expect(push).toEqual(["    branches: [master]"]);
  });

  it("asks for a read-only token", () => {
    const permissions = block("permissions", 0).filter((line) => line.trim() !== "");
    expect(permissions).toEqual(["  contents: read"]);
  });

  it("passes the base sha to the shell only through env, never as script text", () => {
    const uses = codeText.match(/github\.event\.pull_request\.base\.sha/g) ?? [];
    expect(uses).toHaveLength(1);
    expect(codeText).toMatch(
      /^ {10}PR_BASE_SHA: \$\{\{ github\.event\.pull_request\.base\.sha \}\}$/m,
    );
    expect(codeText).toMatch(/^ {10}PUSH_BEFORE: \$\{\{ github\.event\.before \}\}$/m);
    const runStart = code.findIndex((line) => /^ {8}run: \|$/.test(line));
    expect(runStart).toBeGreaterThan(-1);
    const script = code.slice(runStart + 1).join("\n");
    expect(script).not.toContain("${{");
    expect(script).toContain('check_against "$PR_BASE_SHA"');
  });

  it("uses the same pinned actions as audit.yml and needs no install step", () => {
    const audit = fs.readFileSync(path.join(ROOT, ".github/workflows/audit.yml"), "utf8");
    for (const action of ["actions/checkout@v5", "actions/setup-node@v5"]) {
      expect(audit).toContain(action);
      expect(codeText).toContain(action);
    }
    const uses = [...codeText.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
    expect(uses).toEqual(["actions/checkout@v5", "actions/setup-node@v5"]);
    expect(codeText).not.toMatch(/pnpm|npm (ci|install)/);
    expect(codeText).toContain("fetch-depth: 0");
  });
});
