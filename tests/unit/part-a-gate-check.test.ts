// Unit tests for scripts/part-a-gate-check.ts, the Part A gate verifier of the Phase 8 split
// (plan 08-24). Literal derivation cases L1 to L16 and single-edit mutations M1 to M22 that
// `check` must reject. Space lines are always produced by J1's assertEnoughSpace, never retyped.
// No test spawns a process, touches Docker or writes outside its own temp directory.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import * as pureVerify from "../../scripts/image-check-verify";
import { verifyImageCheckLog } from "../../scripts/image-check-verify";
import {
  checkGate,
  classifyEgress,
  deriveGate,
  fileWord,
  imageWordExit,
  main,
  quote,
  SPEC,
  splitRow,
  WORDS,
  worstOf,
} from "../../scripts/part-a-gate-check";
import * as imageCheck from "../../scripts/test-image-check";
import { type CheckState, EXIT_CODES, summaryWord } from "../../scripts/test-image-check";
import { assertEnoughSpace } from "../support/docker-test-preflight";

const RUN = "mwc6vmbv-8de59ebf3cc1c67e";
const SHA = "0123456789abcdef0123456789abcdef01234567";
const GIB = 1024 ** 3;

function spaceLine(where = "the Docker VM", gib = 13.9): string {
  try {
    assertEnoughSpace(where, gib * GIB);
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error("assertEnoughSpace did not throw");
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

type Assertion = "passed" | "failed" | "skipped";
interface VFile {
  path: string;
  asserts: Assertion[];
  message?: string;
  status?: "passed" | "failed";
}

function vitestJson(files: VFile[]): string {
  const all = files.flatMap((f) => f.asserts);
  return JSON.stringify({
    numTotalTests: all.length,
    numPassedTests: all.filter((s) => s === "passed").length,
    numFailedTests: all.filter((s) => s === "failed").length,
    numPendingTests: all.filter((s) => s === "skipped").length,
    success: !all.includes("failed"),
    testResults: files.map((f) => ({
      name: `/repo/${f.path}`,
      status: f.status ?? (f.asserts.includes("failed") || !f.asserts.length ? "failed" : "passed"),
      message: f.message ?? "",
      assertionResults: f.asserts.map((s, i) => ({ title: `t${i}`, fullName: `t${i}`, status: s })),
    })),
  });
}

function e2eJson(specs: { file: string; ok: boolean; status: string }[]): string {
  return JSON.stringify({
    suites: [
      {
        title: "root",
        file: "",
        specs: [],
        suites: specs.map((s, i) => ({
          title: s.file,
          file: s.file,
          specs: [{ title: `s${i}`, file: s.file, ok: s.ok, tests: [{ status: s.status }] }],
        })),
      },
    ],
    stats: {
      expected: specs.filter((s) => s.status === "expected").length,
      unexpected: specs.filter((s) => s.status === "unexpected").length,
      skipped: specs.filter((s) => s.status === "skipped").length,
      flaky: 0,
    },
  });
}

const UNIT_FILES = SPEC.rows
  .flatMap((r) => r.partA)
  .filter((s) => s.startsWith("pnpm test :: "))
  .map((s) => s.split(" :: ")[1])
  .concat("tests/unit/design-tokens.test.ts", "tests/unit/part-a-gate-check.test.ts")
  .filter((p, i, a) => a.indexOf(p) === i);
const INTEGRATION_FILES = SPEC.rows
  .flatMap((r) => r.partA)
  .filter((s) => s.startsWith("pnpm test:integration :: "))
  .map((s) => s.split(" :: ")[1])
  .filter((p, i, a) => a.indexOf(p) === i);

interface Fixture {
  dirty?: string;
  colimaExit?: number;
  auditHighExit?: number;
  auditHighLog?: string;
  testFiles?: VFile[];
  testExit?: number;
  e2eSpecs?: { file: string; ok: boolean; status: string }[];
  egressExit?: number;
  egressFiles?: VFile[];
  egressLog?: string;
  imageVerify?: string | ((target: string) => string);
  imageVerifyExit?: number;
  imageLog?: string | ((target: string) => string);
  imageExit?: number;
  cleanupLog?: string;
  /** The after listing of the aida-dev-db container (K134 capture shape). */
  foreignAfter?: string;
  /** K134: per-file overrides of the foreign listings; `null` leaves the file out. */
  foreign?: Record<string, string | null>;
  patch?: string;
  opsVolumeLog?: string;
  skip?: string[];
}

const EGRESS = "tests/integration/egress-isolation.test.ts";

/** K134: the evidence row says what it measures, not "foreign resources unchanged". */
const FOREIGN_ROW = "listed containers, and the volumes of project `aida`, unchanged";

/** The two lines test-image-check.ts prints, in its own JSON shape (c-CR-02). */
function imageLog(
  t: string,
  over: { state?: string; cause?: string; evidence?: string; runId?: string; tag?: string } = {},
): string {
  const runId = over.runId ?? RUN;
  const teardown = {
    created: false,
    removed: [],
    gone: [],
    skipped: [],
    notOurs: [],
    leftAlone: [],
    failed: [],
    remaining: [],
    runId,
  };
  const result = {
    target: t,
    tag: over.tag ?? `aida-test-nonroot-${t}:${runId}`,
    runId,
    state: over.state ?? "blocked",
    cause: over.cause ?? "space",
    evidence: over.evidence ?? spaceLine(),
    imageId: null,
    user: null,
    env: [],
    labels: {},
    baseImageBefore: "sha256:base",
    baseImageAfter: null,
    runDir: "/tmp/aida-image-check-x",
  };
  return `IMAGE-CHECK-TEARDOWN ${JSON.stringify(teardown)}\nIMAGE-CHECK-RESULT ${JSON.stringify(result)}\n`;
}

/**
 * K133: an image log that test-image-check.ts --verify itself accepts as passed (user node, both
 * telemetry variables, an image ID, the run labels, its own tag removed, the base image unmoved).
 * `mutate` edits the parsed result and teardown lines; `dropTeardown` leaves the teardown line out.
 */
function passingImageLog(
  t: string,
  mutate?: (r: Record<string, unknown>, td: Record<string, unknown>) => void,
  { dropTeardown = false }: { dropTeardown?: boolean } = {},
): string {
  const tag = `aida-test-nonroot-${t}:${RUN}`;
  const teardown: Record<string, unknown> = {
    created: true,
    removed: [tag],
    gone: [],
    skipped: [],
    notOurs: [],
    leftAlone: [],
    failed: [],
    remaining: [],
    runId: RUN,
  };
  const result: Record<string, unknown> = {
    target: t,
    tag,
    runId: RUN,
    state: "passed",
    cause: "none",
    evidence: "",
    imageId: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
    user: "node",
    env: ["PATH=/usr/local/bin", "NEXT_TELEMETRY_DISABLED=1", "CHECKPOINT_DISABLE=1"],
    labels: { "aida.test": "1", "aida.test.run": RUN },
    baseImageBefore: "sha256:base",
    baseImageAfter: "sha256:base",
    runDir: "/tmp/aida-image-check-x",
  };
  mutate?.(result, teardown);
  const td = dropTeardown ? "" : `IMAGE-CHECK-TEARDOWN ${JSON.stringify(teardown)}\n`;
  return `${td}IMAGE-CHECK-RESULT ${JSON.stringify(result)}\n`;
}

function verifyLine(t: string, state: string, cause: string, word: string, extra = ""): string {
  return `IMAGE-CHECK-VERIFY state=${state} cause=${cause} word="${word}" target=${t} tag=aida-test-nonroot-${t}:${RUN}${extra}\n`;
}

/** A consistent passed image check for both targets; `exit` is what image-<t>.exit records. */
const passedImages = (exit: number): Fixture => ({
  imageExit: exit,
  imageLog: (t) => passingImageLog(t),
  imageVerify: (t) => verifyLine(t, "passed", "none", "passed"),
});

/** The three read-only listings of 08-24's foreign-before/after step, as `docker ... table` prints them. */
const FOREIGN_LISTINGS = ["project-containers", "dev-db-container", "project-volumes"] as const;
const FOREIGN_DEFAULT: Record<(typeof FOREIGN_LISTINGS)[number], string> = {
  "project-containers": "CONTAINER ID   NAMES     STATE\n",
  "dev-db-container": "CONTAINER ID   NAMES         STATE\n0123456789ab   aida-dev-db   running\n",
  "project-volumes": "VOLUME NAME\naida_pgdata\naida_uploads_data\n",
};

/**
 * Writes foreign-<when>-<listing>.txt and .exit (K134). It also writes the old capture's
 * foreign-<when>.txt (the listings concatenated, without exit codes), which the old verifier
 * compared byte for byte; the K134 verifier must not read them.
 */
function writeForeign(w: (name: string, body: string) => void, f: Fixture) {
  const legacy: Record<string, string> = { before: "", after: "" };
  for (const when of ["before", "after"]) {
    for (const l of FOREIGN_LISTINGS) {
      const name = `foreign-${when}-${l}`;
      let text = FOREIGN_DEFAULT[l];
      if (when === "after" && l === "dev-db-container" && f.foreignAfter !== undefined)
        text = f.foreignAfter;
      const over = f.foreign?.[`${name}.txt`];
      if (over !== undefined) text = over ?? "";
      if (over !== null) w(`${name}.txt`, text);
      const exitOver = f.foreign?.[`${name}.exit`];
      if (exitOver !== null) w(`${name}.exit`, exitOver ?? "0\n");
      legacy[when] += text;
    }
  }
  w("foreign-before.txt", legacy.before);
  w("foreign-after.txt", legacy.after);
}

function makeDir(f: Fixture = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aida-gate-a-test-"));
  dirs.push(dir);
  const w = (name: string, body: string) => {
    if (!f.skip?.includes(name)) fs.writeFileSync(path.join(dir, name), body);
  };
  const cmd = (slug: string, exit: number, log: string) => {
    w(`${slug}.log`, log);
    w(`${slug}.exit`, `${exit}\n`);
  };
  w("head.txt", `${SHA}\n`);
  w("date.txt", "2026-11-11\n");
  w("run-id.txt", `${RUN}\n`);
  w("tree-state.txt", f.dirty ?? "");
  cmd("lint", 0, "Checked 400 files. No fixes applied.\n");
  cmd("typecheck", 0, "> tsc --noEmit\n");
  cmd("test", f.testExit ?? 0, "Test Files  70 passed (70)\n");
  w(
    "test.json",
    vitestJson(f.testFiles ?? UNIT_FILES.map((p) => ({ path: p, asserts: ["passed", "passed"] }))),
  );
  cmd("build", 0, "Compiled successfully\n");
  cmd("audit", 1, "10 vulnerabilities found\nSeverity: 3 moderate | 10 high\n");
  cmd("audit-high", f.auditHighExit ?? 1, f.auditHighLog ?? "10 vulnerabilities found\n");
  cmd("ops-volume", 0, f.opsVolumeLog ?? "volume upgrade procedure documented\n");
  cmd("ops-client-ip", 0, "client IP constraint documented\n");
  cmd("sla-flag-comment", 0, "sla-flag raw SQL comment present\n");
  w("part-a-src.patch", f.patch ?? "+++ b/src/app/layout.tsx\n+const x = 1;\n");
  cmd("docker-health.colima", f.colimaExit ?? 0, "colima is running\n");
  cmd("docker-health.info", 0, "Server Version: 28\n");
  writeForeign(w, f);
  cmd("integration", 0, "Test Files  94 passed\n");
  w(
    "integration.json",
    vitestJson(INTEGRATION_FILES.map((p) => ({ path: p, asserts: ["passed"] }))),
  );
  cmd("e2e", 0, "209 passed\n");
  w("e2e.json", e2eJson(f.e2eSpecs ?? [{ file: "csp.spec.ts", ok: true, status: "expected" }]));
  cmd(
    "egress",
    f.egressExit ?? 1,
    f.egressLog ?? `FAIL ${EGRESS}\nDockerPreflightError: ${spaceLine()}\n`,
  );
  w(
    "egress.json",
    vitestJson(
      f.egressFiles ?? [{ path: EGRESS, asserts: ["skipped", "skipped", "skipped", "skipped"] }],
    ),
  );
  const pick = (v: string | ((target: string) => string) | undefined, t: string, d: string) =>
    v === undefined ? d : typeof v === "function" ? v(t) : v;
  for (const t of ["runner", "builder"]) {
    cmd(`image-${t}`, f.imageExit ?? 3, pick(f.imageLog, t, imageLog(t)));
    cmd(
      `image-${t}-verify`,
      f.imageVerifyExit ?? 0,
      pick(f.imageVerify, t, verifyLine(t, "blocked", "space", "blocked (space)")),
    );
  }
  cmd(
    "cleanup",
    0,
    f.cleanupLog ??
      `> tsx scripts/test-docker-cleanup.ts\n0 resource(s) of run ${RUN}; dry run, nothing removed.\n`,
  );
  return dir;
}

type Model = ReturnType<typeof deriveGate>["model"];
const result = (m: Model, key: string) => {
  const r = m.results.find((x) => x.key === key);
  if (!r) throw new Error(`no results row ${key}`);
  return r;
};
const evidence = (m: Model, key: string) => {
  const r = m.evidence.find((x) => x.key === key);
  if (!r) throw new Error(`no evidence row ${key}`);
  return r;
};
const matrix = (m: Model, n: number) => m.matrix[n - 1];
const requirement = (m: Model, id: string) => {
  const r = m.requirements.find((x) => x.requirement === id);
  if (!r) throw new Error(`no requirement ${id}`);
  return r;
};
const derive = (f?: Fixture) => deriveGate(makeDir(f));

describe("part-a-gate-check: literal derivation cases", () => {
  it("J: L1 the 0a2 worked case is blocked (space) with J1's space line quoted", () => {
    const { model } = derive();
    const r = result(model, "pnpm test:egress");
    expect(r.word).toBe("blocked (space)");
    expect(r.exit).toBe("1");
    expect(r.note).toContain(`"${spaceLine()}"`);
    expect(r.note).toContain(`file=${EGRESS} passed=0 failed=0 other=4 word=blocked (space)`);
  });

  it("R4-2: L2 a space stop next to a failed assertion in another file is failed", () => {
    const { model } = derive({
      egressFiles: [
        { path: EGRESS, asserts: ["skipped", "skipped", "skipped", "skipped"] },
        { path: "tests/integration/other.test.ts", asserts: ["failed"] },
      ],
      egressLog: `DockerPreflightError: ${spaceLine()}\nAssertionError: expected 200 to be 429\n`,
    });
    expect(result(model, "pnpm test:egress").word).toBe("failed");
  });

  it("R4-2: L3 a J1 lock stop in a second file makes the egress row failed", () => {
    const { model } = derive({
      egressFiles: [
        { path: EGRESS, asserts: ["skipped", "skipped", "skipped", "skipped"] },
        { path: "tests/integration/other.test.ts", asserts: ["skipped"] },
      ],
      egressLog: `DockerPreflightError: ${spaceLine()}\nDockerPreflightError: Another rule J test run holds the lock\n`,
    });
    expect(result(model, "pnpm test:egress").word).toBe("failed");
  });

  it("R4-2: L4 a passed second file keeps blocked (space), with both files' counts", () => {
    const { model } = derive({
      egressFiles: [
        { path: EGRESS, asserts: ["skipped", "skipped", "skipped", "skipped"] },
        { path: "tests/integration/other.test.ts", asserts: ["passed", "passed"] },
      ],
    });
    const r = result(model, "pnpm test:egress");
    expect(r.word).toBe("blocked (space)");
    expect(r.note).toContain(`file=${EGRESS} passed=0 failed=0 other=4 word=blocked (space)`);
    expect(r.note).toContain(
      "file=tests/integration/other.test.ts passed=2 failed=0 other=0 word=passed",
    );
  });

  it("J: L5 a space line with exit 0 is failed", () => {
    expect(result(derive({ egressExit: 0 }).model, "pnpm test:egress").word).toBe("failed");
  });

  it("J: L6 a missing, broken, empty or egress-less result is failed, never a derive stop", () => {
    const space = `DockerPreflightError: ${spaceLine()}`;
    const cases: string[] = ["{not json", JSON.stringify({ testResults: [] })];
    cases.push(vitestJson([{ path: "tests/integration/other.test.ts", asserts: ["skipped"] }]));
    expect(classifyEgress(1, null, space).word).toBe("failed");
    for (const raw of cases) expect(classifyEgress(1, raw, space).word).toBe("failed");
    const res = deriveGate(makeDir({ skip: ["egress.json"] }));
    expect(res.missing).toEqual([]);
    expect(result(res.model, "pnpm test:egress").word).toBe("failed");
  });

  it("J: L7 an image check is blocked (space) only with verify exit 0 and the space line", () => {
    const m = derive().model;
    expect(result(m, "image check runner").word).toBe("blocked (space)");
    expect(result(m, "image check builder").note).toContain(spaceLine());
    expect(result(derive({ imageVerifyExit: 1 }).model, "image check runner").word).toBe("failed");
    const refused = "IMAGE-CHECK-VERIFY FAILED: no IMAGE-CHECK-RESULT line\n";
    expect(result(derive({ imageVerify: refused }).model, "image check runner").word).toBe(
      "failed",
    );
    expect(
      result(derive({ imageLog: "IMAGE-CHECK-RESULT {}\n" }).model, "image check builder").word,
    ).toBe("failed");
  });

  it("c-CR-02: L7a a consistent passed image check with exit 0 is passed", () => {
    expect(result(derive(passedImages(0)).model, "image check runner").word).toBe("passed");
  });

  it("c-CR-02: L7b exit 1 next to a verify log saying passed is failed, and check fails", () => {
    const dir = makeDir(passedImages(1));
    const res = deriveGate(dir);
    const r = result(res.model, "image check runner");
    expect(r.exit).toBe("1");
    expect(r.word).toBe("failed");
    expect(r.note).toContain("exit 1 disagrees with passed (expects 0)");
    // The gate as the old verifier derived it: exit 1, Result passed.
    const file = path.join(dir, "gate.md");
    fs.writeFileSync(file, `${res.text}\n## Notes\n\n- free text\n`);
    const text = editCell(fs.readFileSync(file, "utf8"), R, "image check runner", 2, "passed");
    expectRejected(file, text, "results", "image check runner");
  });

  it("c-CR-02: L7c only exit 3 backs blocked, only exit 4 backs not run", () => {
    expect(result(derive({ imageExit: 0 }).model, "image check runner").word).toBe("failed");
    expect(result(derive({ imageExit: 1 }).model, "image check runner").word).toBe("failed");
    expect(result(derive({ imageExit: 4 }).model, "image check runner").word).toBe("failed");
    const lock = (exit: number): Fixture => ({
      imageExit: exit,
      imageLog: (t) => imageLog(t, { state: "not run", cause: "lock", evidence: "Lock x is held" }),
      imageVerify: (t) => verifyLine(t, "not run", "lock", "not run (parked: lock)"),
    });
    expect(result(derive(lock(4)).model, "image check runner").word).toBe("not run (parked: lock)");
    expect(result(derive(lock(3)).model, "image check runner").word).toBe("failed");
  });

  it("c-CR-02: L7d the image log's own result line must agree with the verify line", () => {
    const fx = passedImages(0);
    fx.imageLog = (t) => imageLog(t, { state: "blocked", cause: "space" });
    const r = result(derive(fx).model, "image check runner");
    expect(r.word).toBe("failed");
    expect(r.note).toContain("IMAGE-CHECK-RESULT says blocked (space), verify says passed");
  });

  it("c-CR-02: L7e a result line of another run, or a verify tag of another run, is failed", () => {
    const other = "mwc6vmbv-0000000000000000";
    const fx = passedImages(0);
    fx.imageLog = (t) =>
      imageLog(t, { state: "passed", cause: "none", evidence: "", runId: other });
    expect(result(derive(fx).model, "image check runner").word).toBe("failed");
    const fy = passedImages(0);
    fy.imageVerify = (t) =>
      verifyLine(t, "passed", "none", "passed").replace(`:${RUN}`, `:${other}`);
    const r = result(derive(fy).model, "image check runner");
    expect(r.word).toBe("failed");
    expect(r.note).toContain(`expects tag aida-test-nonroot-runner:${RUN}`);
  });

  it("c-CR-02: L7f two result lines, none, or an unreadable one is failed", () => {
    const fx = passedImages(0);
    const one = (t: string) => imageLog(t, { state: "passed", cause: "none", evidence: "" });
    fx.imageLog = (t) => `${one(t)}${one(t).split("\n")[1]}\n`;
    expect(result(derive(fx).model, "image check runner").word).toBe("failed");
    expect(
      result(derive({ ...passedImages(0), imageLog: "" }).model, "image check runner").word,
    ).toBe("failed");
    expect(
      result(
        derive({ ...passedImages(0), imageLog: "IMAGE-CHECK-RESULT {not json\n" }).model,
        "image check runner",
      ).word,
    ).toBe("failed");
  });

  it("c-CR-02: L7g an exit echoed on the verify line must match the image exit file", () => {
    const fx = passedImages(0);
    fx.imageVerify = (t) => verifyLine(t, "passed", "none", "passed", " exit=1");
    expect(result(derive(fx).model, "image check runner").word).toBe("failed");
    fx.imageVerify = (t) => verifyLine(t, "passed", "none", "passed", " exit=0");
    expect(result(derive(fx).model, "image check runner").word).toBe("passed");
  });

  it("K133: the gate re-runs the image check's own --verify validation over the image log and exit file", () => {
    // The verify log still says passed; the image log underneath it does not back that.
    const fx = passedImages(0);
    fx.imageLog = (t) =>
      passingImageLog(t, (r) => {
        r.user = "root";
      });
    const r = result(derive(fx).model, "image check runner");
    expect(r.word).toBe("failed");
    expect(r.note).toContain('passed with user "root"');
    expect(verifyImageCheckLog(passingImageLog("runner"), 0, "runner").ok).toBe(true);
  });

  it("c-CR-02: the gate's word-to-exit table matches the image check's own exit codes", () => {
    const cases: [CheckState, string][] = [
      ["passed", "none"],
      ["blocked", "space"],
      ["blocked", "measure"],
      ["blocked", "docker"],
      ["blocked", "external"],
      ["not run", "lock"],
      ["not run", "foreign"],
    ];
    for (const [state, cause] of cases)
      expect(imageWordExit(summaryWord(state, cause))).toBe(EXIT_CODES[state]);
    expect(imageWordExit("failed")).toBeNull();
  });

  it("J: L8 the cleanup dry run is passed only with 0 resources of the gate's run id", () => {
    expect(result(derive().model, "pnpm test:docker-cleanup --run").word).toBe("passed");
    const two = `2 resource(s) of run ${RUN}; dry run, nothing removed.\n`;
    expect(result(derive({ cleanupLog: two }).model, "pnpm test:docker-cleanup --run").word).toBe(
      "failed",
    );
    const other = "0 resource(s) of run zzzz-0000000000000000; dry run, nothing removed.\n";
    expect(result(derive({ cleanupLog: other }).model, "pnpm test:docker-cleanup --run").word).toBe(
      "failed",
    );
  });

  it("R3-4: L9 a named unit test file decides its matrix row", () => {
    const m = derive().model;
    expect(matrix(m, 14).partAState).toBe("passed");
    expect(matrix(m, 14).closed).toBe("yes");
    const w = fileWord(
      "pnpm test",
      vitestJson([
        { path: "tests/unit/client-ip.test.ts", asserts: ["passed", "passed", "passed"] },
      ]),
      "tests/unit/client-ip.test.ts",
    );
    expect(w).toEqual({
      word: "passed",
      note: "tests/unit/client-ip.test.ts: passed=3 failed=0 skipped=0",
    });
    const without = derive({
      testFiles: UNIT_FILES.filter((p) => p !== "tests/unit/client-ip.test.ts").map((p) => ({
        path: p,
        asserts: ["passed"],
      })),
    }).model;
    expect(matrix(without, 14).partAState).toBe("failed");
    expect(matrix(without, 14).closed).toBe("no");
    expect(matrix(without, 14).notes).toContain("not in result: tests/unit/client-ip.test.ts");
  });

  it("R3-4: L10 the CSP spec passes only when every spec is ok and expected", () => {
    expect(matrix(derive().model, 11).partAState).toBe("passed");
    const skipped = derive({
      e2eSpecs: [
        { file: "csp.spec.ts", ok: true, status: "expected" },
        { file: "csp.spec.ts", ok: true, status: "skipped" },
      ],
    }).model;
    expect(matrix(skipped, 11).partAState).toBe("failed");
  });

  it("R2-2: L11 an unhealthy Docker blocks every Docker row and keeps the host rows", () => {
    const m = derive({ colimaExit: 1 }).model;
    for (const k of [
      "pnpm test:integration",
      "pnpm test:e2e",
      "pnpm test:egress",
      "image check runner",
      "image check builder",
      "pnpm test:docker-cleanup --run",
    ])
      expect(result(m, k).word).toBe("blocked (docker unhealthy)");
    expect(result(m, "pnpm lint").word).toBe("passed");
    expect(result(m, "pnpm audit --prod").word).toBe("failed");
    expect(evidence(m, FOREIGN_ROW).word).toBe("blocked (docker unhealthy)");
    expect(evidence(m, "no foreign project named in gate logs").word).toBe(
      "blocked (docker unhealthy)",
    );
    expect(result(m, "compose stack gate").word).toBe("moved to Phase 8.1");
  });

  it("R3-4: L12 a dirty tree runs nothing and has no candidate", () => {
    const res = deriveGate(makeDir({ dirty: " M src/proxy.ts\n" }));
    const m = res.model;
    for (const r of m.results.filter((x) => x.key !== "compose stack gate"))
      expect(r.word).toBe("not run (dirty tree)");
    for (const r of m.evidence) expect(r.word).toBe("not run (dirty tree)");
    for (const r of m.design) expect(r.word).toBe("not run (dirty tree)");
    expect(res.text).toContain(
      "Candidate safe point for v1.0.0 (owner decides; not the Phase 8 safe point): none (dirty tree)",
    );
    expect(res.text).toContain("Tree state: dirty\nDirty paths:\n  src/proxy.ts\n");
  });

  it("R3-4: L13 a both row is passed in Part A, moved for Phase 8.1, and never closed", () => {
    const m = derive({ auditHighExit: 0 }).model;
    expect(matrix(m, 27).partAState).toBe("passed");
    expect(matrix(m, 27).phase81State).toBe("moved to Phase 8.1");
    expect(matrix(m, 27).closed).toBe("no");
    expect(requirement(m, "AIDA-32").closed).toBe("no (split: Phase 8.1)");
    expect(requirement(m, "AIDA-25").closed).toBe("yes");
    expect(requirement(m, "AIDA-25").moved).toBe("-");
  });

  it("R4-1: L14 the spec has the row counts of the plan and names every source file", () => {
    const want: Record<string, [number, number]> = {
      "AIDA-25": [2, 0],
      "AIDA-26": [2, 0],
      "AIDA-27": [6, 4],
      "AIDA-28": [3, 2],
      "AIDA-29": [5, 2],
      "AIDA-30": [7, 3],
      "AIDA-31": [1, 0],
      "AIDA-32": [5, 2],
    };
    for (const [req, [rows, moved]] of Object.entries(want)) {
      const own = SPEC.rows.filter((r) => r.belongsTo === req);
      expect(own.length).toBe(rows);
      expect(own.filter((r) => r.phase81.length > 0).length).toBe(moved);
    }
    const keys = [...SPEC.results.map((r) => r.key), ...SPEC.evidence.map((r) => r.key)];
    for (const r of SPEC.rows)
      for (const s of r.partA) {
        if (keys.includes(s)) continue;
        expect(s).toMatch(/^(pnpm test|pnpm test:integration|pnpm test:e2e) :: tests\/\S+$/);
      }
  });

  it("D-26: L15 the design-system checklist reads the Part A source patch", () => {
    const allow =
      "+++ b/src/app/layout.tsx\n+const a = 1;\n+++ b/src/app/globals.css\n+--font-system: x;\n";
    const d = derive({ patch: allow }).model.design;
    for (const i of [1, 2, 3, 4])
      expect(d[i].word).toBe(
        "not applicable (Part A changed only src/app/layout.tsx, src/app/globals.css)",
      );
    expect(d[5].word).toBe("passed");
    expect(d[6].word).toBe("not run (manual: visual check)");
    const named = derive({ patch: '+++ b/src/components/x.tsx\n+<p className="text-lg">\n' }).model
      .design;
    expect(named[5].word).toBe("failed");
    expect(named[1].word).toBe("not run (manual: 1 UI files changed)");
    expect(named[6].word).toBe("not run (manual: visual check)");
  });

  it("J: L16 an audit network failure is blocked (with evidence), any other exit failed", () => {
    const bad = derive({ auditHighLog: " ERR_PNPM_AUDIT_BAD_RESPONSE  The audit endpoint\n" });
    expect(result(bad.model, "pnpm audit --prod --audit-level=high").word).toBe(
      "blocked (with evidence)",
    );
    expect(result(derive().model, "pnpm audit --prod --audit-level=high").word).toBe("failed");
  });

  it("c-WR-08: L17 every log a row cites must exist, or derive lists it missing", () => {
    const cited = [
      "lint.log",
      "typecheck.log",
      "test.log",
      "build.log",
      "audit.log",
      "audit-high.log",
      "integration.log",
      "e2e.log",
      "egress.log",
      "ops-volume.log",
      "ops-client-ip.log",
      "sla-flag-comment.log",
    ];
    const notes = derive().model;
    for (const name of cited) {
      const inNotes = [...notes.results, ...notes.evidence].some((r) =>
        r.note.includes(`/${name}`),
      );
      expect(inNotes, `${name} is cited by a row`).toBe(true);
      expect(derive({ skip: [name] }).missing, name).toContain(name);
    }
  });

  it("c-WR-08: L18 an empty ops evidence log is failed, not passed with an empty quote", () => {
    const r = evidence(
      derive({ opsVolumeLog: "" }).model,
      "OPERATIONS.md volume upgrade procedure",
    );
    expect(r.word).toBe("failed");
    expect(r.note).toContain("no output to evidence the check");
  });

  it("c-WR-09: L19 an audit that returned advisories is failed even with a network word in it", () => {
    const advisories = [
      "┌─────────────────────┬────────────────────────────────────────────────────────┐",
      "│ high                │ undici: ECONNRESET and socket hang up on a malformed   │",
      "│                     │ chunked body after getaddrinfo ENOTFOUND retries       │",
      "├─────────────────────┼────────────────────────────────────────────────────────┤",
      "│ Package             │ undici                                                 │",
      "├─────────────────────┼────────────────────────────────────────────────────────┤",
      "│ More info           │ https://github.com/advisories/GHSA-aaaa-bbbb-cccc      │",
      "└─────────────────────┴────────────────────────────────────────────────────────┘",
      "1 vulnerabilities found",
      "Severity: 1 high",
    ].join("\n");
    const r = result(
      derive({ auditHighLog: `${advisories}\n` }).model,
      "pnpm audit --prod --audit-level=high",
    );
    expect(r.word).toBe("failed");
    expect(r.note).toContain('"Severity: 1 high"');
    // An advisory table cut off before the summary still counts as advisory data.
    const cut = advisories.split("\n").slice(0, 8).join("\n");
    expect(
      result(derive({ auditHighLog: `${cut}\n` }).model, "pnpm audit --prod --audit-level=high")
        .word,
    ).toBe("failed");
  });

  it("c-WR-09: L20 a network word outside an error line, with no advisories, is failed", () => {
    const log = "Retrying after getaddrinfo ENOTFOUND in a progress line\n";
    expect(
      result(derive({ auditHighLog: log }).model, "pnpm audit --prod --audit-level=high").word,
    ).toBe("failed");
  });

  it("c-WR-09: L21 an anchored network error with no advisories is blocked (with evidence)", () => {
    const log =
      " ERR_PNPM_META_FETCH_FAIL  GET https://registry.npmjs.org/-/npm/v1/security/audits: request failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org\n";
    expect(
      result(derive({ auditHighLog: log }).model, "pnpm audit --prod --audit-level=high").word,
    ).toBe("blocked (with evidence)");
    const err = "Error: socket hang up\n";
    expect(
      result(derive({ auditHighLog: err }).model, "pnpm audit --prod --audit-level=high").word,
    ).toBe("blocked (with evidence)");
  });

  it("c-IN-05: L22 a vitest run where no test ran is failed, not passed", () => {
    const m = derive({
      testFiles: UNIT_FILES.map((p) => ({ path: p, asserts: ["skipped"], status: "passed" })),
    }).model;
    const r = result(m, "pnpm test");
    expect(r.word).toBe("failed");
    expect(r.note).toContain("passed=0");
  });

  it("c-IN-05: L23 a Playwright run where every test was skipped is failed, not passed", () => {
    const m = derive({ e2eSpecs: [{ file: "csp.spec.ts", ok: true, status: "skipped" }] }).model;
    const r = result(m, "pnpm test:e2e");
    expect(r.word).toBe("failed");
    expect(r.note).toContain("expected=0");
  });

  it("c-IN-06: quote redacts URL credentials, bearer tokens and token or auth assignments", () => {
    const cases: [string, string, string][] = [
      [
        "postgresql://aida:hunter2@db:5432/aida?schema=x",
        "hunter2",
        "postgresql://<redacted>@db:5432",
      ],
      ["GET https://ghp_abc123@github.com/x", "ghp_abc123", "https://<redacted>@github.com/x"],
      ["Authorization: Bearer eyJhbGciOi.payload.sig", "eyJhbGciOi", "Authorization: <redacted>"],
      ["sent Bearer abc.def-ghi to the API", "abc.def-ghi", "Bearer <redacted>"],
      ["Authorization: Basic dXNlcjpwYXNz", "dXNlcjpwYXNz", "Authorization: <redacted>"],
      ["GITHUB_TOKEN=ghs_xyz789 pnpm audit", "ghs_xyz789", "GITHUB_TOKEN=<redacted>"],
      ["//registry.npmjs.org/:_authToken=npm_secret1", "npm_secret1", "_authToken=<redacted>"],
      ['{"access_token":"tok-1234"}', "tok-1234", "access_token"],
    ];
    for (const [line, secret, kept] of cases) {
      const q = quote(line);
      expect(q, line).not.toContain(secret);
      expect(q, line).toContain(kept);
    }
  });

  it("c-IN-06: quote leaves gate text without credentials unchanged", () => {
    for (const line of [
      spaceLine(),
      `IMAGE-CHECK-VERIFY state=blocked cause=space word="blocked (space)" target=runner tag=aida-test-nonroot-runner:${RUN} exit=3`,
      "tests/integration/auth-ip-source.test.ts: passed=3 failed=0 skipped=0",
      "Severity: 2 low | 30 moderate | 10 high",
      "https://github.com/advisories/GHSA-gpj5-g38j-94v9",
      "node_modules/@prisma/engines postinstall",
    ])
      expect(quote(line)).toBe(`"${line}"`);
  });

  it("J: worstOf and WORDS follow rule A-11's order", () => {
    expect(worstOf(["passed", "blocked (space)"])).toBe("blocked (space)");
    expect(worstOf(["blocked (space)", "blocked (with evidence)"])).toBe("blocked (with evidence)");
    expect(worstOf(["not run (a)", "not run (b)", "passed"])).toBe("not run (a)");
    expect(worstOf(["blocked (docker unhealthy)", "failed"])).toBe("failed");
    expect(WORDS).toContain("moved to Phase 8.1");
  });
});

// --- mutations -----------------------------------------------------------------------------

function fullGate(): { dir: string; file: string; text: string } {
  const dir = makeDir({
    foreignAfter: "CONTAINER ID   NAMES         STATE\n0123456789ab   aida-dev-db   exited\n",
    cleanupLog: `2 resource(s) of run ${RUN}; dry run, nothing removed.\n`,
  });
  const res = deriveGate(dir);
  expect(res.missing).toEqual([]);
  const file = path.join(dir, "gate.md");
  fs.writeFileSync(file, `${res.text}\n## Notes\n\n- free text\n`);
  return { dir, file, text: fs.readFileSync(file, "utf8") };
}

function runCheck(file: string): { code: number; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const code = main(["check", file], { out: (s) => out.push(s), err: (s) => err.push(s) });
  return { code, out, err };
}

function sectionRows(text: string, heading: string): { start: number; end: number } {
  const lines = text.split("\n");
  const start = lines.indexOf(heading);
  if (start === -1) throw new Error(`no ${heading}`);
  let end = start + 1;
  while (end < lines.length && !lines[end].startsWith("## ")) end++;
  return { start, end };
}

function editCell(text: string, heading: string, key: string, col: number, value: string): string {
  const lines = text.split("\n");
  const { start, end } = sectionRows(text, heading);
  for (let i = start; i < end; i++) {
    if (!lines[i].startsWith("| ")) continue;
    const cells = lines[i].slice(2, -2).split(" | ");
    if (cells[0] !== key) continue;
    cells[col] = value;
    lines[i] = `| ${cells.join(" | ")} |`;
    return lines.join("\n");
  }
  throw new Error(`no row ${key} in ${heading}`);
}

function cellOf(text: string, heading: string, key: string, col: number): string {
  const { start, end } = sectionRows(text, heading);
  for (const l of text.split("\n").slice(start, end)) {
    if (!l.startsWith("| ")) continue;
    const cells = l.slice(2, -2).split(" | ");
    if (cells[0] === key) return cells[col];
  }
  throw new Error(`no row ${key}`);
}

function expectRejected(file: string, text: string, section: string, key: string) {
  fs.writeFileSync(file, text);
  const r = runCheck(file);
  expect(r.code).toBe(1);
  expect(r.out.join("\n")).toContain(`PART-A-GATE-CHECK FAILED: ${section}: ${key}:`);
}

const R = "## Results";
const EV = "## Evidence checks";
const MX = "## Evidence matrix";
const RQ = "## Requirement status";
const DS = "## Design-system checklist (§9)";

describe("part-a-gate-check: check rejects single edits", () => {
  it("R3-4: mutation baseline: the derived file passes check with every section", () => {
    const { file } = fullGate();
    const r = runCheck(file);
    expect(r.code).toBe(0);
    expect(r.out).toEqual([
      "PART-A-GATE-CHECK ok sections=all results=13 evidence=7 design=8 matrix=31 requirements=8",
    ]);
    expect(checkGate(fs.readFileSync(file, "utf8"), ["header", "results", "evidence"]).ok).toBe(
      true,
    );
  });

  it("R3-4: mutation M1 a failed Results word changed to passed", () => {
    const g = fullGate();
    expect(cellOf(g.text, R, "pnpm audit --prod", 2)).toBe("failed");
    expectRejected(
      g.file,
      editCell(g.text, R, "pnpm audit --prod", 2, "passed"),
      "results",
      "pnpm audit --prod",
    );
  });

  it("R3-4: mutation M2 the tested commit changed by one hex digit", () => {
    const g = fullGate();
    expectRejected(
      g.file,
      g.text.replace(`Tested commit: ${SHA}`, `Tested commit: 1${SHA.slice(1)}`),
      "header",
      "Tested commit",
    );
  });

  it("R3-4: mutation M3 the run id changed", () => {
    const g = fullGate();
    expectRejected(
      g.file,
      g.text.replace(`Run id: ${RUN}`, "Run id: mwc6vmbv-0000000000000000"),
      "header",
      "Run id",
    );
  });

  it("R3-4: mutation M4 the compose stack gate word changed to passed", () => {
    const g = fullGate();
    expectRejected(
      g.file,
      editCell(g.text, R, "compose stack gate", 2, "passed"),
      "results",
      "compose stack gate",
    );
  });

  it("R3-4: mutation M5 the egress word blocked (space) changed to passed", () => {
    const g = fullGate();
    expect(cellOf(g.text, R, "pnpm test:egress", 2)).toBe("blocked (space)");
    expectRejected(
      g.file,
      editCell(g.text, R, "pnpm test:egress", 2, "passed"),
      "results",
      "pnpm test:egress",
    );
  });

  it("R3-4: mutation M6 an image check word blocked (space) changed to passed", () => {
    const g = fullGate();
    expect(cellOf(g.text, R, "image check runner", 2)).toBe("blocked (space)");
    expectRejected(
      g.file,
      editCell(g.text, R, "image check runner", 2, "passed"),
      "results",
      "image check runner",
    );
  });

  it("R3-4: mutation M7 the cleanup word failed changed to passed", () => {
    const g = fullGate();
    const k = "pnpm test:docker-cleanup --run";
    expect(cellOf(g.text, R, k, 2)).toBe("failed");
    expectRejected(g.file, editCell(g.text, R, k, 2, "passed"), "results", k);
  });

  it("R3-4: mutation M8 a matrix evidence cell naming a different file", () => {
    const g = fullGate();
    const cell = cellOf(g.text, MX, "14", 4);
    expect(cell).toBe("pnpm test :: tests/unit/client-ip.test.ts");
    expectRejected(
      g.file,
      editCell(g.text, MX, "14", 4, cell.replace("client-ip", "proxy")),
      "matrix",
      "14",
    );
  });

  it("R3-4: mutation M9 a matrix Part A state changed from failed to passed", () => {
    const g = fullGate();
    expect(cellOf(g.text, MX, "1", 5)).toBe("failed");
    expectRejected(g.file, editCell(g.text, MX, "1", 5, "passed"), "matrix", "1");
  });

  it("R3-4: mutation M10 a moved row's Phase 8.1 state changed to passed", () => {
    const g = fullGate();
    expect(cellOf(g.text, MX, "5", 7)).toBe("moved to Phase 8.1");
    expectRejected(g.file, editCell(g.text, MX, "5", 7, "passed"), "matrix", "5");
  });

  it("R3-4: mutation M11 a moved row's Closed changed to yes", () => {
    const g = fullGate();
    expectRejected(g.file, editCell(g.text, MX, "20", 8, "yes"), "matrix", "20");
  });

  it("R3-4: mutation M12 a row's Required changed from phase-8.1 to part-a", () => {
    const g = fullGate();
    expect(cellOf(g.text, MX, "31", 3)).toBe("phase-8.1");
    expectRejected(g.file, editCell(g.text, MX, "31", 3, "part-a"), "matrix", "31");
  });

  it("R3-4: mutation M13 a matrix row deleted", () => {
    const g = fullGate();
    const text = g.text
      .split("\n")
      .filter((l) => !l.startsWith("| 5 | "))
      .join("\n");
    expectRejected(g.file, text, "matrix", "5");
  });

  it("R3-4: mutation M14 two matrix rows swapped", () => {
    const g = fullGate();
    const lines = g.text.split("\n");
    const a = lines.findIndex((l) => l.startsWith("| 3 | "));
    const b = lines.findIndex((l) => l.startsWith("| 4 | "));
    [lines[a], lines[b]] = [lines[b], lines[a]];
    expectRejected(g.file, lines.join("\n"), "matrix", "3");
  });

  it("R3-4: mutation M15 AIDA-27 Requirement closed changed to yes", () => {
    const g = fullGate();
    expectRejected(g.file, editCell(g.text, RQ, "AIDA-27", 3, "yes"), "requirements", "AIDA-27");
  });

  it("R3-4: mutation M16 AIDA-30 Moved to Phase 8.1 changed to -", () => {
    const g = fullGate();
    expect(cellOf(g.text, RQ, "AIDA-30", 2)).toBe("20, 24, 25");
    expectRejected(g.file, editCell(g.text, RQ, "AIDA-30", 2, "-"), "requirements", "AIDA-30");
  });

  it("R3-4: mutation M17 the candidate line reworded to drop owner decides", () => {
    const g = fullGate();
    const text = g.text.replace(
      "(owner decides; not the Phase 8 safe point)",
      "(not the Phase 8 safe point)",
    );
    expect(text).not.toBe(g.text);
    expectRejected(g.file, text, "header", "Candidate safe point");
  });

  it("R3-4: mutation M18 design-system item 7 changed to passed", () => {
    const g = fullGate();
    const key = cellOf(g.text, DS, "7 dark mode tested", 0);
    expectRejected(g.file, editCell(g.text, DS, key, 1, "passed"), "design", "7 dark mode tested");
  });

  it("R3-4: mutation M19 an Evidence checks word failed changed to passed", () => {
    const g = fullGate();
    const k = FOREIGN_ROW;
    expect(cellOf(g.text, EV, k, 1)).toBe("failed");
    expectRejected(g.file, editCell(g.text, EV, k, 1, "passed"), "evidence", k);
  });

  it("R3-4: mutation M20 a human item from rule A-12 deleted", () => {
    const g = fullGate();
    const lines = g.text.split("\n");
    const i = lines.findIndex((l) => l.startsWith("- Owner: decide whether the Part A commit"));
    expect(i).toBeGreaterThan(-1);
    const bullet = lines[i];
    lines.splice(i, 1);
    expectRejected(g.file, lines.join("\n"), "human", bullet);
  });

  it("R3-4: mutation M21 the egress Note's quoted space line replaced", () => {
    const g = fullGate();
    const note = cellOf(g.text, R, "pnpm test:egress", 3);
    const other = note.replace(spaceLine(), spaceLine("the host", 12.0));
    expect(other).not.toBe(note);
    expectRejected(
      g.file,
      editCell(g.text, R, "pnpm test:egress", 3, other),
      "results",
      "pnpm test:egress",
    );
  });

  it("c-WR-07: mutation M23 a contradicting row written without spaces after the pipes", () => {
    const g = fullGate();
    const lines = g.text.split("\n");
    const i = lines.findIndex((l) => l.startsWith("| 7 | "));
    const tight = `|${splitRow(lines[i]).slice(0, 8).join("|")}|yes|`;
    expect(tight.startsWith("|7|")).toBe(true);
    lines.splice(i + 1, 0, tight);
    fs.writeFileSync(g.file, lines.join("\n"));
    const r = runCheck(g.file);
    expect(r.code).toBe(1);
    expect(r.out.join("\n")).toContain("PART-A-GATE-CHECK FAILED: matrix: ");
  });

  it("c-WR-07: mutation M24 a second Evidence matrix section below Notes", () => {
    const g = fullGate();
    const second = `\n## Evidence matrix\n\n| # | x |\n| --- | --- |\n| 1 | closed |\n`;
    expectRejected(g.file, `${g.text}${second}`, "matrix", "section");
    const spaced = `\n##   Results  \n\nwhatever\n`;
    expectRejected(g.file, `${g.text}${spaced}`, "results", "section");
  });

  it("c-WR-07: mutation M25 a pipe line without a leading pipe inside the Results table", () => {
    const g = fullGate();
    const lines = g.text.split("\n");
    const i = lines.findIndex((l) => l.startsWith("| pnpm lint | "));
    lines.splice(i + 1, 0, "pnpm audit --prod | 0 | passed | log x");
    expectRejected(g.file, lines.join("\n"), "results", "table");
  });

  it("c-WR-07: mutation M26 a table line that does not parse into the section's columns", () => {
    const g = fullGate();
    const lines = g.text.split("\n");
    const i = lines.findIndex((l) => l.startsWith("| AIDA-27 | "));
    lines.splice(i + 1, 0, "|AIDA-27 closed|");
    expectRejected(g.file, lines.join("\n"), "requirements", "table");
  });

  it("c-WR-08: mutation M27 a cited log removed from the evidence directory fails check", () => {
    const g = fullGate();
    fs.rmSync(path.join(g.dir, "lint.log"));
    const r = runCheck(g.file);
    expect(r.code).toBe(1);
    expect(r.out).toContain(
      "PART-A-GATE-CHECK FAILED: header: Evidence dir: evidence file missing: lint.log",
    );
  });

  it("R3-4: mutation M22 a source flipped to failed after derive fails check on that row", () => {
    const g = fullGate();
    const p = path.join(g.dir, "test.json");
    const json = JSON.parse(fs.readFileSync(p, "utf8"));
    const entry = json.testResults.find((t: { name: string }) =>
      t.name.endsWith("/tests/unit/add-tag-gate.test.ts"),
    );
    entry.status = "failed";
    entry.assertionResults[0].status = "failed";
    fs.writeFileSync(p, JSON.stringify(json));
    const r = runCheck(g.file);
    expect(r.code).toBe(1);
    expect(r.out.join("\n")).toContain("PART-A-GATE-CHECK FAILED: matrix: 29:");
  });
});

// K133 (Codex diff critique 1, item 3): after a passing verify log, any change to the image log's
// validated fields, or a missing teardown line, must make `check` fail on that row. The gate
// re-runs test-image-check.ts's --verify validation (one pure module both scripts import) over the
// actual image log and exit file at derive and at check time, instead of trusting the verify log.
describe("part-a-gate-check: the image row re-verifies its own evidence (K133)", () => {
  function passingGate(): { dir: string; file: string } {
    const dir = makeDir({
      ...passedImages(0),
      foreignAfter: "CONTAINER ID   NAMES         STATE\n0123456789ab   aida-dev-db   exited\n",
      cleanupLog: `2 resource(s) of run ${RUN}; dry run, nothing removed.\n`,
    });
    const res = deriveGate(dir);
    expect(res.missing).toEqual([]);
    expect(result(res.model, "image check runner").word).toBe("passed");
    const file = path.join(dir, "gate.md");
    fs.writeFileSync(file, `${res.text}\n## Notes\n\n- free text\n`);
    expect(runCheck(file).code).toBe(0);
    return { dir, file };
  }

  const mutations: [string, string][] = [
    [
      "user",
      passingImageLog("runner", (r) => {
        r.user = "root";
      }),
    ],
    [
      "env NEXT_TELEMETRY_DISABLED",
      passingImageLog("runner", (r) => {
        r.env = ["PATH=/usr/local/bin", "CHECKPOINT_DISABLE=1"];
      }),
    ],
    [
      "env CHECKPOINT_DISABLE",
      passingImageLog("runner", (r) => {
        r.env = ["NEXT_TELEMETRY_DISABLED=1"];
      }),
    ],
    [
      "image ID",
      passingImageLog("runner", (r) => {
        r.imageId = null;
      }),
    ],
    [
      "tag",
      passingImageLog("runner", (r) => {
        r.tag = "aida-test-nonroot-runner:mwc6vmbv-0000000000000000";
      }),
    ],
    [
      "run id",
      passingImageLog("runner", (r) => {
        r.runId = "mwc6vmbv-0000000000000000";
      }),
    ],
    [
      "run label",
      passingImageLog("runner", (r) => {
        r.labels = { "aida.test": "1" };
      }),
    ],
    [
      "state",
      passingImageLog("runner", (r) => {
        r.state = "failed";
        r.cause = "build";
      }),
    ],
    [
      "tag not removed",
      passingImageLog("runner", (_r, td) => {
        td.removed = [];
      }),
    ],
    [
      "base image moved",
      passingImageLog("runner", (r) => {
        r.baseImageAfter = "sha256:other";
      }),
    ],
    ["teardown line removed", passingImageLog("runner", undefined, { dropTeardown: true })],
  ];

  it.each(
    mutations,
  )("changing the image log's %s after a passing verify fails check", (_f, log) => {
    const g = passingGate();
    fs.writeFileSync(path.join(g.dir, "image-runner.log"), log);
    const r = runCheck(g.file);
    expect(r.code).toBe(1);
    expect(r.out.join("\n")).toContain("PART-A-GATE-CHECK FAILED: results: image check runner:");
  });

  it("changing the image exit file after a passing verify fails check", () => {
    const g = passingGate();
    fs.writeFileSync(path.join(g.dir, "image-runner.exit"), "1\n");
    const r = runCheck(g.file);
    expect(r.code).toBe(1);
    expect(r.out.join("\n")).toContain("PART-A-GATE-CHECK FAILED: results: image check runner:");
  });

  it("one pure validation module, imported by both scripts, with no Docker or child-process code", () => {
    expect(imageCheck.verifyImageCheckLog).toBe(pureVerify.verifyImageCheckLog);
    const src = fs.readFileSync(path.join("scripts", "image-check-verify.ts"), "utf8");
    const imports = [...src.matchAll(/^import[^;]*?from\s+"([^"]+)"/gms)].map((m) => m[1]);
    for (const spec of imports) {
      expect(spec).not.toMatch(
        /child_process|docker-test-preflight|test-docker-cleanup|test-image-check/,
      );
    }
    expect(src).not.toMatch(/\bspawn\(|\bexecFile|\bexecSync|runDocker/);
    const gate = fs.readFileSync(path.join("scripts", "part-a-gate-check.ts"), "utf8");
    expect(gate).toMatch(/from "\.\/image-check-verify"/);
    expect(gate).not.toMatch(/from "\.\/test-image-check"/);
    const check = fs.readFileSync(path.join("scripts", "test-image-check.ts"), "utf8");
    expect(check).toMatch(/from "\.\/image-check-verify"/);
  });
});

// K134 (Codex diff critique 1, item 4): the foreign listing row records each listing's exit code
// and passes only when every listing exits 0 and is a well-formed table (header line present,
// every other line a container or volume row), before and after, and the two are identical.
describe("part-a-gate-check: the foreign listing row (K134)", () => {
  /** The row under either name, so the old verifier's answer is visible in a red run. */
  const foreignRow = (f: Fixture) => {
    const r = derive(f).model.evidence.find((e) => e.key.endsWith("unchanged"));
    if (!r) throw new Error("no foreign listing row");
    return r;
  };
  const files = (text: string, exit = "0\n") => {
    const out: Record<string, string> = {};
    for (const when of ["before", "after"])
      for (const l of FOREIGN_LISTINGS) {
        out[`foreign-${when}-${l}.txt`] = text;
        out[`foreign-${when}-${l}.exit`] = exit;
      }
    return out;
  };

  it("is named for what it measures", () => {
    const keys = derive().model.evidence.map((e) => e.key);
    expect(keys).toContain(FOREIGN_ROW);
    expect(keys).not.toContain("foreign resources unchanged");
  });

  it("well-formed identical listings with exit 0 pass", () => {
    const r = foreignRow({});
    expect(r.word).toBe("passed");
    expect(r.note).toContain("3 listing(s) before and after, each exit 0");
  });

  it("two empty identical files fail", () => {
    expect(foreignRow({ foreign: files("") }).word).toBe("failed");
  });

  it("identical listings without a header line fail", () => {
    const r = foreignRow({ foreign: files("0123456789ab   aida-dev-db   running\n") });
    expect(r.word).toBe("failed");
    expect(r.note).toContain("header");
  });

  it("an identical listing whose command failed (exit 1) fails, before or after", () => {
    for (const when of ["before", "after"]) {
      const r = foreignRow({ foreign: { [`foreign-${when}-project-volumes.exit`]: "1\n" } });
      expect(r.word, when).toBe("failed");
      expect(r.note).toContain(`foreign-${when}-project-volumes.exit`);
    }
  });

  it("a missing listing or exit file fails", () => {
    expect(foreignRow({ foreign: { "foreign-after-dev-db-container.exit": null } }).word).toBe(
      "failed",
    );
    expect(foreignRow({ foreign: { "foreign-before-project-containers.txt": null } }).word).toBe(
      "failed",
    );
  });

  it("an error text in place of a listing fails even when identical", () => {
    const err = "Cannot connect to the Docker daemon at unix:///var/run/docker.sock.\n";
    expect(foreignRow({ foreign: files(err) }).word).toBe("failed");
    const mixed = `${FOREIGN_DEFAULT["dev-db-container"]}${err}`;
    expect(
      foreignRow({
        foreign: {
          "foreign-before-dev-db-container.txt": mixed,
          "foreign-after-dev-db-container.txt": mixed,
        },
      }).word,
    ).toBe("failed");
  });

  it("a changed listing fails with the first difference quoted", () => {
    const r = foreignRow({
      foreignAfter: "CONTAINER ID   NAMES         STATE\n0123456789ab   aida-dev-db   exited\n",
    });
    expect(r.word).toBe("failed");
    expect(r.note).toContain("aida-dev-db   exited");
  });

  it("check fails when a listing's exit file changes after derive", () => {
    const dir = makeDir({});
    const res = deriveGate(dir);
    const file = path.join(dir, "gate.md");
    fs.writeFileSync(file, `${res.text}\n## Notes\n\n- free text\n`);
    expect(runCheck(file).code).toBe(0);
    fs.writeFileSync(path.join(dir, "foreign-after-project-containers.exit"), "1\n");
    const r = runCheck(file);
    expect(r.code).toBe(1);
    expect(r.out.join("\n")).toContain(`PART-A-GATE-CHECK FAILED: evidence: ${FOREIGN_ROW}:`);
  });
});
