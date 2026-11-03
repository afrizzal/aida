/// <reference types="node" />
// Static guards for the non-root images and the image telemetry opt-out of Phase 8 (plan 08-09):
// - D-08 / AIDA-27 (F-06): the runner stage (app, worker) and the builder stage (migrate, the
//   egress-test runner) end as the image's built-in `node` user; only /data/uploads is made
//   writable, owned by node:node before `USER node`.
// - D-27 / AIDA-32 (F-14): NEXT_TELEMETRY_DISABLED=1 and CHECKPOINT_DISABLE=1 in the base stage
//   (inherited by deps, builder and migrate) and explicitly in runner, each with value exactly 1.
// - D-08: migrate calls the Prisma CLI through node, never through pnpm/corepack, because the
//   corepack pnpm download lives in root's cache at build time.
// Plain text checks on file contents; no Docker daemon is needed.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const read = (rel: string): string => fs.readFileSync(path.join(PROJECT_ROOT, rel), "utf-8");

/** Instruction lines (comments and blank lines dropped, continuations joined) per stage name. */
function stages(dockerfile: string): Map<string, string[]> {
  const joined = dockerfile.replace(/\\\r?\n/g, " ");
  const out = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const raw of joined.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const from = /^FROM\s+\S+\s+AS\s+(\S+)/i.exec(line);
    if (from) {
      current = [];
      out.set(from[1], current);
    }
    current?.push(line);
  }
  return out;
}

const STAGES = stages(read("Dockerfile"));
const stage = (name: string): string[] => {
  const block = STAGES.get(name);
  if (!block) throw new Error(`Dockerfile has no stage ${name}`);
  return block;
};

/** Every `NAME=value` pair set by ENV lines of one stage. */
function envPairs(block: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const line of block.filter((l) => /^ENV\s/i.test(l))) {
    for (const m of line.replace(/^ENV\s+/i, "").matchAll(/([A-Z_][A-Z0-9_]*)=("[^"]*"|\S*)/g)) {
      const value = m[2].replace(/^"(.*)"$/, "$1");
      out[m[1]] ??= [];
      out[m[1]].push(value);
    }
  }
  return out;
}

const indexOf = (block: string[], pattern: RegExp): number =>
  block.findIndex((l) => pattern.test(l));

describe("Dockerfile base stage (D-27, AIDA-32)", () => {
  it("D-27: base sets NEXT_TELEMETRY_DISABLED to exactly 1", () => {
    expect(envPairs(stage("base")).NEXT_TELEMETRY_DISABLED).toEqual(["1"]);
  });

  it("D-27: base sets CHECKPOINT_DISABLE to exactly 1", () => {
    expect(envPairs(stage("base")).CHECKPOINT_DISABLE).toEqual(["1"]);
  });
});

describe("Dockerfile runner stage (D-08, D-27, AIDA-27, AIDA-32)", () => {
  const runner = stage("runner");

  it("D-27: runner sets NEXT_TELEMETRY_DISABLED to exactly 1 (it does not start from base)", () => {
    expect(envPairs(runner).NEXT_TELEMETRY_DISABLED).toEqual(["1"]);
  });

  it("D-27: runner sets CHECKPOINT_DISABLE to exactly 1", () => {
    expect(envPairs(runner).CHECKPOINT_DISABLE).toEqual(["1"]);
  });

  it("D-08: runner creates /data/uploads and gives it to node:node", () => {
    expect(
      indexOf(runner, /^RUN\s.*mkdir -p \/data\/uploads.*chown node:node \/data\/uploads/),
    ).toBeGreaterThan(0);
  });

  it("D-08: runner switches to USER node after the uploads chown and before CMD", () => {
    const chown = indexOf(runner, /chown node:node \/data\/uploads/);
    const user = indexOf(runner, /^USER\s+node$/);
    const cmd = indexOf(runner, /^CMD\s/);
    expect(chown).toBeGreaterThan(0);
    expect(user).toBeGreaterThan(chown);
    expect(cmd).toBeGreaterThan(user);
  });

  it("D-08: runner code COPY lines keep root ownership (no --chown)", () => {
    expect(runner.filter((l) => /^COPY\s/.test(l) && /--chown/.test(l))).toEqual([]);
  });

  it("D-08: no stage switches back to root", () => {
    for (const block of STAGES.values()) {
      expect(block.filter((l) => /^USER\s+(root|0)(:|$)/.test(l))).toEqual([]);
    }
  });
});

