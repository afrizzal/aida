// Daemon-free unit tests for scripts/test-image-check.ts (plan 08-09, charter rule J, review R3-3).
// Every J1 message is produced by calling the real J1 function with a scripted fake runner, so a
// wording change in J1 breaks this file instead of silently changing a classification. No case
// uses the real Docker CLI, the real runBuildPreflight (checked by identity only) or a child process.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { DockerRunner } from "../../scripts/test-docker-cleanup";
import {
  classifyBuildFailure,
  classifyPreflightFailure,
  DEFAULT_STEPS,
  EXIT_CODES,
  type ImageCheckDeps,
  type ImageCheckResult,
  imageBuildArgs,
  imageCheckTag,
  inspectFindings,
  J1_SPACE_STOP,
  RESULT_PREFIX,
  removableTags,
  runImageCheck,
  summaryWord,
  TEARDOWN_PREFIX,
  verifyImageCheckLog,
} from "../../scripts/test-image-check";
import { newRunId, recordResource } from "../support/docker-test-labels";
import {
  acquireLock,
  assertEnoughSpace,
  assertTagsFree,
  type Docker,
  dockerFreeBytes,
  lockPath,
  runBuildPreflight,
  tagState,
} from "../support/docker-test-preflight";

const RUN = newRunId(1_700_000_000_000, Buffer.from("0011223344556677", "hex"));
const OTHER = newRunId(1_700_000_000_001, Buffer.from("ffeeddccbbaa9988", "hex"));
const GIB = 1024 ** 3;
const SOCKET_DOWN =
  "failed to connect to the docker API at unix:///x/docker.sock; check if the path is correct and if the daemon is running: dial unix /x/docker.sock: connect: no such file or directory";
const notFound = (ref: string) => `Error response from daemon: No such image: ${ref}`;
const noRecord = () => {};
const TAG = `aida-test-nonroot-runner:${RUN}`;

const tmpDirs: string[] = [];
function tmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

/** The message a J1 function throws, produced by calling it for real. */
function thrown(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error("expected the J1 function to throw");
}
const scripted =
  (answer: (args: string[]) => { code: number; stdout?: string; stderr?: string }): Docker =>
  (args) => {
    const a = answer(args);
    return { code: a.code, stdout: a.stdout ?? "", stderr: a.stderr ?? "" };
  };

const VM_SPACE = thrown(() => assertEnoughSpace("the Docker VM", 13.9 * GIB));
const HOST_SPACE = thrown(() => assertEnoughSpace("the host", 13.9 * GIB));

function goodConfig(runId: string = RUN) {
  return {
    User: "node",
    Env: [
      "PATH=/usr/local/bin",
      "NODE_ENV=production",
      "NEXT_TELEMETRY_DISABLED=1",
      "CHECKPOINT_DISABLE=1",
    ],
    Labels: { "aida.test": "1", "aida.test.run": runId },
  };
}

describe("tag and build args", () => {
  it("R3-3: the runner tag is aida-test-nonroot-runner:<run id>", () => {
    expect(imageCheckTag("runner", RUN)).toBe(`aida-test-nonroot-runner:${RUN}`);
  });
  it("R3-3: the builder tag is aida-test-nonroot-builder:<run id>", () => {
    expect(imageCheckTag("builder", RUN)).toBe(`aida-test-nonroot-builder:${RUN}`);
  });
  it("J: an unknown target throws", () => {
    expect(() => imageCheckTag("app", RUN)).toThrow();
  });
  it("J: an invalid run id throws", () => {
    expect(() => imageCheckTag("runner", "not-a-run")).toThrow();
  });
  it("J: the build args are exactly target, both run labels, the tag and the context", () => {
    expect(imageBuildArgs("runner", TAG, RUN)).toEqual([
      "build",
      "--target",
      "runner",
      "--label",
      "aida.test=1",
      "--label",
      `aida.test.run=${RUN}`,
      "--tag",
      TAG,
      ".",
    ]);
  });
  it("J: the build args carry no pull, push, output or cache flag", () => {
    const args = imageBuildArgs("builder", imageCheckTag("builder", RUN), RUN).join(" ");
    expect(args).not.toMatch(/--pull|--push|--output|-o\b|--cache|--no-cache|--load/);
  });
});

