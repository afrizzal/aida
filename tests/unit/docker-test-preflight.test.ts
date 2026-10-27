import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { newRunId } from "../support/docker-test-labels";
import {
  acquireLock,
  assertComposeFollowsRuleJ,
  assertEnoughSpace,
  assertNamesAbsent,
  assertProjectAbsent,
  assertSubnetFree,
  assertTagsFree,
  type ComposeConfig,
  cidrOverlaps,
  composeResourceNames,
  type Docker,
  DockerPreflightError,
  dockerFreeBytes,
  hostFreeBytes,
  lockPath,
  MIN_FREE_BYTES,
  parseDfAvailable,
  parseDfAvailableBytes,
  tagState,
} from "../support/docker-test-preflight";

const RUN = newRunId(1_700_000_000_000, Buffer.from("0011223344556677", "hex"));
const SOCKET_DOWN =
  "failed to connect to the docker API at unix:///x/docker.sock; check if the path is correct and if the daemon is running: dial unix /x/docker.sock: connect: no such file or directory";
const noRecord = () => {};
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
  const header = "Filesystem 1024-blocks Used Available Capacity Mounted on";
  const df = `${header}\noverlay 41152736 12000000 27000000 31% /\n`;
  const df2 = `${header}\noverlay 41152736 12000000 27000000 31% /\n/dev/vdb1 41152736 30000000 9000000 77% /aida-docker-root\n`;

  test("reads the available column of df -Pk in bytes", () => {
    expect(parseDfAvailableBytes(df)).toBe(27_000_000 * 1024);
    expect(parseDfAvailable(df2)).toEqual([27_000_000 * 1024, 9_000_000 * 1024]);
  });

  test("refuses df output it cannot read, including a bad column under a good header", () => {
    expect(() => parseDfAvailableBytes("")).toThrow(DockerPreflightError);
    expect(() => parseDfAvailableBytes(header)).toThrow(DockerPreflightError);
    expect(() => parseDfAvailableBytes(`${header}\noverlay 1 2 x 3% /`)).toThrow(/df row/);
    expect(() => parseDfAvailable(`${header}\noverlay 1 2 3 4% /\nbroken row`)).toThrow(/df row/);
    expect(() => parseDfAvailableBytes(df2)).toThrow(/one df row/);
  });

  test("20 GiB passes; anything below, or unreadable, stops", () => {
    expect(() => assertEnoughSpace("host", MIN_FREE_BYTES)).not.toThrow();
    expect(MIN_FREE_BYTES).toBe(20 * GIB);
    expect(() => assertEnoughSpace("host", MIN_FREE_BYTES - 1)).toThrow(/below the 20.0 GiB/);
    expect(() => assertEnoughSpace("host", Number.NaN)).toThrow(DockerPreflightError);
  });

  test("measures the host with statfs and takes the smallest directory", () => {
    const sizes: Record<string, number> = { "/home": 50, "/repo": 30, "/other": 40 };
    const statfs = (dir: string) => ({ bavail: sizes[dir], bsize: GIB });
    expect(hostFreeBytes(["/home", "/repo", "/other"], statfs)).toBe(30 * GIB);
    expect(() => hostFreeBytes([], statfs)).toThrow(DockerPreflightError);
    expect(hostFreeBytes([os.tmpdir()])).toBeGreaterThan(0);
  });

  test("measures the VM at the container root and the read-only DockerRootDir, taking the smaller", () => {
    const { docker, calls } = scripted((args) =>
      args[0] === "info" ? { code: 0, stdout: "/var/lib/docker\n" } : { code: 0, stdout: df2 },
    );
    expect(dockerFreeBytes(docker, RUN, noRecord)).toBe(9_000_000 * 1024);
    const args = calls[1];
    expect(args.slice(0, 4)).toEqual(["run", "--rm", "--pull", "never"]);
    expect(args).toContain("--network");
    expect(args[args.indexOf("--name") + 1]).toMatch(
      new RegExp(`^aida-test-df-${RUN}-[0-9a-f]{6}$`),
    );
    expect(args).toContain("aida.test=1");
    expect(args).toContain(`aida.test.run=${RUN}`);
    expect(args[args.indexOf("--mount") + 1]).toBe(
      "type=bind,source=/var/lib/docker,target=/aida-docker-root,readonly",
    );
    expect(args.slice(-3)).toEqual(["-Pk", "/", "/aida-docker-root"]);
  });

  test("a failed or partial probe stops instead of assuming space", () => {
    const noInfo = scripted(() => ({ code: 1, stderr: "daemon down" }));
    expect(() => dockerFreeBytes(noInfo.docker, RUN, noRecord)).toThrow(/Docker root directory/);
    const noImage = scripted((args) =>
      args[0] === "info"
        ? { code: 0, stdout: "/var/lib/docker" }
        : { code: 125, stderr: "Unable to find image" },
    );
    expect(() => dockerFreeBytes(noImage.docker, RUN, noRecord)).toThrow(/nothing is pulled/);
    const oneRow = scripted((args) =>
      args[0] === "info" ? { code: 0, stdout: "/var/lib/docker" } : { code: 0, stdout: df },
    );
    expect(() => dockerFreeBytes(oneRow.docker, RUN, noRecord)).toThrow(/two df rows/);
  });
});