/** The text block of one top-level compose service (indented two spaces under `services:`). */
function composeService(rel: string, name: string): string {
  const text = read(rel);
  const start = text.search(new RegExp(`^  ${name}:\\s*$`, "m"));
  if (start < 0) throw new Error(`${rel} has no service ${name}`);
  const rest = text.slice(start + 1);
  const next = rest.search(/^ {2}[a-z][\w-]*:\s*$|^\S/m);
  return next < 0 ? text.slice(start) : text.slice(start, start + 1 + next);
}

const MIGRATE_COMMAND =
  'command: ["node", "node_modules/prisma/build/index.js", "migrate", "deploy"]';
// Phase 9, D-12(4): docker-compose.yml runs the database URL guard first, tsx through node as well.
// The egress-test compose file keeps its own fixture URL and the plain command (D-13).
const MIGRATE_COMMANDS: Record<string, string> = {
  "docker-compose.yml":
    'command: ["sh", "-c", "node node_modules/tsx/dist/cli.mjs scripts/check-database-url.ts && exec node node_modules/prisma/build/index.js migrate deploy"]',
  "docker-compose.egress-test.yml": MIGRATE_COMMAND,
};

describe("non-root migrate through the builder stage (D-08, D-27)", () => {
  it("D-08: the builder stage's last instruction is USER node", () => {
    const builder = stage("builder");
    expect(builder[builder.length - 1]).toBe("USER node");
  });

  it("D-08: the Prisma CLI entry the compose files call is the package's own bin.prisma", () => {
    const pkg = JSON.parse(read("node_modules/prisma/package.json")) as { bin: { prisma: string } };
    expect(`node_modules/prisma/${pkg.bin.prisma}`).toBe("node_modules/prisma/build/index.js");
  });

  it("D-12(4): the tsx entry docker-compose.yml calls is the package's own bin", () => {
    const pkg = JSON.parse(read("node_modules/tsx/package.json")) as { bin: string };
    expect(`node_modules/tsx/${pkg.bin.replace(/^\.\//, "")}`).toBe(
      "node_modules/tsx/dist/cli.mjs",
    );
  });

  for (const file of ["docker-compose.yml", "docker-compose.egress-test.yml"]) {
    it(`D-08: ${file} migrate calls the Prisma CLI through node, not pnpm or corepack`, () => {
      const migrate = composeService(file, "migrate");
      expect(migrate).toContain(MIGRATE_COMMANDS[file]);
      expect(migrate).not.toMatch(/command:\s*\[\s*"(pnpm|corepack|npx)"/);
      expect(migrate).not.toMatch(/\b(pnpm|corepack|npx)\b[^\n]*migrate deploy/);
    });

    it(`D-27: ${file} migrate keeps CHECKPOINT_DISABLE: "1"`, () => {
      expect(composeService(file, "migrate")).toContain('CHECKPOINT_DISABLE: "1"');
    });
  }

  it("J: the egress-test migrate keeps J1's run-tagged image and labels on the service and its build", () => {
    const migrate = composeService("docker-compose.egress-test.yml", "migrate");
    expect(migrate).toContain(
      "image: aida-test-egress-migrate:${AIDA_TEST_RUN_ID:?set AIDA_TEST_RUN_ID}",
    );
    expect(migrate.match(/labels: \*test-labels/g)?.length).toBe(2);
  });
});
