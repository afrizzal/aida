import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { newRunId } from "../support/docker-test-labels";
import {
  acquireLock,
  assertComposeFollowsRuleJ,
  assertEnoughSpace,
  assertProjectAbsent,
  assertSubnetFree,
  assertTagsFree,
  type ComposeConfig,
  cidrOverlaps,
  type Docker,
  DockerPreflightError,
  dockerFreeBytes,
  hostFreeBytes,
  lockPath,
  MIN_FREE_BYTES,
  parseDfAvailableBytes,
  tagState,
} from "../support/docker-test-preflight";

const RUN = newRunId(1_700_000_000_000, Buffer.from("0011223344556677", "hex"));
const GIB = 1024 ** 3;

function scripted(answers: (args: string[]) => { code: number; stdout?: string; stderr?: string }) {
  const calls: string[][] = [];
  const docker: Docker = (args) => {
    calls.push(args);
    const answer = answers(args);
    return { code: answer.code, stdout: answer.stdout ?? "", stderr: answer.stderr ?? "" };
  };
  return { docker, calls };
}

describe("free space", () => {
  const df =
    "Filesystem 1024-blocks Used Available Capacity Mounted on\noverlay 41152736 12000000 27000000 31% /\n";

  test("reads the available column of df -Pk in bytes", () => {
    expect(parseDfAvailableBytes(df)).toBe(27_000_000 * 1024);
  });

  test("refuses df output it cannot read", () => {
    expect(() => parseDfAvailableBytes("")).toThrow(DockerPreflightError);
    expect(() => parseDfAvailableBytes("overlay 1 2 x 3% /")).toThrow(DockerPreflightError);
  });

  test("20 GiB passes; anything below, or unreadable, stops", () => {
    expect(() => assertEnoughSpace("host", MIN_FREE_BYTES)).not.toThrow();
    expect(MIN_FREE_BYTES).toBe(20 * GIB);
    expect(() => assertEnoughSpace("host", MIN_FREE_BYTES - 1)).toThrow(/below the 20.0 GiB/);
    expect(() => assertEnoughSpace("host", Number.NaN)).toThrow(DockerPreflightError);
  });

  test("measures the host with statfs, taking the smallest directory", () => {
    expect(hostFreeBytes([os.tmpdir(), os.homedir()])).toBeGreaterThan(0);
  });

  test("measures the Docker VM with a labelled, named, never-pulling one-off container", () => {
    const { docker, calls } = scripted(() => ({ code: 0, stdout: df }));
    expect(dockerFreeBytes(docker, RUN)).toBe(27_000_000 * 1024);
    const args = calls[0];
    expect(args.slice(0, 4)).toEqual(["run", "--rm", "--pull", "never"]);
    expect(args).toContain("--network");
    expect(args[args.indexOf("--name") + 1]).toMatch(
      new RegExp(`^aida-test-df-${RUN}-[0-9a-f]{6}$`),
    );
    expect(args).toContain("aida.test=1");
    expect(args).toContain(`aida.test.run=${RUN}`);
  });

  test("a failed probe stops instead of assuming space", () => {
    const { docker } = scripted(() => ({ code: 125, stderr: "Unable to find image" }));
    expect(() => dockerFreeBytes(docker, RUN)).toThrow(/nothing is pulled/);
  });
});

describe("image tags", () => {
  test("distinguishes a free tag, a taken tag, and an unknown daemon error", () => {
    const { docker } = scripted((args) => {
      const ref = args[args.length - 1];
      if (ref === "taken:1") return { code: 0, stdout: "sha256:abc" };
      if (ref === "free:1") return { code: 1, stderr: "Error: No such image: free:1" };
      return { code: 1, stderr: "Cannot connect to the Docker daemon" };
    });
    expect(tagState(docker, "taken:1")).toBe("taken");
    expect(tagState(docker, "free:1")).toBe("free");
    expect(() => tagState(docker, "broken:1")).toThrow(/Cannot tell/);
    expect(() => assertTagsFree(docker, ["free:1", "taken:1"])).toThrow(/taken:1/);
    expect(() => assertTagsFree(docker, ["free:1"])).not.toThrow();
  });
});

describe("compose project", () => {
  test("passes only when the project has no container, network or volume", () => {
    expect(() =>
      assertProjectAbsent(scripted(() => ({ code: 0 })).docker, "aida-test-egress"),
    ).not.toThrow();
    const busy = scripted((args) => ({ code: 0, stdout: args[0] === "network" ? "n1\n" : "" }));
    expect(() => assertProjectAbsent(busy.docker, "aida-test-egress")).toThrow(
      /already has a network/,
    );
    const broken = scripted(() => ({ code: 1, stderr: "daemon down" }));
    expect(() => assertProjectAbsent(broken.docker, "aida-test-egress")).toThrow(/Cannot list/);
  });
});

