// Checks a test suite runs before it builds images or starts a compose project (run charter
// rule J, run decisions K108, K109, K111, K112 and K113 in .planning/run-loop/J1-RENCANA.md).
// Every check throws DockerPreflightError instead of guessing: the suite stops and reports.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  dockerNotFound,
  RUN_LABEL,
  recordResource,
  TEST_LABEL,
  TEST_NAME_PREFIX,
  testResourceName,
} from "./docker-test-labels";

/** Rule J says "20 GB"; read strictly as 20 GiB (K112). */
export const MIN_FREE_BYTES = 20 * 1024 ** 3;

/** Image for the one-off container that measures free space inside the Docker VM. */
export const SPACE_PROBE_IMAGE = "node:22-alpine";

const POSTGRES_DATA_DIR = "/var/lib/postgresql/data";

export class DockerPreflightError extends Error {
  override name = "DockerPreflightError";
}

export interface DockerResult {
  code: number;
  stdout: string;
  stderr: string;
}
export type Docker = (args: string[]) => DockerResult;

export const runDocker: Docker = (args) => {
  try {
    const stdout = execFileSync("docker", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 32 * 1024 * 1024,
    });
    return { code: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status?: number | null; stdout?: string; stderr?: string; message?: string };
    return { code: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? e.message ?? "" };
  }
};

function gib(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
}

// --- Free space (K112) ------------------------------------------------------------------------

/** Available bytes of every data row of `df -Pk <paths...>` (POSIX: 1024-byte blocks, column 4). */
export function parseDfAvailable(output: string): number[] {
  const rows = output.trim().split("\n").slice(1);
  if (rows.length === 0) {
    throw new DockerPreflightError(
      `Cannot read free space from df output: ${JSON.stringify(output)}`,
    );
  }
  return rows.map((row) => {
    const availableKb = Number(row.trim().split(/\s+/)[3]);
    if (!Number.isFinite(availableKb) || availableKb < 0 || row.trim() === "") {
      throw new DockerPreflightError(`Cannot read free space from df row: ${JSON.stringify(row)}`);
    }
    return availableKb * 1024;
  });
}

/** Available bytes from single-path `df -Pk <path>` output. */
export function parseDfAvailableBytes(output: string): number {
  const values = parseDfAvailable(output);
  if (values.length !== 1) {
    throw new DockerPreflightError(
      `Expected one df row, got ${values.length}: ${JSON.stringify(output)}`,
    );
  }
  return values[0];
}

export function assertEnoughSpace(
  where: string,
  bytes: number,
  min: number = MIN_FREE_BYTES,
): void {
  if (!(bytes >= min)) {
    throw new DockerPreflightError(
      `Free space on ${where} is ${gib(bytes)}, below the ${gib(min)} rule J requires before an image build. Stopped; report to the owner.`,
    );
  }
}

/**
 * Smallest free space across the host directories. On macOS the Colima VM disk lives in the
 * home directory's filesystem, so measuring the home directory covers it without reading
 * `~/.colima` (rule J forbids touching it).
 */
export function hostFreeBytes(
  dirs: string[],
  statfs: (dir: string) => { bavail: number | bigint; bsize: number | bigint } = fs.statfsSync,
): number {
  if (dirs.length === 0) throw new DockerPreflightError("No host directory to measure");
  return Math.min(
    ...dirs.map((dir) => {
      const stats = statfs(dir);
      return Number(stats.bavail) * Number(stats.bsize);
    }),
  );
}

/** The daemon's DockerRootDir, from `docker info`. */
export function dockerRootDir(docker: Docker): string {
  const result = docker(["info", "--format", "{{.DockerRootDir}}"]);
  const dir = result.stdout.trim();
  if (result.code !== 0 || !dir.startsWith("/") || /[,\s]/.test(dir)) {
    throw new DockerPreflightError(
      `Cannot read the Docker root directory: ${JSON.stringify(dir)} ${result.stderr.trim()}`,
    );
  }
  return dir;
}