describe("preflight classification on J1's real messages", () => {
  it("J: J1's space stop for the Docker VM is blocked/space", () => {
    expect(VM_SPACE).toMatch(J1_SPACE_STOP);
    expect(classifyPreflightFailure(VM_SPACE)).toEqual({ state: "blocked", cause: "space" });
  });
  it("J: J1's space stop for the host is blocked/space", () => {
    expect(classifyPreflightFailure(HOST_SPACE)).toEqual({ state: "blocked", cause: "space" });
  });
  it("J: a failing space probe is blocked/measure", () => {
    const docker = scripted((args) =>
      args[0] === "info"
        ? { code: 0, stdout: "/var/lib/docker\n" }
        : { code: 125, stderr: notFound("node:22-alpine") },
    );
    const message = thrown(() => dockerFreeBytes(docker, RUN, noRecord));
    expect(classifyPreflightFailure(message)).toEqual({ state: "blocked", cause: "measure" });
  });
  it("J: a lock already held is not run/lock", () => {
    const dir = tmp("aida-image-check-lock-");
    const release = acquireLock(RUN, dir);
    const message = thrown(() => acquireLock(OTHER, dir));
    release();
    expect(classifyPreflightFailure(message)).toEqual({ state: "not run", cause: "lock" });
  });
  it("J: a taken tag is not run/foreign", () => {
    const docker = scripted(() => ({ code: 0, stdout: "sha256:abc\n" }));
    const message = thrown(() => assertTagsFree(docker, [TAG]));
    expect(classifyPreflightFailure(message)).toEqual({ state: "not run", cause: "foreign" });
  });
  it("J: a dead socket during the tag check is blocked/docker", () => {
    const docker = scripted(() => ({ code: 1, stderr: SOCKET_DOWN }));
    const message = thrown(() => tagState(docker, TAG));
    expect(classifyPreflightFailure(message)).toEqual({ state: "blocked", cause: "docker" });
  });
  it("J: any other message is failed/harness", () => {
    expect(classifyPreflightFailure("TypeError: x is undefined")).toEqual({
      state: "failed",
      cause: "harness",
    });
  });
});

