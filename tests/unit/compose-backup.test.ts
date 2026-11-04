import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Phase 9 plan 09-08 (AIDA-33, D-01, U-16): the compose `backup` service and its one-shot
 * `backup-init`, checked as text. No compose stack is started here (U-15): running the service in a
 * real stack is specified by plan 09-11 and waits for the Phase 8.1 harness and the owner. The
 * rendered configuration is checked by tests/integration/compose-backup-config.test.ts.
 */
const ROOT = path.resolve(__dirname, "../..");
const TEXT = readFileSync(path.join(ROOT, "docker-compose.yml"), "utf8");
const LINES = TEXT.split(/\r?\n/);

/** The lines of one service block, from its two-space-indented name line to the next one. */
function serviceBlock(service: string): string {
  const start = LINES.indexOf(`  ${service}:`);
  if (start === -1) throw new Error(`service ${service} not found`);
  const rest = LINES.slice(start + 1);
  const end = rest.findIndex((line) => /^ {2}[a-z][a-z0-9_-]*:/.test(line) || /^\S/.test(line));
  const body = end === -1 ? rest : rest.slice(0, end);
  // The comment block above the next service belongs to that service, not to this one.
  while (body.length > 0 && /^( {2}#.*|\s*)$/.test(body[body.length - 1])) body.pop();
  return [LINES[start], ...body].join("\n");
}

/** The six-space-indented list items under one four-space-indented key of a service block. */
function listUnder(block: string, key: string): string[] {
  const lines = block.split("\n");
  const start = lines.indexOf(`    ${key}:`);
  if (start === -1) return [];
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^ {6}#/.test(line)) continue;
    const item = /^ {6}- (.*)$/.exec(line);
    if (!item) break;
    out.push(item[1]);
  }
  return out;
}

/** The mapping under `environment:` of a service block (six-space-indented `KEY: value`). */
function environment(block: string): Record<string, string> {
  const lines = block.split("\n");
  const start = lines.indexOf("    environment:");
  const out: Record<string, string> = {};
  if (start === -1) return out;
  for (const line of lines.slice(start + 1)) {
    if (/^ {6}#/.test(line)) continue;
    const pair = /^ {6}([A-Z_][A-Z0-9_]*): (.*)$/.exec(line);
    if (!pair) break;
    out[pair[1]] = pair[2];
  }
  return out;
}

/** The top-level volumes section. */
function topLevelVolumes(): string {
  const start = LINES.indexOf("volumes:");
  if (start === -1) throw new Error("no top-level volumes");
  const rest = LINES.slice(start + 1);
  const end = rest.findIndex((line) => /^[a-z][a-z0-9_-]*:/.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

/** The comment directly above a service's name line, as one line of text. */
function commentAbove(service: string): string {
  const start = LINES.indexOf(`  ${service}:`);
  const out: string[] = [];
  for (let i = start - 1; i >= 0 && /^ {2}#/.test(LINES[i]); i -= 1) {
    out.unshift(LINES[i].replace(/^ {2}# ?/, ""));
  }
  return out.join(" ");
}

/** A compose interpolation such as `${POSTGRES_USER:-aida}`, as written in the file. */
const interpolated = (expr: string): string => `\${${expr}}`;

const INIT = serviceBlock("backup-init");
const BACKUP = serviceBlock("backup");

describe("backup-init: one root step on the backups_data mount point only (U-16)", () => {
  it("uses the db image, no build, and runs as root with a written reason above it", () => {
    expect(INIT).toMatch(/^ {4}image: pgvector\/pgvector:pg16$/m);
    expect(INIT).not.toMatch(/^ {4}build:/m);
    expect(INIT).toMatch(/^ {4}user: "0:0"$/m);
    const reason = commentAbove("backup-init");
    expect(reason).toMatch(/root:root 0755/);
    expect(reason).toMatch(/no account or directory/);
    expect(reason).toMatch(/D-01 forbids a new image/);
    expect(reason).toMatch(/whole backup as root/);
    expect(reason).toMatch(/docs\/OPERATIONS\.md/);
  });

  it("mounts only backups_data, at /backups, and nothing else", () => {
    expect(listUnder(INIT, "volumes")).toEqual(["backups_data:/backups"]);
    expect(INIT).not.toMatch(/uploads/);
    expect(INIT).not.toMatch(/\.\/|\/opt\//);
  });

  it("has no network, a read-only root filesystem, CAP_CHOWN only, no new privileges, no restart", () => {
    expect(INIT).toMatch(/^ {4}network_mode: none$/m);
    expect(INIT).toMatch(/^ {4}read_only: true$/m);
    expect(listUnder(INIT, "cap_drop")).toEqual(["ALL"]);
    expect(listUnder(INIT, "cap_add")).toEqual(["CHOWN"]);
    expect(listUnder(INIT, "security_opt")).toEqual(["no-new-privileges:true"]);
    expect(INIT).toMatch(/^ {4}restart: "no"$/m);
    expect(INIT).not.toMatch(/^ {4}(ports|privileged|environment|depends_on):/m);
  });

  it("mounts a tmpfs on the image's declared VOLUME, so no anonymous volume is created", () => {
    expect(listUnder(INIT, "tmpfs")).toEqual(["/var/lib/postgresql/data"]);
  });

  it("skips when already 1000:1000 mode 700, else chmod 0700 then chown 1000:1000, never recursive", () => {
    const entry = listUnder(INIT, "entrypoint");
    expect(entry.slice(0, 3)).toEqual(["sh", "-c", ">-"]);
    const script = INIT.slice(INIT.indexOf(">-"));
    expect(script).toContain(`"$$(stat -c '%u:%g:%a' /backups)" = 1000:1000:700`);
    const chmod = script.indexOf("chmod 0700 /backups");
    const chown = script.indexOf("chown 1000:1000 /backups");
    expect(chmod).toBeGreaterThan(0);
    expect(chown).toBeGreaterThan(chmod);
    expect(script).toMatch(/docs\/OPERATIONS\.md/);
    expect(script).toMatch(/exit 1/);
    expect(script).not.toMatch(/\s-R\b|--recursive|\bfind\b|\*/);
    expect(script.match(/chown/g)).toHaveLength(1);
    expect(script.match(/chmod/g)).toHaveLength(1);
  });
});

describe("backup: the scheduled service runs as 1000:1000 (D-01, U-16)", () => {
  it("uses the db image (no build, no new image) as numeric user 1000:1000 with the scheduler", () => {
    expect(BACKUP).toMatch(/^ {4}image: pgvector\/pgvector:pg16$/m);
    expect(BACKUP).not.toMatch(/^ {4}build:/m);
    expect(BACKUP).toMatch(/^ {4}user: "1000:1000"$/m);
    expect(BACKUP).toMatch(/^ {4}entrypoint: \["sh", "\/opt\/aida-backup\/scheduler\.sh"\]$/m);
    expect(BACKUP).toMatch(/^ {4}restart: unless-stopped$/m);
    expect(BACKUP).not.toMatch(/^ {4}(ports|privileged|cap_add):/m);
  });

  it("reaches the database with libpq variables and PGPASSWORD, never a URL", () => {
    const env = environment(BACKUP);
    expect(env.PGHOST).toBe("db");
    expect(env.PGPORT).toBe('"5432"');
    expect(env.PGUSER).toBe(interpolated("POSTGRES_USER:-aida"));
    expect(env.PGPASSWORD).toBe(interpolated("POSTGRES_PASSWORD"));
    expect(env.PGDATABASE).toBe(interpolated("POSTGRES_DB:-aida"));
    expect(BACKUP).not.toMatch(/DATABASE_URL|postgres(ql)?:\/\//);
    expect(INIT).not.toMatch(/DATABASE_URL|PGPASSWORD|postgres(ql)?:\/\//);
  });

  it("passes the five operator settings with their defaults and the two fixed directories", () => {
    const env = environment(BACKUP);
    expect(env.BACKUP_ENABLED).toBe(interpolated("BACKUP_ENABLED:-true"));
    expect(env.BACKUP_SCHEDULE).toBe(interpolated("BACKUP_SCHEDULE:-02:00"));
    expect(env.BACKUP_RETENTION).toBe(interpolated("BACKUP_RETENTION:-7"));
    expect(env.BACKUP_LEASE_TTL_SECONDS).toBe(interpolated("BACKUP_LEASE_TTL_SECONDS:-900"));
    expect(env.BACKUP_FENCE_WAIT_SECONDS).toBe(interpolated("BACKUP_FENCE_WAIT_SECONDS:-300"));
    expect(env.BACKUP_DIR).toBe("/backups");
    expect(env.UPLOADS_DIR).toBe("/data/uploads");
    expect(Object.keys(env).sort()).toEqual(
      [
        "BACKUP_DIR",
        "BACKUP_ENABLED",
        "BACKUP_FENCE_WAIT_SECONDS",
        "BACKUP_LEASE_TTL_SECONDS",
        "BACKUP_RETENTION",
        "BACKUP_SCHEDULE",
        "PGDATABASE",
        "PGHOST",
        "PGPASSWORD",
        "PGPORT",
        "PGUSER",
        "UPLOADS_DIR",
      ].sort(),
    );
  });

  it("mounts the scripts, package.json and uploads read-only, and only backups_data writable", () => {
    expect(listUnder(BACKUP, "volumes")).toEqual([
      "./scripts/backup:/opt/aida-backup:ro",
      "./package.json:/opt/aida-backup-meta/package.json:ro",
      "uploads_data:/data/uploads:ro",
      "backups_data:/backups",
    ]);
  });

  it("mounts a tmpfs on the image's declared VOLUME, so no anonymous volume is created", () => {
    expect(listUnder(BACKUP, "tmpfs")).toEqual(["/var/lib/postgresql/data"]);
  });

  it("waits for db healthy, migrate completed and backup-init completed", () => {
    expect(BACKUP).toMatch(
      / {4}depends_on:\n {6}db:\n {8}condition: service_healthy\n {6}migrate:\n {8}condition: service_completed_successfully\n {6}backup-init:\n {8}condition: service_completed_successfully\n/,
    );
  });

  it("is limited to 512m of memory", () => {
    expect(BACKUP).toMatch(/ {4}deploy:\n {6}resources:\n {8}limits:\n {10}memory: 512m/);
  });
});

describe("docker-compose.yml as a whole (D-01, U-16)", () => {
  it("db, backup-init and backup are the three services on pgvector/pgvector:pg16", () => {
    expect(TEXT.match(/image: pgvector\/pgvector:pg16/g)).toHaveLength(3);
    expect(serviceBlock("db")).toMatch(/image: pgvector\/pgvector:pg16/);
  });

  it('exactly one service runs as user "1000:1000" and only backup-init runs as root', () => {
    expect(TEXT.match(/user: "1000:1000"/g)).toHaveLength(1);
    expect(TEXT.match(/user: "0:0"/g)).toHaveLength(1);
    expect(TEXT).not.toMatch(/user: (root|"root"|0\b|"0")/);
  });

  it("carries no test hook variable and no recursive chown", () => {
    expect(TEXT).not.toMatch(/BACKUP_TEST_/);
    expect(TEXT).not.toMatch(/chown -R|chown --recursive/);
  });

  it("declares backups_data with a comment, and only backup and backup-init mount it", () => {
    const volumes = topLevelVolumes();
    expect(volumes).toMatch(/^ {2}backups_data:$/m);
    expect(volumes).toMatch(/U-16/);
    for (const service of ["db", "migrate", "app", "worker", "caddy"]) {
      expect(serviceBlock(service), service).not.toMatch(/backups_data/);
    }
  });

  it("only backup mounts uploads_data read-only; app and worker keep it writable", () => {
    expect(listUnder(serviceBlock("app"), "volumes")).toContain("uploads_data:/data/uploads");
    expect(listUnder(serviceBlock("worker"), "volumes")).toContain("uploads_data:/data/uploads");
    expect(topLevelVolumes()).toMatch(/`backup` mounts it read-only/);
  });

  it("adds no Redis and no other new image", () => {
    expect(TEXT).not.toMatch(/redis/i);
    const images = [...TEXT.matchAll(/^ {4}image: (\S+)$/gm)].map((m) => m[1]).sort();
    expect(images).toEqual(
      [
        "caddy:2",
        "pgvector/pgvector:pg16",
        "pgvector/pgvector:pg16",
        "pgvector/pgvector:pg16",
      ].sort(),
    );
  });
});