/**
 * Free space inside the Docker VM, measured from a one-off container in two places and taking
 * the smaller (K118): the container's own root (where image snapshots and layers live) and the
 * daemon's DockerRootDir, bind-mounted read-only. Both must be readable, or the check stops.
 */
export function dockerFreeBytes(
  docker: Docker,
  runId: string,
  record: typeof recordResource = recordResource,
): number {
  const root = dockerRootDir(docker);
  const name = testResourceName("df", runId);
  record(runId, { type: "container", name, state: "planned" });
  const result = docker([
    "run",
    "--rm",
    "--pull",
    "never",
    "--network",
    "none",
    "--name",
    name,
    "--label",
    `${TEST_LABEL}=1`,
    "--label",
    `${RUN_LABEL}=${runId}`,
    "--mount",
    `type=bind,source=${root},target=/aida-docker-root,readonly`,
    "--entrypoint",
    "df",
    SPACE_PROBE_IMAGE,
    "-Pk",
    "/",
    "/aida-docker-root",
  ]);
  if (result.code !== 0) {
    throw new DockerPreflightError(
      `Could not measure free space in the Docker VM (${SPACE_PROBE_IMAGE} must already be present; nothing is pulled): ${result.stderr.trim()}`,
    );
  }
  const values = parseDfAvailable(result.stdout);
  if (values.length !== 2) {
    throw new DockerPreflightError(
      `Expected two df rows from the space probe, got ${values.length}`,
    );
  }
  return Math.min(...values);
}

// --- Image tags (K111) ------------------------------------------------------------------------

export function tagState(docker: Docker, ref: string): "free" | "taken" {
  const result = docker(["image", "inspect", "--format", "{{.Id}}", ref]);
  if (result.code === 0) return "taken";
  if (dockerNotFound("image", ref, result.stderr)) return "free";
  throw new DockerPreflightError(
    `Cannot tell whether image tag ${ref} exists: ${result.stderr.trim()}`,
  );
}

export function assertTagsFree(docker: Docker, refs: string[]): void {
  const taken = refs.filter((ref) => tagState(docker, ref) === "taken");
  if (taken.length > 0) {
    throw new DockerPreflightError(
      `Image tag(s) already exist and must not be overwritten (rule J): ${taken.join(", ")}`,
    );
  }
}

// --- Compose project (K108) -------------------------------------------------------------------

export function assertProjectAbsent(docker: Docker, project: string): void {
  const filter = `label=com.docker.compose.project=${project}`;
  const listings: [string, string[]][] = [
    ["container", ["ps", "-a", "-q", "--filter", filter]],
    ["network", ["network", "ls", "-q", "--filter", filter]],
    ["volume", ["volume", "ls", "-q", "--filter", filter]],
  ];
  for (const [type, args] of listings) {
    const result = docker(args);
    if (result.code !== 0) {
      throw new DockerPreflightError(
        `Cannot list ${type}s of project ${project}: ${result.stderr.trim()}`,
      );
    }
    if (result.stdout.trim() !== "") {
      throw new DockerPreflightError(
        `Compose project ${project} already has a ${type}. Another run may be using it; stopped without touching it.`,
      );
    }
  }
}

/**
 * Stops when a network or volume with one of these exact names already exists, whatever its
 * labels: the suite must not adopt or overwrite a resource it did not create (K115).
 */
export function assertNamesAbsent(
  docker: Docker,
  names: { networks?: string[]; volumes?: string[] },
): void {
  const checks: [string, string][] = [
    ...(names.networks ?? []).map((name): [string, string] => ["network", name]),
    ...(names.volumes ?? []).map((name): [string, string] => ["volume", name]),
  ];
  for (const [type, name] of checks) {
    const result = docker([type, "inspect", "--format", "{{.Name}}", name]);
    if (result.code === 0) {
      throw new DockerPreflightError(
        `A ${type} named ${name} already exists. Stopped without touching it.`,
      );
    }
    if (!dockerNotFound(type === "network" ? "network" : "volume", name, result.stderr)) {
      throw new DockerPreflightError(
        `Cannot tell whether ${type} ${name} exists: ${result.stderr.trim()}`,
      );
    }
  }
}

