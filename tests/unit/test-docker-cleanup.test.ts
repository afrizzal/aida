import { describe, expect, test } from "vitest";
import {
  applyCleanup,
  belongsToRun,
  type DockerRunner,
  listOtherRuns,
  planCleanup,
} from "../../scripts/test-docker-cleanup";
import { newRunId } from "../support/docker-test-labels";

const RUN = newRunId(1_700_000_000_000, Buffer.from("00112233445566aa", "hex"));
const OTHER = newRunId(1_700_000_000_001, Buffer.from("ffeeddccbbaa9988", "hex"));

interface FakeResource {
  type: "container" | "network" | "volume" | "image";
  ref: string;
  name: string;
  labels: Record<string, string> | null;
}

/** A tiny in-memory Docker that answers the list, inspect and remove commands the script uses. */
function fakeDocker(resources: FakeResource[], options: { failRemove?: string[] } = {}) {
  const calls: string[][] = [];
  // Deep copy: a test that edits labels must not leak into the next test.
  const live = resources.map((r) => ({ ...r, labels: r.labels ? { ...r.labels } : null }));
  const typeOf = (args: string[]): FakeResource["type"] => {
    if (args[0] === "ps" || args[0] === "rm" || args[0] === "container") return "container";
    return args[0] as FakeResource["type"];
  };
  const runner: DockerRunner = (args) => {
    calls.push(args);
    const type = typeOf(args);
    const verb = args[0] === "ps" ? "ls" : args[0] === "rm" ? "rm" : args[1];
    if (verb === "ls") {
      const wanted = args
        .filter((_, i) => args[i - 1] === "--filter")
        .map((filter) => filter.replace(/^label=/, "").split("="));
      return live
        .filter((r) => r.type === type)
        .filter((r) => wanted.every(([key, value]) => r.labels?.[key] === value))
        .map((r) => r.ref)
        .join("\n");
    }
    const ref = args[args.length - 1];
    const found = live.find((r) => r.type === type && r.ref === ref);
    if (verb === "inspect") {
      if (!found) throw new Error(`No such ${type}: ${ref}`);
      const name = type === "container" ? `/${found.name}` : found.name;
      return JSON.stringify(
        type === "image" ? { labels: found.labels } : { name, labels: found.labels },
      );
    }
    if (verb === "rm") {
      if (options.failRemove?.includes(ref)) throw new Error(`cannot remove ${ref}`);
      if (!found) throw new Error(`No such ${type}: ${ref}`);
      live.splice(live.indexOf(found), 1);
      return "";
    }
    throw new Error(`unexpected docker call: ${args.join(" ")}`);
  };
  return { runner, calls, live };
}

const mine = { "aida.test": "1", "aida.test.run": RUN };
const theirs = { "aida.test": "1", "aida.test.run": OTHER };

const WORLD: FakeResource[] = [
  { type: "container", ref: "c-mine", name: `aida-test-integration-${RUN}-aaaaaa`, labels: mine },
  { type: "container", ref: "c-other-run", name: `aida-test-e2e-${OTHER}-bbbbbb`, labels: theirs },
  // Right labels, wrong name: someone else's container that copied the labels.
  { type: "container", ref: "c-wrong-name", name: "aida-dev-db", labels: mine },
  { type: "container", ref: "c-unlabelled", name: "aida-test-loose", labels: null },
  { type: "network", ref: "n-mine", name: "aida-test-egress_egress_internal", labels: mine },
  { type: "network", ref: "n-project", name: "mis-demo_default", labels: null },
  {
    type: "volume",
    ref: "aida-test-egress_uploads_data",
    name: "aida-test-egress_uploads_data",
    labels: mine,
  },
  { type: "volume", ref: "0123abcd", name: "0123abcd", labels: null },
  { type: "image", ref: `aida-test-egress-app:${RUN}`, name: "", labels: mine },
  { type: "image", ref: "node:22-alpine", name: "", labels: null },
  // Labelled for this run but not under the aida-test- repository prefix.
  { type: "image", ref: `aida:${RUN}`, name: "", labels: mine },
];

