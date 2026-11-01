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
  // Review d-IN-d4: Caddy sorts the directives of a site block by its own built-in order
  // (`respond` runs before `reverse_proxy` wherever it is written), so the line order in the file
  // says nothing about what Caddy does, and is not asserted. What matters is that the matcher and
  // the 404 sit directly in the site block, not inside a `route` or `handle` block, where the
  // written order would apply. The real-Caddy refusal proof is plan 08-22's.
  it("C2: the Caddyfile refuses /api/health/probe* with 404 in the site block that proxies to app:3000", () => {
    const lines = read("Caddyfile").split("\n");
    // Brace depth before each line: 0 at top level, 1 directly inside the site block.
    const depth: number[] = [];
    let level = 0;
    for (const line of lines) {
      depth.push(level);
      // Drop comments and placeholders such as {$DOMAIN:localhost} or {remote_host}; what is left
      // are block braces.
      const code = line.replace(/#.*$/, "").replace(/\{[^{}\s]*\}/g, "");
      level += (code.match(/\{/g) ?? []).length - (code.match(/\}/g) ?? []).length;
    }
    const site = lines.findIndex((l) => /^\{\$DOMAIN:localhost\}\s*\{\s*$/.test(l));
    const matcher = lines.findIndex((l) =>
      /^\s*@healthprobe\s+path\s+\/api\/health\/probe\*\s*$/.test(l),
    );
    const refusal = lines.findIndex((l) => /^\s*respond\s+@healthprobe\s+404\s*$/.test(l));
    const proxy = lines.findIndex((l) => /^\s*reverse_proxy\s+app:3000\b/.test(l));
    expect(site).toBeGreaterThanOrEqual(0);
    expect(depth[site]).toBe(0);
    for (const index of [matcher, refusal, proxy]) {
      expect(index).toBeGreaterThan(site);
      expect(depth[index]).toBe(1);
    }
    expect(lines.filter((l) => /^\s*@healthprobe\b/.test(l))).toHaveLength(1);
    expect(lines.some((l) => /^\s*(route|handle)\b/.test(l))).toBe(false);
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
