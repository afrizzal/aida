// Compatibility tests for the narrow `pnpm.overrides` entries in package.json
// (plan 08-04, D-04). Each override forces a transitive module to a fixed
// version that its parent never declared, so each test loads the parent that
// really consumes the module, from the parent's own pnpm location, and calls
// the public API that reaches it.
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(import.meta.dirname, "../..");
const overrides: Record<string, string> = JSON.parse(
  readFileSync(path.join(repoRoot, "package.json"), "utf8"),
).pnpm.overrides;

// Directory of `dep` as seen by the package installed at `fromDir`. pnpm links a
// package's dependencies next to it in the same `node_modules` directory.
function depDir(fromDir: string, fromName: string, dep: string): string {
  const nodeModules = fromName.startsWith("@")
    ? path.dirname(path.dirname(fromDir))
    : path.dirname(fromDir);
  return realpathSync(path.join(nodeModules, dep));
}

function chain(names: string[]): string {
  let dir = realpathSync(path.join(repoRoot, "node_modules", names[0]));
  for (let i = 1; i < names.length; i++) dir = depDir(dir, names[i - 1], names[i]);
  return dir;
}

function versionOf(dir: string): string {
  return JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")).version;
}

describe("pnpm.overrides compatibility (D-04)", () => {
  it("fast-uri override: ajv under prisma resolves relative $ref through the overridden fast-uri", () => {
    const key = Object.keys(overrides).find((k) => k.endsWith("fast-uri"));
    expect(key).toBeDefined();
    const ajvDir = chain(["prisma", "@prisma/dev", "@prisma/streams-local", "ajv"]);
    const fastUriDir = depDir(ajvDir, "ajv", "fast-uri");
    expect(versionOf(fastUriDir)).toBe(overrides[key as string]);

    const ajvModule = require(ajvDir);
    const Ajv = ajvModule.default ?? ajvModule;
    const ajv = new Ajv();
    // ajv 8 uses fast-uri as its default URI resolver; prove it is this copy.
    expect(ajv.opts.uriResolver).toBe(require(fastUriDir));

    ajv.addSchema({
      $id: "https://aida.test/schemas/b.json",
      definitions: { n: { type: "integer" } },
    });
    const validate = ajv.compile({
      $id: "https://aida.test/schemas/a.json",
      type: "object",
      properties: { n: { $ref: "b.json#/definitions/n" } },
      required: ["n"],
    });
    expect(validate({ n: 1 })).toBe(true);
    expect(validate({ n: "x" })).toBe(false);
    expect(ajv.opts.uriResolver.resolve("https://aida.test/schemas/a.json", "b.json")).toBe(
      "https://aida.test/schemas/b.json",
    );
  });

  it("ip-address override: socks under imapflow encodes and decodes an IPv6 UDP frame", () => {
    const key = Object.keys(overrides).find((k) => k.endsWith("ip-address"));
    expect(key).toBeDefined();
    const socksDir = chain(["imapflow", "socks"]);
    expect(versionOf(depDir(socksDir, "socks", "ip-address"))).toBe(overrides[key as string]);

    const { SocksClient } = require(socksDir);
    const data = Buffer.from("ping");
    const frame: Buffer = SocksClient.createUDPFrame({
      remoteHost: { host: "2001:db8::1", port: 993 },
      data,
    });
    // RSV(2) FRAG(1) ATYP(1 = 0x04 IPv6) DST.ADDR(16) DST.PORT(2) DATA
    expect(frame.length).toBe(4 + 16 + 2 + data.length);
    expect(frame[3]).toBe(0x04);
    expect(frame.subarray(4, 20).toString("hex")).toBe("20010db8000000000000000000000001");
    expect(frame.readUInt16BE(20)).toBe(993);

    const parsed = SocksClient.parseUDPFrame(frame);
    expect(parsed.remoteHost.host).toBe("2001:0db8:0000:0000:0000:0000:0000:0001");
    expect(parsed.remoteHost.port).toBe(993);
    expect(parsed.data.toString()).toBe("ping");
  });
});