describe("build classification", () => {
  it("J: no space left on device is blocked/space", () => {
    expect(classifyBuildFailure("ERROR: write /x: no space left on device", false)).toEqual({
      state: "blocked",
      cause: "space",
    });
  });
  it("J: a stall at binaries.prisma.sh is blocked/external", () => {
    expect(classifyBuildFailure("GET https://binaries.prisma.sh/x timed out", false).cause).toBe(
      "external",
    );
  });
  it("J: a registry rate limit is blocked/external", () => {
    expect(
      classifyBuildFailure("toomanyrequests: You have reached your pull rate limit", false),
    ).toEqual({
      state: "blocked",
      cause: "external",
    });
  });
  it("J: a fired watchdog with an empty tail is blocked/external", () => {
    expect(classifyBuildFailure("", true)).toEqual({ state: "blocked", cause: "external" });
  });
  it("J: a TypeScript compile error is failed/build", () => {
    expect(
      classifyBuildFailure("Type error: Property 'x' does not exist on type 'Y'.", false),
    ).toEqual({ state: "failed", cause: "build" });
  });

  // c-WR-05: BuildKit plain-progress logs. Only the failing step and the final error decide.
  const installStep = [
    "#9 [deps 4/5] RUN pnpm install --frozen-lockfile",
    "#9 12.31 .../node_modules/@prisma/engines postinstall$ node scripts/postinstall.js",
    "#9 14.02 .../node_modules/@prisma/engines postinstall: Done",
    "#9 DONE 15.2s",
  ];
  const failingBuild = (stepLines: string[], context: string[]) =>
    [
      ...installStep,
      "#12 [builder 5/7] RUN pnpm build",
      ...stepLines.map((l, i) => `#12 ${(20 + i).toFixed(2)} ${l}`),
      '#12 ERROR: process "/bin/sh -c pnpm build" did not complete successfully: exit code: 1',
      "------",
      " > [builder 5/7] RUN pnpm build:",
      ...context.map((l) => `30.12 ${l}`),
      "------",
      "Dockerfile:40",
      "--------------------",
      "  40 | >>> RUN pnpm build",
      "--------------------",
      'ERROR: failed to solve: process "/bin/sh -c pnpm build" did not complete successfully: exit code: 1',
    ].join("\n");

  it("c-WR-05: a type error after an install step that printed @prisma/engines is failed/build", () => {
    const log = failingBuild(
      ["> next build", "Type error: Property 'x' does not exist on type 'Y'."],
      ["Type error: Property 'x' does not exist on type 'Y'.", " ELIFECYCLE  Command failed."],
    );
    expect(classifyBuildFailure(log, false)).toEqual({ state: "failed", cause: "build" });
  });
  it("c-WR-05: getaddrinfo ENOTFOUND from app code during next build is failed/build", () => {
    const line = "Error: getaddrinfo ENOTFOUND placeholder";
    const log = failingBuild(["> next build", line], [line, " ELIFECYCLE  Command failed."]);
    expect(classifyBuildFailure(log, false)).toEqual({ state: "failed", cause: "build" });
  });
  it("c-WR-05: ETIMEDOUT in an earlier step that succeeded does not relabel a later failure", () => {
    const log = [
      "#7 [deps 2/5] RUN pnpm fetch",
      "#7 3.10  WARN  GET https://registry.npmjs.org/x error (ETIMEDOUT). Will retry in 10 seconds.",
      "#7 DONE 20.0s",
      failingBuild(["Error: Cannot find module './x'"], ["Error: Cannot find module './x'"]),
    ].join("\n");
    expect(classifyBuildFailure(log, false)).toEqual({ state: "failed", cause: "build" });
  });
  it("c-WR-05: a bare @prisma/engines line in the failing step is failed/build", () => {
    const line = "Error: @prisma/engines: schema.prisma has an invalid model";
    expect(classifyBuildFailure(failingBuild([line], [line]), false)).toEqual({
      state: "failed",
      cause: "build",
    });
  });
  it("c-WR-05: a registry fetch failure in the failing step is blocked/external", () => {
    const line =
      " ERR_PNPM_META_FETCH_FAIL  GET https://registry.npmjs.org/next: request to https://registry.npmjs.org/next failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org";
    expect(classifyBuildFailure(failingBuild([line], [line]), false)).toEqual({
      state: "blocked",
      cause: "external",
    });
  });
  it("c-WR-05: a prisma engine download timeout in the failing step is blocked/external", () => {
    const line =
      "Error: request to https://binaries.prisma.sh/all_commits/x/libquery_engine.so.node.gz failed, reason: connect ETIMEDOUT 104.18.0.1:443";
    expect(classifyBuildFailure(failingBuild([line], [line]), false)).toEqual({
      state: "blocked",
      cause: "external",
    });
  });
  it("c-WR-05: a base image metadata failure in the final error is blocked/external", () => {
    const log = [
      "#2 [internal] load metadata for docker.io/library/node:22-alpine",
      '#2 ERROR: failed to do request: Head "https://registry-1.docker.io/v2/library/node/manifests/22-alpine": dial tcp: lookup registry-1.docker.io: i/o timeout',
      "------",
      "ERROR: failed to solve: node:22-alpine: failed to resolve source metadata for docker.io/library/node:22-alpine: failed to do request: dial tcp: lookup registry-1.docker.io: i/o timeout",
    ].join("\n");
    expect(classifyBuildFailure(log, false)).toEqual({ state: "blocked", cause: "external" });
  });
  it("c-WR-05: no space left on device in the failing step is still blocked/space", () => {
    const line = "ERROR: write /app/.next/cache/x: no space left on device";
    expect(classifyBuildFailure(failingBuild([line], [line]), false)).toEqual({
      state: "blocked",
      cause: "space",
    });
  });
});

