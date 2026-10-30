// Caddy, Next.js and the route agree on the body limits (plan 08-13, D-24, T-08-61). The
// Caddyfile cannot import constants.ts, so this test is the lockstep guard.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_BYTES,
  MAX_REQUEST_BODY_BYTES,
  MAX_TOTAL_REQUEST_BYTES,
  PROXY_BODY_LIMIT_BYTES,
} from "@/lib/attachments/constants";

const root = path.resolve(__dirname, "../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

describe("body limit lockstep (D-24)", () => {
  it("Caddyfile request_body max_size equals PROXY_BODY_LIMIT_BYTES", () => {
    const sizes = [...read("Caddyfile").matchAll(/^\s*max_size\s+(\S+)\s*$/gm)].map((m) => m[1]);
    expect(sizes).toHaveLength(1);
    const match = /^(\d+)MiB$/.exec(sizes[0] ?? "");
    expect(match, `max_size must be written as <n>MiB, got ${sizes[0]}`).not.toBeNull();
    expect(Number(match?.[1]) * 1024 * 1024).toBe(PROXY_BODY_LIMIT_BYTES);
  });

  it("next.config.ts passes PROXY_BODY_LIMIT_BYTES to proxyClientMaxBodySize", () => {
    expect(read("next.config.ts")).toMatch(/proxyClientMaxBodySize:\s*PROXY_BODY_LIMIT_BYTES\b/);
  });

  it("orders the layers and fits a 30 MB submission", () => {
    expect(PROXY_BODY_LIMIT_BYTES).toBeGreaterThan(MAX_REQUEST_BODY_BYTES);
    expect(MAX_REQUEST_BODY_BYTES).toBeGreaterThan(MAX_TOTAL_REQUEST_BYTES);
    expect(MAX_TOTAL_REQUEST_BYTES).toBeGreaterThan(MAX_BYTES);
    expect(MAX_TOTAL_REQUEST_BYTES).toBeGreaterThanOrEqual(30 * 1000 * 1000);
  });
});