describe("subnet", () => {
  test("IPv4 overlap", () => {
    expect(cidrOverlaps("10.90.0.0/24", "10.90.0.128/25")).toBe(true);
    expect(cidrOverlaps("10.90.0.0/24", "10.0.0.0/8")).toBe(true);
    expect(cidrOverlaps("10.90.0.0/24", "10.90.1.0/24")).toBe(false);
    expect(cidrOverlaps("10.90.0.0/24", "172.17.0.0/16")).toBe(false);
    expect(cidrOverlaps("10.90.0.0/24", "fd00::/64")).toBe(false);
  });

  test("stops when an existing network overlaps, naming it", () => {
    const { docker } = scripted((args) =>
      args[1] === "ls"
        ? { code: 0, stdout: "a\nb\n" }
        : { code: 0, stdout: "bridge|172.17.0.0/16,\nother-project_default|10.90.0.0/16,\n" },
    );
    expect(() => assertSubnetFree(docker, "10.90.0.0/24")).toThrow(/other-project_default/);
  });

  test("passes when nothing overlaps", () => {
    const { docker } = scripted((args) =>
      args[1] === "ls"
        ? { code: 0, stdout: "a\n" }
        : { code: 0, stdout: "bridge|172.17.0.0/16,\nhost|\n" },
    );
    expect(() => assertSubnetFree(docker, "10.90.0.0/24")).not.toThrow();
  });
});

describe("lock", () => {
  test("is exclusive, released only by its own run, and never cleared when stale", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aida-lock-test-"));
    try {
      const release = acquireLock(RUN, tmp);
      expect(() => acquireLock(RUN, tmp)).toThrow(/is held/);
      release();
      expect(fs.existsSync(lockPath(tmp))).toBe(false);

      const releaseA = acquireLock(RUN, tmp);
      fs.writeFileSync(lockPath(tmp), JSON.stringify({ runId: "someone-else" }));
      releaseA();
      expect(fs.existsSync(lockPath(tmp))).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("compose rule J check", () => {
  const labels = { "aida.test": "1", "aida.test.run": RUN };
  const valid = (): ComposeConfig => ({
    services: {
      app: { image: `aida-test-egress-app:${RUN}`, labels, build: { labels } },
      db: { image: "pgvector/pgvector:pg16", labels, tmpfs: ["/var/lib/postgresql/data"] },
      smtp: {
        image: "greenmail/standalone:latest",
        labels,
        volumes: [{ type: "bind", source: "/x", target: "/y" }],
      },
    },
    networks: { egress_internal: { labels } },
    volumes: { uploads_data: { labels } },
  });

  test("a compliant config returns the built image tags", () => {
    expect(assertComposeFollowsRuleJ(valid(), "aida-test-egress", RUN)).toEqual([
      `aida-test-egress-app:${RUN}`,
    ]);
  });

  const breakages: [string, (c: ComposeConfig) => void, RegExp][] = [
    [
      "service without labels",
      (c) => {
        if (c.services) c.services.db.labels = {};
      },
      /service db lacks/,
    ],
    [
      "build without labels",
      (c) => {
        if (c.services?.app.build) c.services.app.build.labels = undefined;
      },
      /build of app/,
    ],
    [
      "built image with a shared tag",
      (c) => {
        if (c.services) c.services.app.image = "aida-test-egress-app:latest";
      },
      /expected aida-test-egress-app/,
    ],
    [
      "anonymous volume",
      (c) => {
        if (c.services) c.services.smtp.volumes = [{ type: "volume", target: "/data" }];
      },
      /anonymous volume at \/data/,
    ],
    [
      "Postgres without tmpfs",
      (c) => {
        if (c.services) c.services.db.tmpfs = undefined;
      },
      /Postgres data/,
    ],
    [
      "network of another run",
      (c) => {
        if (c.networks)
          c.networks.egress_internal.labels = { "aida.test": "1", "aida.test.run": "x" };
      },
      /network egress_internal/,
    ],
    [
      "external volume",
      (c) => {
        if (c.volumes) c.volumes.uploads_data = { external: true };
      },
      /volume uploads_data is external/,
    ],
  ];
  for (const [what, breakIt, message] of breakages) {
    test(`refuses: ${what}`, () => {
      const config = valid();
      breakIt(config);
      expect(() => assertComposeFollowsRuleJ(config, "aida-test-egress", RUN)).toThrow(message);
    });
  }

  test("refuses a project name without the aida-test- prefix", () => {
    expect(() => assertComposeFollowsRuleJ(valid(), "aida-egress-test", RUN)).toThrow(
      /lacks aida-test-/,
    );
  });
});