describe("inspect findings", () => {
  it("D-08: a node user with both telemetry entries and both run labels has no violation", () => {
    expect(inspectFindings(goodConfig(), RUN)).toEqual([]);
  });
  it("D-08: an empty User (root) is one violation", () => {
    expect(inspectFindings({ ...goodConfig(), User: "" }, RUN)).toHaveLength(1);
  });
  it("D-08: User root is one violation", () => {
    expect(inspectFindings({ ...goodConfig(), User: "root" }, RUN)).toHaveLength(1);
  });
  it("D-27: a missing CHECKPOINT_DISABLE is one violation", () => {
    const c = goodConfig();
    expect(
      inspectFindings({ ...c, Env: c.Env.filter((e) => !e.startsWith("CHECKPOINT")) }, RUN),
    ).toHaveLength(1);
  });
  it("D-27: an empty NEXT_TELEMETRY_DISABLED value is one violation", () => {
    const c = goodConfig();
    const env = c.Env.map((e) => (e.startsWith("NEXT_TELEMETRY") ? "NEXT_TELEMETRY_DISABLED=" : e));
    expect(inspectFindings({ ...c, Env: env }, RUN)).toHaveLength(1);
  });
  it("D-27: NEXT_TELEMETRY_DISABLED=true is one violation", () => {
    const c = goodConfig();
    const env = c.Env.map((e) =>
      e.startsWith("NEXT_TELEMETRY") ? "NEXT_TELEMETRY_DISABLED=true" : e,
    );
    expect(inspectFindings({ ...c, Env: env }, RUN)).toHaveLength(1);
  });
  it("R3-3: a missing run label is one violation", () => {
    expect(inspectFindings({ ...goodConfig(), Labels: { "aida.test": "1" } }, RUN)).toHaveLength(1);
  });
  it("R3-3: the run label of another run is one violation", () => {
    expect(inspectFindings(goodConfig(OTHER), RUN)).toHaveLength(1);
  });
});

describe("image IDs before removal", () => {
  it("R3-3: a tag still on its recorded ID is removable", () => {
    expect(removableTags({ [TAG]: "sha256:a" }, { [TAG]: "sha256:a" })).toEqual({
      remove: [TAG],
      leftAlone: [],
    });
  });
  it("R3-3: a tag that moved to another ID is left alone", () => {
    expect(removableTags({ [TAG]: "sha256:a" }, { [TAG]: "sha256:b" })).toEqual({
      remove: [],
      leftAlone: [`${TAG} now sha256:b`],
    });
  });
  it("R3-3: a tag without a recorded ID is left alone as unrecorded", () => {
    expect(removableTags({}, { [TAG]: "sha256:b" })).toEqual({
      remove: [],
      leftAlone: [`${TAG} unrecorded`],
    });
  });
  it("R3-3: a gone tag is in neither list", () => {
    expect(removableTags({ [TAG]: "sha256:a" }, { [TAG]: null })).toEqual({
      remove: [],
      leftAlone: [],
    });
  });
});

// --- The whole flow on scripted fakes --------------------------------------------------------

interface FakeImage {
  id: string;
  labels: Record<string, string> | null;
  config: unknown;
}

function fakeDaemon(onConfig?: (images: Map<string, FakeImage>) => void) {
  const images = new Map<string, FakeImage>([
    ["node:22-alpine", { id: "sha256:base", labels: null, config: {} }],
  ]);
  const calls: string[][] = [];
  const cleanupCalls: string[][] = [];
  const docker: Docker = (args) => {
    calls.push(args);
    if (args[0] === "image" && args[1] === "inspect") {
      const ref = args[args.length - 1];
      const image = images.get(ref);
      if (!image) return { code: 1, stdout: "", stderr: notFound(ref) };
      if (args[3] === "{{.Id}}") return { code: 0, stdout: `${image.id}\n`, stderr: "" };
      if (args[3] === "{{json .Config}}") {
        const config = JSON.stringify(image.config);
        onConfig?.(images);
        return { code: 0, stdout: config, stderr: "" };
      }
    }
    return { code: 1, stdout: "", stderr: `unexpected call: ${args.join(" ")}` };
  };
  const cleanupDocker: DockerRunner = (args) => {
    cleanupCalls.push(args);
    const ref = args[args.length - 1];
    if (args[0] === "image" && args[1] === "inspect") {
      const image = images.get(ref);
      if (!image) throw new Error(notFound(ref));
      return JSON.stringify({ labels: image.labels });
    }
    if (args[0] === "image" && args[1] === "rm" && args.length === 3) {
      if (!images.delete(ref)) throw new Error(notFound(ref));
      return `Untagged: ${ref}\n`;
    }
    throw new Error(`unexpected call: ${args.join(" ")}`);
  };
  return { images, calls, cleanupCalls, docker, cleanupDocker };
}

type Fake = ReturnType<typeof fakeDaemon>;

