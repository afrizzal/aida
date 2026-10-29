// Pins the sonner style allowance to the installed sonner (plan 08-08, D-11, threat T-08-33).
// sonner injects one static <style> at module load with no nonce option, so the policy allows
// exactly the sha256 of that CSS text (plus the empty string: the element is appended empty
// before its text node). A sonner bump that changes the CSS changes the hash and fails here.
import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildCsp, EMPTY_STYLE_HASH, SONNER_STYLE_HASH } from "../../src/lib/security/csp";

function sha256Source(text: string): string {
  return `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;
}

const originalDocument = (globalThis as { document?: unknown }).document;

afterAll(() => {
  (globalThis as { document?: unknown }).document = originalDocument;
});

describe("CSP style hashes (08-08)", () => {
  it("SONNER_STYLE_HASH equals the hash of the CSS the installed sonner injects", async () => {
    const captured: string[] = [];
    (globalThis as { document?: unknown }).document = {
      head: { appendChild() {} },
      getElementsByTagName: () => [{ appendChild() {} }],
      createElement: () => ({
        appendChild: (node: { text: string }) => captured.push(node.text),
      }),
      createTextNode: (text: string) => ({ text }),
    };
    await import("sonner");
    expect(captured).toHaveLength(1);
    expect(captured[0]).toContain("[data-sonner-toaster]");
    expect(sha256Source(captured[0])).toBe(SONNER_STYLE_HASH);
  });

  it("EMPTY_STYLE_HASH is the hash of the empty string", () => {
    expect(EMPTY_STYLE_HASH).toBe("'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='");
    expect(sha256Source("")).toBe(EMPTY_STYLE_HASH);
  });

  it("both hashes sit in style-src-elem in both modes, next to the nonce", () => {
    for (const isDev of [false, true]) {
      const elem = buildCsp("N", { isDev })
        .split("; ")
        .find((d) => d.startsWith("style-src-elem "));
      expect(elem).toBe(`style-src-elem 'self' 'nonce-N' ${SONNER_STYLE_HASH} ${EMPTY_STYLE_HASH}`);
    }
  });
});
