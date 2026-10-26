// ---------------------------------------------------------------------------
// scripts/test-docker-cleanup.ts: removes the Docker resources of ONE test run (run charter
// rules H and J, run decision K108 in .planning/run-loop/J1-RENCANA.md).
//
// A resource is removed only when it carries `aida.test=1`, `aida.test.run=<run id>` and a name
// that starts with `aida-test-` (for an image: the repository). Each one is re-inspected right
// before removal. Order: containers, networks, volumes, then image tags. Image tags are removed
// by `repo:tag`, never by image id, so an image that also has another tag keeps it. Nothing is
// pruned and no anonymous volume is removed. Resources of other runs are only listed.
//
//   pnpm test:docker-cleanup --run <runId>           dry run: prints what would be removed
//   pnpm test:docker-cleanup --run <runId> --apply   removes it
//   pnpm test:docker-cleanup --others [--run <id>]   lists aida.test=1 resources of other runs
// ---------------------------------------------------------------------------
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  isRunId,
  type ResourceType,
  RUN_LABEL,
  TEST_LABEL,
  TEST_NAME_PREFIX,
} from "../tests/support/docker-test-labels";

export type DockerRunner = (args: string[]) => string;

export interface DockerResource {
  type: ResourceType;
  /** What the remove command takes: container or network id, volume name, image `repo:tag`. */
  ref: string;
  name: string;
  labels: Record<string, string>;
}

export const REMOVAL_ORDER: readonly ResourceType[] = ["container", "network", "volume", "image"];

function listArgs(type: ResourceType, filters: string[]): string[] {
  switch (type) {
    case "container":
      return ["ps", "-a", ...filters, "--format", "{{.ID}}"];
    case "network":
      return ["network", "ls", ...filters, "--format", "{{.ID}}"];
    case "volume":
      return ["volume", "ls", ...filters, "--format", "{{.Name}}"];
    case "image":
      return ["image", "ls", ...filters, "--format", "{{.Repository}}:{{.Tag}}"];
  }
}

function inspectArgs(type: ResourceType, ref: string): string[] {
  switch (type) {
    case "container":
      return [
        "container",
        "inspect",
        "--format",
        '{"name":{{json .Name}},"labels":{{json .Config.Labels}}}',
        ref,
      ];
    case "network":
      return [
        "network",
        "inspect",
        "--format",
        '{"name":{{json .Name}},"labels":{{json .Labels}}}',
        ref,
      ];
    case "volume":
      return [
        "volume",
        "inspect",
        "--format",
        '{"name":{{json .Name}},"labels":{{json .Labels}}}',
        ref,
      ];
    case "image":
      return ["image", "inspect", "--format", '{"labels":{{json .Config.Labels}}}', ref];
  }
}

function removeArgs(type: ResourceType, ref: string): string[] {
  switch (type) {
    // `-f` stops a container a crashed run left running. No `-v`: anonymous volumes carry no
    // label, so rule J does not allow removing them.
    case "container":
      return ["rm", "-f", ref];
    case "network":
      return ["network", "rm", ref];
    case "volume":
      return ["volume", "rm", ref];
    case "image":
      return ["image", "rm", ref];
  }
}

