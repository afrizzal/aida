import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the review C1 suite boundary (the egress suite runs only through `pnpm test:egress`,
 * never on the `pnpm test:integration` path) and the review R3-2 rule J path of the egress suite
 * (project name, preflight before any build, lock-gated exact-ref teardown, 20 GiB threshold).
 * Queue item J1 made those changes (K108, K111, K112, K113, K114, K121; see
 * .planning/run-loop/J1-RENCANA.md). Files are read as text only: no Docker, and no import of the
 * config modules or of the suite. A deliberate change to a guarded property (for example an
 * owner-approved change of the rule J threshold, or plan 08-14 moving these calls into a shared
 * harness) updates this guard in the same commit.
 */
const ROOT = path.resolve(__dirname, "../..");

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

const INTEGRATION_CONFIG = "vitest.integration.config.ts";
const EGRESS_CONFIG = "vitest.egress.config.ts";
const PACKAGE_JSON = "package.json";
const EGRESS_SUITE = "tests/integration/egress-isolation.test.ts";
const PREFLIGHT = "tests/support/docker-test-preflight.ts";

const EGRESS_FILE_LITERAL = '"tests/integration/egress-isolation.test.ts"';

function countOf(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

/** The first anchor that is missing or out of order in `region`, or null when all are in order. */
function inOrder(region: string, anchors: readonly string[]): string | null {
  let from = 0;
  for (const anchor of anchors) {
    const at = region.indexOf(anchor, from);
    if (at === -1) return anchor;
    from = at + anchor.length;
  }
  return null;
}

function integrationConfigProblems(text: string): string[] {
  const problems: string[] = [];
  if (!text.includes('include: ["tests/integration/**/*.test.ts"]')) {
    problems.push('C1: integration include is not exactly ["tests/integration/**/*.test.ts"]');
  }
  if (countOf(text, "include:") !== 1) {
    problems.push("C1: integration config has an include: other than the integration pattern");
  }
  const exclude =
    /exclude:\s*\[\s*\.\.\.configDefaults\.exclude\s*,[^\]]*"tests\/integration\/egress-isolation\.test\.ts"[^\]]*\]/;
  if (!exclude.test(text)) {
    problems.push(
      "C1, K113: integration exclude does not add the egress file to ...configDefaults.exclude",
    );
  }
  if (!text.includes('globalSetup: "./tests/integration/global-setup.ts"')) {
    problems.push("C1: integration globalSetup is not ./tests/integration/global-setup.ts");
  }
  return problems;
}

function egressConfigProblems(text: string): string[] {
  const include = /include:\s*\[([^\]]*)\]/.exec(text);
  if (!include) return ["C1: egress config has no include array"];
  if (!include[1].includes(EGRESS_FILE_LITERAL)) {
    return ["C1: egress config include does not contain the egress file"];
  }
  return [];
}

function scriptProblems(text: string): string[] {
  const problems: string[] = [];
  const scripts = (JSON.parse(text) as { scripts?: Record<string, string> }).scripts ?? {};
  if (scripts["test:integration"] !== "vitest run --config vitest.integration.config.ts") {
    problems.push("C1: test:integration no longer runs vitest.integration.config.ts");
  }
  if (scripts["test:egress"] !== "vitest run --config vitest.egress.config.ts") {
    problems.push("C1: test:egress no longer runs vitest.egress.config.ts");
  }
  return problems;
}

const BEFORE_ALL_ANCHORS = [
  "acquireLock(RUN_ID)",
  "assertComposeFollowsRuleJ(",
  "runBuildPreflight(",
  "buildStarted = true",
  'dc(["build"]',
  '"--no-build"',
] as const;

const AFTER_ALL_ANCHORS = [
  "if (!releaseLock) return;",
  "teardownRefs({",
  "planExact(",
  "applyCleanup(",
] as const;

const FORBIDDEN_LITERALS = ["--remove-orphans", '"--build"', "prune", "aida-egress-test"] as const;