/** Every daemon call is an image inspect; the only other call allowed is `image rm <tag>`. */
function expectAllowed(fake: Fake, removes: string[]) {
  for (const call of fake.calls) expect(call.slice(0, 2)).toEqual(["image", "inspect"]);
  const others = fake.cleanupCalls.filter((c) => !(c[0] === "image" && c[1] === "inspect"));
  expect(others).toEqual(removes.map((tag) => ["image", "rm", tag]));
}

function flow(
  fake: Fake,
  options: {
    build?: {
      code: number;
      watchdogFired: boolean;
      log?: string;
      config?: unknown;
      noImage?: boolean;
      /** What the base image tag points to after the build (a pull or a moved tag). */
      baseAfter?: string;
    };
    preflight?: ImageCheckDeps["preflight"];
    lockDir?: string;
  } = {},
) {
  const lockDir = options.lockDir ?? tmp("aida-image-check-lockdir-");
  const lines: string[] = [];
  const buildCalls: string[][] = [];
  const preflightCalls: unknown[] = [];
  const deps: ImageCheckDeps = {
    runId: RUN,
    repoRoot: path.resolve(__dirname, "../.."),
    hostDirs: [os.tmpdir()],
    runDir: tmp("aida-image-check-run-"),
    docker: fake.docker,
    cleanupDocker: fake.cleanupDocker,
    build: async (args, logFile) => {
      buildCalls.push(args);
      const b = options.build ?? { code: 0, watchdogFired: false };
      fs.writeFileSync(logFile, b.log ?? "#1 DONE\n");
      if (!b.noImage) {
        const config = b.config ?? goodConfig();
        const labels = (config as { Labels?: Record<string, string> }).Labels ?? null;
        fake.images.set(args[args.indexOf("--tag") + 1], { id: "sha256:built", labels, config });
      }
      if (b.baseAfter !== undefined)
        fake.images.set("node:22-alpine", { id: b.baseAfter, labels: null, config: {} });
      return { code: b.code, watchdogFired: b.watchdogFired };
    },
    preflight: (docker, opts) => {
      preflightCalls.push(opts);
      options.preflight?.(docker, opts);
    },
    lock: (runId) => acquireLock(runId, lockDir),
    record: noRecord,
    print: (line) => lines.push(line),
  };
  return { deps, lines, buildCalls, preflightCalls, lockDir };
}

const teardownOf = (lines: string[]) =>
  JSON.parse(
    lines.find((l) => l.startsWith(TEARDOWN_PREFIX))?.slice(TEARDOWN_PREFIX.length) ?? "null",
  );