// --- Subnet (K113) ----------------------------------------------------------------------------

function ipv4Range(cidr: string): [number, number] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(cidr.trim());
  if (!match) return null;
  const octets = match.slice(1, 5).map(Number);
  const bits = Number(match[5]);
  if (octets.some((o) => o > 255) || bits > 32) return null;
  const address = octets.reduce((acc, o) => acc * 256 + o, 0);
  const size = 2 ** (32 - bits);
  const start = Math.floor(address / size) * size;
  return [start, start + size - 1];
}

/** True when two IPv4 CIDR ranges share an address. Anything else (IPv6, malformed) is false. */
export function cidrOverlaps(a: string, b: string): boolean {
  const ra = ipv4Range(a);
  const rb = ipv4Range(b);
  if (!ra || !rb) return false;
  return ra[0] <= rb[1] && rb[0] <= ra[1];
}

export function assertSubnetFree(docker: Docker, subnet: string): void {
  const ids = docker(["network", "ls", "-q"]);
  if (ids.code !== 0) throw new DockerPreflightError(`Cannot list networks: ${ids.stderr.trim()}`);
  const list = ids.stdout.trim().split("\n").filter(Boolean);
  if (list.length === 0) return;
  const inspected = docker([
    "network",
    "inspect",
    "--format",
    "{{.Name}}|{{range .IPAM.Config}}{{.Subnet}},{{end}}",
    ...list,
  ]);
  if (inspected.code !== 0) {
    throw new DockerPreflightError(`Cannot inspect networks: ${inspected.stderr.trim()}`);
  }
  for (const line of inspected.stdout.trim().split("\n").filter(Boolean)) {
    const [name, subnets = ""] = line.split("|");
    for (const other of subnets.split(",").filter(Boolean)) {
      if (cidrOverlaps(subnet, other)) {
        throw new DockerPreflightError(
          `Subnet ${subnet} overlaps network ${name} (${other}). Stopped without changing that network.`,
        );
      }
    }
  }
}

// --- Lock (K111) ------------------------------------------------------------------------------

export function lockPath(tmpDir: string = os.tmpdir()): string {
  return path.join(tmpDir, "aida-test-docker.lock");
}

/**
 * Takes the exclusive lock that serializes image-building suites. Returns the release function.
 * A lock left by a crashed run is reported, never removed automatically.
 */
