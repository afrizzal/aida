import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  dockerNotFound,
  isRunId,
  ledgerPath,
  newRunId,
  RUN_ID_ENV,
  recordResource,
  testLabels,
  testResourceName,
  testRunId,
} from "../support/docker-test-labels";

const RUN = newRunId(1_700_000_000_000, Buffer.from("0123456789abcdef", "hex"));

describe("run ids", () => {
  test("a new run id is base-36 time plus 16 hex characters", () => {
    expect(RUN).toBe(`${(1_700_000_000_000).toString(36)}-0123456789abcdef`);
    expect(isRunId(RUN)).toBe(true);
    expect(isRunId(newRunId())).toBe(true);
  });

  test("rejects malformed ids and the wrong amount of randomness", () => {
    expect(isRunId("")).toBe(false);
    expect(isRunId("abc-123")).toBe(false);
    expect(isRunId(`${RUN} `)).toBe(false);
    expect(isRunId("aida-test-x")).toBe(false);
    expect(() => newRunId(Date.now(), Buffer.alloc(4))).toThrow();
  });

  test("an inherited run id wins and a missing one is created once and stored", () => {
    const env: Record<string, string | undefined> = { [RUN_ID_ENV]: RUN };
    expect(testRunId(env)).toBe(RUN);

    const fresh: Record<string, string | undefined> = {};
    const created = testRunId(fresh);
    expect(isRunId(created)).toBe(true);
    expect(fresh[RUN_ID_ENV]).toBe(created);
    expect(testRunId(fresh)).toBe(created);
  });

  test("an invalid inherited run id is refused, not replaced", () => {
    expect(() => testRunId({ [RUN_ID_ENV]: "not-a-run" })).toThrow(/run id/);
  });
});

describe("labels and names", () => {
  test("labels carry the test marker and the run", () => {
    expect(testLabels(RUN)).toEqual({ "aida.test": "1", "aida.test.run": RUN });
    expect(() => testLabels("bad")).toThrow();
  });

  test("names start with aida-test-, carry the run, and differ per call", () => {
    const name = testResourceName("integration", RUN, Buffer.from("a1b2c3", "hex"));
    expect(name).toBe(`aida-test-integration-${RUN}-a1b2c3`);
    expect(testResourceName("e2e", RUN)).not.toBe(testResourceName("e2e", RUN));
  });

  test("a kind that could escape the prefix scheme is refused", () => {
    for (const kind of ["", "Integration", "a_b", "-x", "x-", "a/b", "../x"]) {
      expect(() => testResourceName(kind, RUN)).toThrow();
    }
  });
});

describe("ledger", () => {
  test("appends one JSON line per resource under the run's file", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aida-ledger-test-"));
    try {
      recordResource(RUN, { type: "container", name: "aida-test-x", state: "planned" }, tmp);
      recordResource(
        RUN,
        { type: "container", name: "aida-test-x", id: "c1", state: "created" },
        tmp,
      );
      const file = ledgerPath(RUN, tmp);
      expect(file).toBe(path.join(tmp, "aida-test-runs", `${RUN}.jsonl`));
      const entries = fs
        .readFileSync(file, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(entries.map((entry) => entry.state)).toEqual(["planned", "created"]);
      expect(entries[1]).toMatchObject({ type: "container", name: "aida-test-x", id: "c1" });
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("dockerNotFound (K123)", () => {
  const ref = "aida-test-x";
  test("recognises only the daemon's own not-found answer for that type and ref", () => {
    expect(
      dockerNotFound("container", ref, `Error response from daemon: No such container: ${ref}`),
    ).toBe(true);
    expect(
      dockerNotFound("network", ref, `Error response from daemon: network ${ref} not found`),
    ).toBe(true);
    expect(
      dockerNotFound("volume", ref, `Error response from daemon: get ${ref}: no such volume`),
    ).toBe(true);
    expect(
      dockerNotFound("image", `${ref}:1`, `Error response from daemon: No such image: ${ref}:1`),
    ).toBe(true);
  });

  test("a socket error, another ref, another type, or a prefix of the ref is not 'not found'", () => {
    const socket =
      "failed to connect to the docker API at unix:///x/docker.sock; check if the path is correct and if the daemon is running: dial unix /x/docker.sock: connect: no such file or directory";
    expect(dockerNotFound("container", ref, socket)).toBe(false);
    expect(
      dockerNotFound("container", ref, "Error response from daemon: No such container: other"),
    ).toBe(false);
    expect(
      dockerNotFound("network", ref, `Error response from daemon: No such container: ${ref}`),
    ).toBe(false);
    expect(
      dockerNotFound("volume", ref, `Error response from daemon: get ${ref}-2: no such volume`),
    ).toBe(false);
    expect(
      dockerNotFound("container", "a.b", "Error response from daemon: No such container: aXb"),
    ).toBe(false);
  });
});