describe("runImageCheck flow", () => {
  it("J: J1's space stop is blocked/space with no build, no removal and the lock released", async () => {
    const fake = fakeDaemon();
    const f = flow(fake, {
      preflight: () => assertEnoughSpace("the Docker VM", 13.9 * GIB),
    });
    const result = await runImageCheck("runner", f.deps);
    expect(result).toMatchObject({ state: "blocked", cause: "space", tag: TAG });
    expect(result.evidence).toMatch(J1_SPACE_STOP);
    expect(f.buildCalls).toEqual([]);
    expectAllowed(fake, []);
    expect(teardownOf(f.lines)).toMatchObject({ created: false, removed: [] });
    expect(fs.existsSync(lockPath(f.lockDir))).toBe(false);
    expect(
      JSON.parse(fs.readFileSync(path.join(f.deps.runDir, "preflight.json"), "utf8")),
    ).toMatchObject({
      tagState: "free",
      baseImageBefore: "sha256:base",
    });
  });

  it("J: a taken tag is not run/foreign and the preflight is never called", async () => {
    const fake = fakeDaemon();
    fake.images.set(TAG, { id: "sha256:foreign", labels: null, config: {} });
    const f = flow(fake);
    const result = await runImageCheck("runner", f.deps);
    expect(result).toMatchObject({ state: "not run", cause: "foreign" });
    expect(result.evidence).toContain("never overwritten");
    expect(f.preflightCalls).toEqual([]);
    expect(f.buildCalls).toEqual([]);
    expectAllowed(fake, []);
    expect(fake.images.has(TAG)).toBe(true);
  });

  it("J: a lock already held is not run/lock with no Docker call at all", async () => {
    const fake = fakeDaemon();
    const lockDir = tmp("aida-image-check-held-");
    const release = acquireLock(OTHER, lockDir);
    const f = flow(fake, { lockDir });
    const result = await runImageCheck("runner", f.deps);
    release();
    expect(result).toMatchObject({ state: "not run", cause: "lock" });
    expect(fake.calls).toEqual([]);
    expect(fake.cleanupCalls).toEqual([]);
    expect(teardownOf(f.lines)).toMatchObject({ created: false, removed: [] });
  });

  it("J: a fired watchdog is blocked/external and, with no tag left, nothing is removed", async () => {
    const fake = fakeDaemon();
    const f = flow(fake, { build: { code: 143, watchdogFired: true, log: "", noImage: true } });
    const result = await runImageCheck("runner", f.deps);
    expect(result).toMatchObject({ state: "blocked", cause: "external", imageId: null });
    expectAllowed(fake, []);
    expect(fs.existsSync(lockPath(f.lockDir))).toBe(false);
  });

  it("D-08: a compliant build passes, removes exactly its own tag and the post-check is free", async () => {
    const fake = fakeDaemon();
    const f = flow(fake);
    const result = await runImageCheck("runner", f.deps);
    expect(result).toMatchObject({ state: "passed", imageId: "sha256:built", user: "node" });
    expect(f.buildCalls).toEqual([imageBuildArgs("runner", TAG, RUN)]);
    expectAllowed(fake, [TAG]);
    expect(tagState(fake.docker, TAG)).toBe("free");
    expect(teardownOf(f.lines)).toMatchObject({ created: true, removed: [TAG], remaining: [] });
    expect(fake.images.has("node:22-alpine")).toBe(true);
  });

  it("R3-3: a tag that moved to another image before teardown is left alone and fails", async () => {
    const fake = fakeDaemon((images) => {
      const image = images.get(TAG);
      if (image) image.id = "sha256:moved";
    });
    const f = flow(fake);
    const result = await runImageCheck("runner", f.deps);
    expect(result).toMatchObject({ state: "failed", cause: "teardown" });
    expect(teardownOf(f.lines).leftAlone).toEqual([`${TAG} now sha256:moved`]);
    expectAllowed(fake, []);
    expect(fake.images.has(TAG)).toBe(true);
  });

  it("R3-3: a tag whose labels no longer carry this run lands in notOurs and fails", async () => {
    const fake = fakeDaemon((images) => {
      const image = images.get(TAG);
      if (image) image.labels = { "aida.test": "1", "aida.test.run": OTHER };
    });
    const f = flow(fake);
    const result = await runImageCheck("runner", f.deps);
    expect(result).toMatchObject({ state: "failed", cause: "teardown" });
    expect(teardownOf(f.lines).notOurs).toEqual([TAG]);
    expectAllowed(fake, []);
  });

  it("D-08: a build with an empty User fails on config and still removes its tag", async () => {
    const fake = fakeDaemon();
    const f = flow(fake, {
      build: { code: 0, watchdogFired: false, config: { ...goodConfig(), User: "" } },
    });
    const result = await runImageCheck("runner", f.deps);
    expect(result).toMatchObject({ state: "failed", cause: "config" });
    expectAllowed(fake, [TAG]);
  });

  it("c-WR-04: a base image that moved during the build is failed, named, and never touched", async () => {
    const fake = fakeDaemon();
    const f = flow(fake, { build: { code: 0, watchdogFired: false, baseAfter: "sha256:newbase" } });
    const result = await runImageCheck("runner", f.deps);
    expect(result).toMatchObject({
      state: "failed",
      cause: "base-image",
      baseImageBefore: "sha256:base",
      baseImageAfter: "sha256:newbase",
    });
    expect(result.evidence).toContain("node:22-alpine");
    expect(result.evidence).toContain("sha256:base");
    expect(result.evidence).toContain("sha256:newbase");
    expectAllowed(fake, [TAG]);
    expect(fake.images.get("node:22-alpine")?.id).toBe("sha256:newbase");
  });

  it("c-WR-04: a base image that was absent and then pulled by the build is failed", async () => {
    const fake = fakeDaemon();
    fake.images.delete("node:22-alpine");
    const f = flow(fake, { build: { code: 0, watchdogFired: false, baseAfter: "sha256:pulled" } });
    const result = await runImageCheck("runner", f.deps);
    expect(result).toMatchObject({
      state: "failed",
      cause: "base-image",
      baseImageBefore: "absent",
      baseImageAfter: "sha256:pulled",
    });
    expect(result.evidence).toContain("node:22-alpine");
    expectAllowed(fake, [TAG]);
    expect(fake.images.has("node:22-alpine")).toBe(true);
  });

  it("c-WR-04: an unchanged base image passes with before and after recorded", async () => {
    const fake = fakeDaemon();
    const result = await runImageCheck("runner", flow(fake).deps);
    expect(result).toMatchObject({
      state: "passed",
      baseImageBefore: "sha256:base",
      baseImageAfter: "sha256:base",
    });
  });

  it("c-IN-04: a build that exits 0 without producing its tag is failed/build, not blocked", async () => {
    const fake = fakeDaemon();
    const f = flow(fake, { build: { code: 0, watchdogFired: false, noImage: true } });
    const result = await runImageCheck("runner", f.deps);
    expect(result).toMatchObject({ state: "failed", cause: "build", imageId: null });
    expect(result.evidence).toContain(`build exited 0 but ${TAG} is absent`);
    expectAllowed(fake, []);
  });

  it("R2-8: the result and teardown lines are printed exactly once each", async () => {
    const fake = fakeDaemon();
    const f = flow(fake);
    await runImageCheck("builder", f.deps);
    expect(f.lines.filter((l) => l.startsWith(RESULT_PREFIX))).toHaveLength(1);
    expect(f.lines.filter((l) => l.startsWith(TEARDOWN_PREFIX))).toHaveLength(1);
  });
});