describe("physical names", () => {
  test("stops when a network or volume with the exact name exists, whatever its labels", () => {
    const answers: Record<string, { code: number; stderr?: string }> = {
      "network free": { code: 1, stderr: "Error response from daemon: network free not found" },
      "volume free-vol": {
        code: 1,
        stderr: "Error response from daemon: get free-vol: no such volume",
      },
      "network taken": { code: 0 },
      "volume broken": { code: 1, stderr: "permission denied" },
      "network down": { code: 1, stderr: SOCKET_DOWN },
      "network other": {
        code: 1,
        stderr: "Error response from daemon: network another-name not found",
      },
    };
    const { docker } = scripted(
      (args) => answers[`${args[0]} ${args[args.length - 1]}`] ?? { code: 9 },
    );
    expect(() =>
      assertNamesAbsent(docker, { networks: ["free"], volumes: ["free-vol"] }),
    ).not.toThrow();
    expect(() => assertNamesAbsent(docker, { networks: ["taken"] })).toThrow(
      /named taken already exists/,
    );
    expect(() => assertNamesAbsent(docker, { volumes: ["broken"] })).toThrow(/Cannot tell/);
    // A socket that cannot be reached, or a "not found" for a different name, is not "absent".
    expect(() => assertNamesAbsent(docker, { networks: ["down"] })).toThrow(/Cannot tell/);
    expect(() => assertNamesAbsent(docker, { networks: ["other"] })).toThrow(/Cannot tell/);
  });

  test("reads the physical names Compose resolved", () => {
    expect(
      composeResourceNames({
        networks: { egress_internal: { name: "aida-test-egress_egress_internal" } },
        volumes: { uploads_data: { name: "aida-test-egress_uploads_data" }, bare: {} },
      }),
    ).toEqual({
      networks: ["aida-test-egress_egress_internal"],
      volumes: ["aida-test-egress_uploads_data", "bare"],
    });
  });
});

describe("image tags", () => {
  test("distinguishes a free tag, a taken tag, and an unknown daemon error", () => {
    const { docker } = scripted((args) => {
      const ref = args[args.length - 1];
      if (ref === "taken:1") return { code: 0, stdout: "sha256:abc" };
      if (ref === "free:1")
        return { code: 1, stderr: "Error response from daemon: No such image: free:1" };
      if (ref === "down:1") return { code: 1, stderr: SOCKET_DOWN };
      return { code: 1, stderr: "Cannot connect to the Docker daemon" };
    });
    expect(tagState(docker, "taken:1")).toBe("taken");
    expect(tagState(docker, "free:1")).toBe("free");
    expect(() => tagState(docker, "broken:1")).toThrow(/Cannot tell/);
    expect(() => tagState(docker, "down:1")).toThrow(/Cannot tell/);
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