describe("planCleanup", () => {
  test("selects only resources with the test label, this run, and the aida-test- prefix", () => {
    const { runner } = fakeDocker(WORLD);
    const plan = planCleanup(runner, RUN);
    expect(plan.map((r) => `${r.type}:${r.ref}`)).toEqual([
      "container:c-mine",
      "network:n-mine",
      "volume:aida-test-egress_uploads_data",
      `image:aida-test-egress-app:${RUN}`,
    ]);
  });

  test("a dry run only lists and inspects; it never removes", () => {
    const { runner, calls } = fakeDocker(WORLD);
    planCleanup(runner, RUN);
    expect(calls.some((args) => args.includes("rm"))).toBe(false);
    expect(calls.some((args) => args.some((a) => a.includes("prune")))).toBe(false);
  });

  test("an invalid run id is refused before any docker call", () => {
    const { runner, calls } = fakeDocker(WORLD);
    expect(() => planCleanup(runner, "aida-test-")).toThrow();
    expect(calls).toEqual([]);
  });
});

describe("applyCleanup", () => {
  test("removes in order containers, networks, volumes, image tags, and leaves the rest", () => {
    const { runner, calls, live } = fakeDocker(WORLD);
    const result = applyCleanup(runner, RUN, planCleanup(runner, RUN));
    const removals = calls.filter((args) => args[0] === "rm" || args[1] === "rm");
    expect(removals).toEqual([
      ["rm", "-f", "c-mine"],
      ["network", "rm", "n-mine"],
      ["volume", "rm", "aida-test-egress_uploads_data"],
      ["image", "rm", `aida-test-egress-app:${RUN}`],
    ]);
    expect(result.failed).toEqual([]);
    expect(live.map((r) => r.ref)).toEqual([
      "c-other-run",
      "c-wrong-name",
      "c-unlabelled",
      "n-project",
      "0123abcd",
      "node:22-alpine",
      `aida:${RUN}`,
    ]);
  });

  test("never removes a container's anonymous volumes and never prunes", () => {
    const { runner, calls } = fakeDocker(WORLD);
    applyCleanup(runner, RUN, planCleanup(runner, RUN));
    expect(calls.some((args) => args[0] === "rm" && args.includes("-v"))).toBe(false);
    expect(calls.some((args) => args.some((a) => a.includes("prune")))).toBe(false);
  });

  test("re-checks each resource right before removal and skips one whose labels changed", () => {
    const { runner, calls, live } = fakeDocker(WORLD);
    const plan = planCleanup(runner, RUN);
    const container = live.find((r) => r.ref === "c-mine");
    if (container) container.labels = theirs;
    const result = applyCleanup(runner, RUN, plan);
    expect(result.skipped.map((s) => s.resource.ref)).toEqual(["c-mine"]);
    expect(calls).not.toContainEqual(["rm", "-f", "c-mine"]);
  });

  test("a failed removal is reported and the rest still runs", () => {
    const { runner } = fakeDocker(WORLD, { failRemove: ["n-mine"] });
    const result = applyCleanup(runner, RUN, planCleanup(runner, RUN));
    expect(result.failed.map((f) => f.resource.ref)).toEqual(["n-mine"]);
    expect(result.removed.map((r) => r.ref)).toEqual([
      "c-mine",
      "aida-test-egress_uploads_data",
      `aida-test-egress-app:${RUN}`,
    ]);
  });
});

describe("belongsToRun and listOtherRuns", () => {
  test("an image is matched on its repository, not its tag", () => {
    expect(
      belongsToRun(
        { type: "image", ref: `x:aida-test-${RUN}`, name: `x:aida-test-${RUN}`, labels: mine },
        RUN,
      ),
    ).toBe(false);
  });

  test("other runs are listed, never planned", () => {
    const { runner, calls } = fakeDocker(WORLD);
    const others = listOtherRuns(runner, RUN);
    expect(others.map((r) => r.ref)).toEqual(["c-other-run"]);
    expect(calls.some((args) => args[0] === "rm" || args[1] === "rm")).toBe(false);
  });
});
