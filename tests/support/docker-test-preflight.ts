// Checks a test suite runs before it builds images or starts a compose project (run charter
// rule J, run decisions K108, K109, K111, K112 and K113 in .planning/run-loop/J1-RENCANA.md).
// Every check throws DockerPreflightError instead of guessing: the suite stops and reports.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RUN_LABEL, TEST_LABEL, TEST_NAME_PREFIX, testResourceName } from "./docker-test-labels";

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

/** Available bytes from `df -Pk <path>` output (POSIX format: 1024-byte blocks, column 4). */
export function parseDfAvailableBytes(output: string): number {
  const rows = output.trim().split("\n");
  const fields = rows[rows.length - 1]?.trim().split(/\s+/) ?? [];
  const availableKb = Number(fields[3]);
  if (rows.length < 2 || !Number.isFinite(availableKb) || availableKb < 0) {
    throw new DockerPreflightError(
      `Cannot read free space from df output: ${JSON.stringify(output)}`,
    );
  }
  return availableKb * 1024;
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
export function hostFreeBytes(dirs: string[]): number {
  return Math.min(
    ...dirs.map((dir) => {
      const stats = fs.statfsSync(dir);
      return Number(stats.bavail) * Number(stats.bsize);
    }),
  );
}

/** Free space where Docker stores container layers, measured from inside a one-off container. */
export function dockerFreeBytes(docker: Docker, runId: string): number {
  const result = docker([
    "run",
    "--rm",
    "--pull",
    "never",
    "--network",
    "none",
    "--name",
    testResourceName("df", runId),
    "--label",
    `${TEST_LABEL}=1`,
    "--label",
    `${RUN_LABEL}=${runId}`,
    "--entrypoint",
    "df",
    SPACE_PROBE_IMAGE,
    "-Pk",
    "/",
  ]);
  if (result.code !== 0) {
    throw new DockerPreflightError(
      `Could not measure free space in the Docker VM (${SPACE_PROBE_IMAGE} must already be present; nothing is pulled): ${result.stderr.trim()}`,
    );
  }
  return parseDfAvailableBytes(result.stdout);
}

// --- Image tags (K111) ------------------------------------------------------------------------

export function tagState(docker: Docker, ref: string): "free" | "taken" {
  const result = docker(["image", "inspect", "--format", "{{.Id}}", ref]);
  if (result.code === 0) return "taken";
  if (/no such image/i.test(result.stderr)) return "free";
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
  build?: { labels?: Record<string, string> };
  tmpfs?: string[] | string;
  volumes?: { type?: string; source?: string; target?: string }[];
}
export interface ComposeConfig {
  services?: Record<string, ComposeService>;
  networks?: Record<string, { labels?: Record<string, string>; external?: boolean }>;
  volumes?: Record<string, { labels?: Record<string, string>; external?: boolean }>;
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
}

export function runBuildPreflight(docker: Docker, options: PreflightOptions): void {
  assertProjectAbsent(docker, options.project);
  assertTagsFree(docker, options.tags);
  if (options.subnet) assertSubnetFree(docker, options.subnet);
  assertEnoughSpace("the host", hostFreeBytes(options.hostDirs));
  assertEnoughSpace("the Docker VM", dockerFreeBytes(docker, options.runId));
}