function egressSuiteProblems(text: string): string[] {
  const problems: string[] = [];
  if (!text.includes('const COMPOSE_PROJECT = "aida-test-egress";')) {
    problems.push("R3-2, rule J: egress compose project is not exactly aida-test-egress");
  }
  if (!text.includes('["compose", "-p", COMPOSE_PROJECT, "-f", COMPOSE_FILE')) {
    problems.push("R3-2: compose wrapper no longer pins -p COMPOSE_PROJECT -f COMPOSE_FILE");
  }

  const beforeStart = text.indexOf("beforeAll(");
  const afterStart = text.indexOf("afterAll(");
  if (beforeStart === -1 || afterStart === -1 || afterStart < beforeStart) {
    problems.push("R3-2: egress suite has no beforeAll( followed by afterAll(");
  } else {
    const missing = inOrder(text.slice(beforeStart, afterStart), BEFORE_ALL_ANCHORS);
    if (missing) {
      problems.push(`R3-2, K111, K112: beforeAll anchor missing or out of order: ${missing}`);
    }
    const testStart = text.indexOf("test(", afterStart);
    const afterRegion = text.slice(afterStart, testStart === -1 ? text.length : testStart);
    const missingAfter = inOrder(afterRegion, AFTER_ALL_ANCHORS);
    if (missingAfter) {
      problems.push(
        `R3-2, K108, K114, K121: afterAll anchor missing or out of order: ${missingAfter}`,
      );
    }
  }

  if (/["']down["']/.test(text)) {
    problems.push("R3-2, K108: egress suite contains a quoted compose down argument");
  }
  for (const literal of FORBIDDEN_LITERALS) {
    if (text.includes(literal)) {
      problems.push(`R3-2, rule J: egress suite contains forbidden token ${literal}`);
    }
  }
  return problems;
}

function preflightProblems(text: string): string[] {
  const problems: string[] = [];
  if (!text.includes("export const MIN_FREE_BYTES = 20 * 1024 ** 3;")) {
    problems.push("K112, rule J: MIN_FREE_BYTES is not 20 * 1024 ** 3");
  }
  const start = text.indexOf("export function runBuildPreflight(");
  if (start === -1) {
    problems.push("K112: runBuildPreflight is not exported");
  } else {
    const region = text.slice(start);
    for (const call of ['assertEnoughSpace("the host"', 'assertEnoughSpace("the Docker VM"']) {
      if (!region.includes(call)) {
        problems.push(`K112, rule J: runBuildPreflight does not call ${call}`);
      }
    }
  }
  if (!text.includes("rule J requires before an image build. Stopped; report to the owner.")) {
    problems.push("K112: the rule J space stop message changed");
  }
  return problems;
}

describe("suite boundary (review C1, J1 K113)", () => {
  it("the integration config includes only integration tests and excludes the egress file", () => {
    expect(integrationConfigProblems(read(INTEGRATION_CONFIG))).toEqual([]);
  });

  it("the egress config includes the egress file", () => {
    expect(egressConfigProblems(read(EGRESS_CONFIG))).toEqual([]);
  });

  it("test:integration and test:egress point at their own configs", () => {
    expect(scriptProblems(read(PACKAGE_JSON))).toEqual([]);
  });
});

describe("egress suite rule J path (review R3-2)", () => {
  it("keeps the project, the beforeAll order, the lock-gated teardown and no forbidden token", () => {
    expect(egressSuiteProblems(read(EGRESS_SUITE))).toEqual([]);
  });

  it("keeps the 20 GiB threshold, both space checks and the stop message", () => {
    expect(preflightProblems(read(PREFLIGHT))).toEqual([]);
  });
});

interface MutationCase {
  name: string;
  file: string;
  from: string | RegExp;
  to: string;
  /** A second edit applied to the result of the first, for a move (M6). */
  second?: { from: string | RegExp; to: string };
  check: (text: string) => string[];
}

const MUTATIONS: MutationCase[] = [
  {
    name: "M1: integration exclude line removed",
    file: INTEGRATION_CONFIG,
    from: /^[ \t]*exclude:.*\r?\n/m,
    to: "",
    check: integrationConfigProblems,
  },
  {
    name: "M2: integration include broadened",
    file: INTEGRATION_CONFIG,
    from: '"tests/integration/**/*.test.ts"',
    to: '"tests/**/*.test.ts"',
    check: integrationConfigProblems,
  },
  {
    name: "M3: egress file dropped from the egress include",
    file: EGRESS_CONFIG,
    from: EGRESS_FILE_LITERAL,
    to: '"tests/container/**/*.test.ts"',
    check: egressConfigProblems,
  },
  {
    name: "M4: test:integration pointed at the egress config",
    file: PACKAGE_JSON,
    from: '"test:integration": "vitest run --config vitest.integration.config.ts"',
    to: '"test:integration": "vitest run --config vitest.egress.config.ts"',
    check: scriptProblems,
  },
  {
    name: "M5: egress project renamed back to the old name",
    file: EGRESS_SUITE,
    from: '"aida-test-egress";',
    to: '"aida-egress-test";',
    check: egressSuiteProblems,
  },
  {
    name: "M6: buildStarted set before the preflight",
    file: EGRESS_SUITE,
    from: "buildStarted = true;",
    to: "",
    second: { from: "runBuildPreflight(", to: "buildStarted = true;\n    runBuildPreflight(" },
    check: egressSuiteProblems,
  },
  {
    name: "M7: afterAll no longer returns without the lock",
    file: EGRESS_SUITE,
    from: "if (!releaseLock) return;",
    to: "",
    check: egressSuiteProblems,
  },
  {
    name: "M8: a project-wide compose down added to afterAll",
    file: EGRESS_SUITE,
    from: "if (!releaseLock) return;",
    to: 'if (!releaseLock) return;\n    dc(["down", "-v"]);',
    check: egressSuiteProblems,
  },
  {
    name: "M9: rule J threshold lowered to 10 GiB",
    file: PREFLIGHT,
    from: "20 * 1024 ** 3",
    to: "10 * 1024 ** 3",
    check: preflightProblems,
  },
  {
    name: "M10: the Docker VM space check dropped from runBuildPreflight",
    file: PREFLIGHT,
    from: 'assertEnoughSpace("the Docker VM"',
    to: 'void ("the Docker VM"',
    check: preflightProblems,
  },
];

describe("each check can fail", () => {
  it.each(MUTATIONS)("$name", ({ file, from, to, second, check }) => {
    const original = read(file);
    let mutated = original.replace(from, to);
    if (second) mutated = mutated.replace(second.from, second.to);
    expect(mutated).not.toEqual(original);
    expect(check(mutated).length).toBeGreaterThan(0);
  });
});
