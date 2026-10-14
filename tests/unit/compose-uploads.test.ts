import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Phase 14, run decision K68 (review C11): the worker mounts the uploads volume and sets
 * UPLOADS_DIR in both compose files, so the scheduled project file cleanup sees the files the app
 * stored and inbound email attachments saved by the worker land on the shared volume. A static
 * check of the files only: no compose stack is started here (owner item O-1).
 */
const ROOT = path.resolve(__dirname, "../..");

function readCompose(file: string): string[] {
  return readFileSync(path.join(ROOT, file), "utf8").split(/\r?\n/);
}

/**
 * The lines of one service block: from its two-space-indented name line to the next
 * two-space-indented service name or the top-level volumes line.
 */
function serviceBlock(lines: string[], service: string): string {
  const start = lines.indexOf(`  ${service}:`);
  if (start === -1) throw new Error(`service ${service} not found`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^ {2}[a-z][a-z0-9_-]*:/.test(line) || line === "volumes:");
  return [lines[start], ...(end === -1 ? rest : rest.slice(0, end))].join("\n");
}

/** The top-level volumes section: from `volumes:` to the next top-level key or the end. */
function topLevelVolumes(lines: string[]): string | null {
  const start = lines.indexOf("volumes:");
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^[a-z][a-z0-9_-]*:/.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

const UPLOADS_ENV = /^ {6}UPLOADS_DIR: \/data\/uploads$/m;
const UPLOADS_MOUNT = /^ {6}- uploads_data:\/data\/uploads$/m;

describe("docker-compose.yml shares the uploads volume with the worker (K68)", () => {
  const lines = readCompose("docker-compose.yml");

  it("the worker service sets UPLOADS_DIR and mounts uploads_data at /data/uploads", () => {
    const worker = serviceBlock(lines, "worker");
    expect(worker).toMatch(UPLOADS_ENV);
    expect(worker).toMatch(UPLOADS_MOUNT);
  });

  it("the app service still sets UPLOADS_DIR and mounts uploads_data", () => {
    const app = serviceBlock(lines, "app");
    expect(app).toMatch(UPLOADS_ENV);
    expect(app).toMatch(UPLOADS_MOUNT);
  });

  it("the volume comment no longer says only app mounts the volume", () => {
    const volumes = topLevelVolumes(lines);
    expect(volumes).not.toBeNull();
    expect(volumes).toMatch(/^ {2}uploads_data:$/m);
    expect(volumes).not.toMatch(/only `?app`? mounts/i);
    expect(volumes).toMatch(/`worker`/);
  });
});

describe("docker-compose.egress-test.yml shares the uploads volume with the worker (K68)", () => {
  const lines = readCompose("docker-compose.egress-test.yml");

  it("the worker and the app each set UPLOADS_DIR and mount uploads_data at /data/uploads", () => {
    for (const service of ["worker", "app"]) {
      const block = serviceBlock(lines, service);
      expect(block, service).toMatch(UPLOADS_ENV);
      expect(block, service).toMatch(UPLOADS_MOUNT);
    }
  });

  it("a top-level volumes section declares uploads_data", () => {
    const volumes = topLevelVolumes(lines);
    expect(volumes).not.toBeNull();
    expect(volumes).toMatch(/^ {2}uploads_data:$/m);
  });
});