describe("defaults", () => {
  it("J: the real steps are J1's own runBuildPreflight, acquireLock and recordResource", () => {
    expect(DEFAULT_STEPS.preflight).toBe(runBuildPreflight);
    expect(DEFAULT_STEPS.lock).toBe(acquireLock);
    expect(DEFAULT_STEPS.record).toBe(recordResource);
  });
});

// --- --verify ------------------------------------------------------------------------------

function result(overrides: Partial<ImageCheckResult> = {}): ImageCheckResult {
  return {
    target: "runner",
    tag: TAG,
    runId: RUN,
    state: "blocked",
    cause: "space",
    evidence: VM_SPACE,
    imageId: null,
    user: null,
    env: [],
    labels: {},
    baseImageBefore: "sha256:base",
    baseImageAfter: null,
    runDir: "/tmp/x",
    ...overrides,
  };
}
function teardown(overrides: Record<string, unknown> = {}) {
  return {
    created: false,
    removed: [],
    gone: [],
    skipped: [],
    notOurs: [],
    leftAlone: [],
    failed: [],
    remaining: [],
    runId: RUN,
    ...overrides,
  };
}
const log = (r: ImageCheckResult, t: Record<string, unknown> = teardown()) =>
  `noise\n${TEARDOWN_PREFIX}${JSON.stringify(t)}\n${RESULT_PREFIX}${JSON.stringify(r)}\n`;
const PASSED = result({
  state: "passed",
  cause: "none",
  evidence: "",
  imageId: "sha256:built",
  user: "node",
  env: ["NEXT_TELEMETRY_DISABLED=1", "CHECKPOINT_DISABLE=1"],
  labels: { "aida.test": "1", "aida.test.run": RUN },
  // A passed run records the base image after the build too (c-WR-04).
  baseImageAfter: "sha256:base",
});