export function acquireLock(runId: string, tmpDir: string = os.tmpdir()): () => void {
  const file = lockPath(tmpDir);
  try {
    fs.writeFileSync(
      file,
      JSON.stringify({ runId, pid: process.pid, at: new Date().toISOString() }),
      {
        flag: "wx",
      },
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    const holder = fs.readFileSync(file, "utf8");
    throw new DockerPreflightError(
      `Lock ${file} is held (${holder}). If that run is gone, the lock is stale; it is not removed automatically. Report to the owner.`,
    );
  }
  return () => {
    try {
      const holder = JSON.parse(fs.readFileSync(file, "utf8")) as { runId?: string };
      if (holder.runId === runId) fs.unlinkSync(file);
    } catch {
      // Already gone or unreadable: never remove a lock this run cannot prove is its own.
    }
  };
}

// --- Compose file (K108, K109, K111) ----------------------------------------------------------

interface ComposeService {
  image?: string;
  labels?: Record<string, string>;
  build?: { labels?: Record<string, string>; tags?: string[] };
  tmpfs?: string[] | string;
  volumes?: { type?: string; source?: string; target?: string }[];
}
export interface ComposeConfig {
  services?: Record<string, ComposeService>;
  networks?: Record<string, { name?: string; labels?: Record<string, string>; external?: boolean }>;
  volumes?: Record<string, { name?: string; labels?: Record<string, string>; external?: boolean }>;
}

/** The physical network and volume names Compose will create for this config. */
export function composeResourceNames(config: ComposeConfig): {
  networks: string[];
  volumes: string[];
} {
  const names = (entries: Record<string, { name?: string }> | undefined): string[] =>
    Object.entries(entries ?? {}).map(([key, entry]) => entry.name ?? key);
  return { networks: names(config.networks), volumes: names(config.volumes) };
}

function hasRunLabels(labels: Record<string, string> | undefined, runId: string): boolean {
  return labels?.[TEST_LABEL] === "1" && labels?.[RUN_LABEL] === runId;
}

/**
 * Checks the resolved `docker compose config --format json` of a test project: every service,
 * build, network and volume carries the run's labels; every built image has the tag
 * `<project>-<service>:<runId>`; no anonymous volume; Postgres data on tmpfs. Returns the built
 * image tags.
 */
export function assertComposeFollowsRuleJ(
  config: ComposeConfig,
  project: string,
  runId: string,
): string[] {
  const problems: string[] = [];
  if (!project.startsWith(TEST_NAME_PREFIX))
    problems.push(`project ${project} lacks ${TEST_NAME_PREFIX}`);
  const tags: string[] = [];
  for (const [name, service] of Object.entries(config.services ?? {})) {
    if (!hasRunLabels(service.labels, runId)) problems.push(`service ${name} lacks the run labels`);
    if (service.build) {
      // Extra build tags would be written by `compose build` without the tag check (review J1).
      if ((service.build.tags ?? []).length > 0)
        problems.push(`build of ${name} sets extra tags: ${(service.build.tags ?? []).join(", ")}`);
      if (!hasRunLabels(service.build.labels, runId))
        problems.push(`build of ${name} lacks the run labels`);
      const expected = `${project}-${name}:${runId}`;
      if (service.image !== expected)
        problems.push(`service ${name} image is ${service.image}, expected ${expected}`);
      else tags.push(expected);
    }
    for (const mount of service.volumes ?? []) {
      if (mount.type === "volume" && !mount.source) {
        problems.push(`service ${name} has an anonymous volume at ${mount.target}`);
      }
    }
    if (service.image?.startsWith("pgvector/pgvector")) {
      const tmpfs = Array.isArray(service.tmpfs) ? service.tmpfs : [service.tmpfs ?? ""];
      if (!tmpfs.some((entry) => entry.split(":")[0] === POSTGRES_DATA_DIR)) {
        problems.push(`service ${name} keeps Postgres data in an anonymous volume, not tmpfs`);
      }
    }
  }
  for (const [kind, entries] of [
    ["network", config.networks],
    ["volume", config.volumes],
  ] as const) {
    for (const [name, entry] of Object.entries(entries ?? {})) {
      if (entry.external) problems.push(`${kind} ${name} is external`);
      else if (!hasRunLabels(entry.labels, runId))
        problems.push(`${kind} ${name} lacks the run labels`);
    }
  }
  if (problems.length > 0) {
    throw new DockerPreflightError(
      `Compose project ${project} breaks rule J:\n- ${problems.join("\n- ")}`,
    );
  }
  return tags;
}

// --- All checks before a build ----------------------------------------------------------------

export interface PreflightOptions {
  runId: string;
  project: string;
  tags: string[];
  subnet?: string;
  hostDirs: string[];
  /** Physical names the project will create; any existing one stops the build (K115). */
  networkNames?: string[];
  volumeNames?: string[];
}

export function runBuildPreflight(docker: Docker, options: PreflightOptions): void {
  assertProjectAbsent(docker, options.project);
  assertNamesAbsent(docker, { networks: options.networkNames, volumes: options.volumeNames });
  assertTagsFree(docker, options.tags);
  if (options.subnet) assertSubnetFree(docker, options.subnet);
  assertEnoughSpace("the host", hostFreeBytes(options.hostDirs));
  assertEnoughSpace("the Docker VM", dockerFreeBytes(docker, options.runId));
}
