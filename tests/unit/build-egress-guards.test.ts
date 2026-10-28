/// <reference types="node" />
// Permanent guards for the build-path egress and CI cost decisions of Phase 8 (plan 08-05):
// - D-26 / AIDA-32: no Google-hosted font loader, one system font stack, so `next build`
//   makes no request to Google Fonts.
// Plain text checks on file contents only; no YAML package is a dependency of the repo.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const read = (rel: string): string => fs.readFileSync(path.join(PROJECT_ROOT, rel), "utf-8");

function walk(relDir: string, exts: string[]): { rel: string; content: string }[] {
  const out: { rel: string; content: string }[] = [];
  const abs = path.join(PROJECT_ROOT, relDir);
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(relDir, entry.name);
    if (entry.isDirectory()) {
      // Generated Prisma client is gitignored output, not source.
      if (rel === path.join("src", "generated")) continue;
      out.push(...walk(rel, exts));
    } else if (exts.some((e) => entry.name.endsWith(e))) {
      out.push({ rel, content: fs.readFileSync(path.join(PROJECT_ROOT, rel), "utf-8") });
    }
  }
  return out;
}

const GOOGLE_FONT_LOADER = ["next", "font", "google"].join("/");

describe("build-path egress guards (D-26, D-27, AIDA-32)", () => {
  const srcFiles = walk("src", [".ts", ".tsx", ".css"]);

  it("D-26: no .ts or .tsx file under src/ imports the Google-hosted font loader", () => {
    const hits = srcFiles
      .filter((f) => /\.tsx?$/.test(f.rel) && f.content.includes(GOOGLE_FONT_LOADER))
      .map((f) => f.rel);
    expect(srcFiles.length).toBeGreaterThan(0);
    expect(hits).toEqual([]);
  });

  it("D-26: the root layout puts no font .variable class on the html element", () => {
    const layout = read("src/app/layout.tsx");
    const html = layout.match(/<html\b[^>]*>/);
    expect(html).not.toBeNull();
    expect(html![0]).not.toMatch(/\.variable/);
    expect(html![0]).toContain("suppressHydrationWarning");
    expect(layout).not.toMatch(/\.variable\b/);
  });

  it("D-26: globals.css defines --font-system once and sans, heading and body all use it", () => {
    const css = read("src/app/globals.css");
    expect(css.match(/--font-system\s*:/g) ?? []).toHaveLength(1);
    expect(css).toMatch(/--font-sans:\s*var\(--font-system\);/);
    expect(css).toMatch(/--font-heading:\s*var\(--font-system\);/);
    const body = css.match(/\bbody\s*\{[^}]*\}/);
    expect(body).not.toBeNull();
    expect(body![0]).toMatch(/font-family:\s*var\(--font-system\);/);
  });

  it("D-26: no file under src/ references --font-inter", () => {
    const hits = srcFiles.filter((f) => f.content.includes("--font-inter")).map((f) => f.rel);
    expect(hits).toEqual([]);
  });
});