describe("verifyImageCheckLog", () => {
  it("R2-8: blocked/space with J1's text and exit 3 is accepted as blocked (space)", () => {
    const v = verifyImageCheckLog(log(result()), 3, "runner");
    expect(v.ok).toBe(true);
    expect(v.line).toContain('word="blocked (space)"');
  });
  it("R2-8: the same with exit 1 is refused", () => {
    expect(verifyImageCheckLog(log(result()), 1, "runner").ok).toBe(false);
  });
  it("R2-8: a failed result is refused", () => {
    const v = verifyImageCheckLog(log(result({ state: "failed", cause: "build" })), 1, "runner");
    expect(v).toMatchObject({ ok: false });
    expect(v.line).toMatch(/^IMAGE-CHECK-VERIFY FAILED: /);
  });
  it("R2-8: passed with the tag removed and exit 0 is accepted as passed", () => {
    const v = verifyImageCheckLog(
      log(PASSED, teardown({ created: true, removed: [TAG] })),
      0,
      "runner",
    );
    expect(v.ok).toBe(true);
    expect(v.line).toContain('word="passed"');
  });
  it("c-WR-04: passed with base image IDs that differ is refused", () => {
    const moved = { ...PASSED, baseImageAfter: "sha256:other" };
    const v = verifyImageCheckLog(
      log(moved, teardown({ created: true, removed: [TAG] })),
      0,
      "runner",
    );
    expect(v.ok).toBe(false);
    expect(v.line).toContain("node:22-alpine");
  });
  it("c-WR-04: passed without a recorded base image ID after the build is refused", () => {
    const none = { ...PASSED, baseImageAfter: null };
    expect(
      verifyImageCheckLog(log(none, teardown({ created: true, removed: [TAG] })), 0, "runner").ok,
    ).toBe(false);
  });
  it("R2-8: passed without the removal is refused", () => {
    expect(verifyImageCheckLog(log(PASSED, teardown({ created: true })), 0, "runner").ok).toBe(
      false,
    );
  });
  it("R2-8: two result lines are refused", () => {
    const twice = `${log(result())}${RESULT_PREFIX}${JSON.stringify(result())}\n`;
    expect(verifyImageCheckLog(twice, 3, "runner").ok).toBe(false);
  });
  it("R2-8: a log without a teardown line is refused", () => {
    expect(
      verifyImageCheckLog(`${RESULT_PREFIX}${JSON.stringify(result())}\n`, 3, "runner").ok,
    ).toBe(false);
  });
  it("R2-8: blocked with empty evidence is refused", () => {
    expect(
      verifyImageCheckLog(log(result({ cause: "measure", evidence: "" })), 3, "runner").ok,
    ).toBe(false);
  });
  it("R2-8: cause space without J1's text or no space left on device is refused", () => {
    expect(verifyImageCheckLog(log(result({ evidence: "disk is full" })), 3, "runner").ok).toBe(
      false,
    );
  });
  it("R2-8: a non-empty leftAlone is refused", () => {
    expect(
      verifyImageCheckLog(log(result(), teardown({ leftAlone: [`${TAG} now x`] })), 3, "runner").ok,
    ).toBe(false);
  });
  it("R2-8: a non-empty remaining is refused", () => {
    expect(verifyImageCheckLog(log(result(), teardown({ remaining: [TAG] })), 3, "runner").ok).toBe(
      false,
    );
  });
  it("R2-8: a teardown with created false that removed something is refused", () => {
    expect(verifyImageCheckLog(log(result(), teardown({ removed: [TAG] })), 3, "runner").ok).toBe(
      false,
    );
  });
  it("R2-8: another target is refused", () => {
    expect(verifyImageCheckLog(log(result()), 3, "builder").ok).toBe(false);
  });
  it("R2-8: not run/lock with exit 4 is accepted as not run (parked: lock)", () => {
    const v = verifyImageCheckLog(
      log(result({ state: "not run", cause: "lock", evidence: "Lock x is held" })),
      4,
      "runner",
    );
    expect(v.ok).toBe(true);
    expect(v.line).toContain('word="not run (parked: lock)"');
  });
  it("R2-8: blocked/measure with exit 3 is accepted as blocked (with evidence)", () => {
    const v = verifyImageCheckLog(
      log(result({ cause: "measure", evidence: "Could not measure free space" })),
      3,
      "runner",
    );
    expect(v.ok).toBe(true);
    expect(v.line).toContain('word="blocked (with evidence)"');
  });
  it("R2-8: the exit codes per state are 0, 1, 3 and 4", () => {
    expect(EXIT_CODES).toEqual({ passed: 0, failed: 1, blocked: 3, "not run": 4 });
  });
  it("R2-8: the summary words never conflate states", () => {
    expect(summaryWord("passed", "none")).toBe("passed");
    expect(summaryWord("blocked", "space")).toBe("blocked (space)");
    expect(summaryWord("blocked", "docker")).toBe("blocked (with evidence)");
    expect(summaryWord("not run", "foreign")).toBe("not run (parked: foreign)");
    expect(summaryWord("failed", "build")).toBe("failed");
  });
});