function lines(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** Reads the current name and labels of one resource from Docker. */
export function inspectResource(
  docker: DockerRunner,
  type: ResourceType,
  ref: string,
): DockerResource {
  const parsed = JSON.parse(docker(inspectArgs(type, ref))) as {
    name?: string;
    labels?: Record<string, string> | null;
  };
  const name = type === "image" ? ref : String(parsed.name ?? "").replace(/^\//, "");
  return { type, ref, name, labels: parsed.labels ?? {} };
}

/** True only when the resource carries the test label, this run's label, and the name prefix. */
export function belongsToRun(resource: DockerResource, runId: string): boolean {
  if (resource.labels[TEST_LABEL] !== "1") return false;
  if (resource.labels[RUN_LABEL] !== runId) return false;
  const name = resource.type === "image" ? resource.name.split(":")[0] : resource.name;
  return name.startsWith(TEST_NAME_PREFIX);
}

function listByFilters(
  docker: DockerRunner,
  type: ResourceType,
  filters: string[],
): DockerResource[] {
  return lines(docker(listArgs(type, filters)))
    .filter((ref) => type !== "image" || !ref.startsWith("<none>"))
    .map((ref) => inspectResource(docker, type, ref));
}

/** The resources of one run, in removal order. Lists by label, then checks each one itself. */
export function planCleanup(docker: DockerRunner, runId: string): DockerResource[] {
  if (!isRunId(runId)) throw new Error(`Not a valid test run id: ${JSON.stringify(runId)}`);
  const filters = ["--filter", `label=${TEST_LABEL}=1`, "--filter", `label=${RUN_LABEL}=${runId}`];
  return REMOVAL_ORDER.flatMap((type) =>
    listByFilters(docker, type, filters).filter((resource) => belongsToRun(resource, runId)),
  );
}

export interface CleanupResult {
  removed: DockerResource[];
  skipped: { resource: DockerResource; reason: string }[];
  failed: { resource: DockerResource; error: string }[];
}

/** Removes the planned resources, re-checking each one right before its removal. */
export function applyCleanup(
  docker: DockerRunner,
  runId: string,
  plan: DockerResource[],
): CleanupResult {
  const result: CleanupResult = { removed: [], skipped: [], failed: [] };
  for (const planned of plan) {
    let current: DockerResource;
    try {
      current = inspectResource(docker, planned.type, planned.ref);
    } catch (err) {
      result.skipped.push({ resource: planned, reason: `no longer inspectable: ${String(err)}` });
      continue;
    }
    if (!belongsToRun(current, runId)) {
      result.skipped.push({ resource: planned, reason: "labels or name no longer match this run" });
      continue;
    }
    try {
      docker(removeArgs(planned.type, planned.ref));
      result.removed.push(current);
    } catch (err) {
      result.failed.push({ resource: current, error: String(err) });
    }
  }
  return result;
}

/** aida.test=1 resources that do NOT belong to `runId` (or all of them without a run id). */
export function listOtherRuns(docker: DockerRunner, runId?: string): DockerResource[] {
  const filters = ["--filter", `label=${TEST_LABEL}=1`];
  return REMOVAL_ORDER.flatMap((type) =>
    listByFilters(docker, type, filters).filter((resource) => resource.labels[RUN_LABEL] !== runId),
  );
}

function describe(resource: DockerResource): string {
  return `${resource.type} ${resource.name} (${resource.labels[RUN_LABEL] ?? "no run label"})`;
}

function main(argv: string[]): number {
  const runIndex = argv.indexOf("--run");
  const runId = runIndex >= 0 ? argv[runIndex + 1] : undefined;
  const docker: DockerRunner = (args) =>
    execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

  if (argv.includes("--others")) {
    if (runId !== undefined && !isRunId(runId))
      throw new Error(`Not a valid test run id: ${runId}`);
    const others = listOtherRuns(docker, runId);
    for (const resource of others) console.log(`other run: ${describe(resource)}`);
    console.log(`${others.length} resource(s) of other runs listed, none removed.`);
    return 0;
  }

  if (runId === undefined || !isRunId(runId)) {
    console.error("Usage: test-docker-cleanup --run <runId> [--apply] | --others [--run <runId>]");
    return 2;
  }

  const plan = planCleanup(docker, runId);
  if (!argv.includes("--apply")) {
    for (const resource of plan) console.log(`would remove: ${describe(resource)}`);
    console.log(`${plan.length} resource(s) of run ${runId}; dry run, nothing removed.`);
    return 0;
  }

  const result = applyCleanup(docker, runId, plan);
  for (const resource of result.removed) console.log(`removed: ${describe(resource)}`);
  for (const { resource, reason } of result.skipped)
    console.log(`skipped: ${describe(resource)}: ${reason}`);
  for (const { resource, error } of result.failed)
    console.error(`FAILED: ${describe(resource)}: ${error}`);
  console.log(
    `run ${runId}: ${result.removed.length} removed, ${result.skipped.length} skipped, ${result.failed.length} failed.`,
  );
  return result.failed.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
