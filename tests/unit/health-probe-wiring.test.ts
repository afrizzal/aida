// The container probe is wired end to end (plan 08-20, review C2): Caddy refuses the probe path
// before proxying, and both compose stacks point their app healthcheck at it. The real-Caddy
// refusal proof runs in plan 08-22; this guard pins the text.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

// Commands of every `wget` line that sits inside a `healthcheck:` block.
function healthcheckWgetLines(file: string): string[] {
  const lines = read(file).split("\n");
  const found: string[] = [];
  let blockIndent = -1;
  for (const line of lines) {
    const indent = line.search(/\S/);
    if (/^\s*healthcheck:\s*$/.test(line)) {
      blockIndent = indent;
      continue;
    }
    if (blockIndent >= 0 && indent >= 0 && indent <= blockIndent) blockIndent = -1;
    if (blockIndent >= 0 && !/^\s*#/.test(line) && line.includes("wget")) found.push(line);
  }
  return found;
}

describe("health probe wiring (review C2)", () => {
  it("C2: the Caddyfile refuses /api/health/probe* with 404 before reverse_proxy", () => {
    const lines = read("Caddyfile").split("\n");
    const matcher = lines.findIndex((l) =>
      /^\s*@healthprobe\s+path\s+\/api\/health\/probe\*\s*$/.test(l),
    );
    const refusal = lines.findIndex((l) => /^\s*respond\s+@healthprobe\s+404\s*$/.test(l));
    const proxy = lines.findIndex((l) => /^\s*reverse_proxy\s+app:3000\b/.test(l));
    const site = lines.findIndex((l) => /^\{\$DOMAIN:localhost\}\s*\{\s*$/.test(l));
    expect(site).toBeGreaterThanOrEqual(0);
    expect(matcher).toBeGreaterThan(site);
    expect(refusal).toBeGreaterThan(matcher);
    expect(proxy).toBeGreaterThan(refusal);
  });

  for (const file of ["docker-compose.yml", "docker-compose.egress-test.yml"]) {
    it(`C2: ${file} has exactly one healthcheck on the probe and none on the throttled /api/health`, () => {
      const wget = healthcheckWgetLines(file);
      const probe = wget.filter((l) => l.includes("http://127.0.0.1:3000/api/health/probe"));
      expect(probe).toHaveLength(1);
      const throttled = wget.filter((l) => /\/api\/health(?!\/probe)/.test(l));
      expect(throttled).toEqual([]);
    });
  }

  it("C2: the probe route file exists", () => {
    expect(existsSync(path.join(root, "src/app/api/health/probe/route.ts"))).toBe(true);
  });
});
