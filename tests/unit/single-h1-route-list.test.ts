// Phase 9 review c-WR-03 (D-14, AIDA-36): the route list of tests/e2e/single-h1.spec.ts is
// written by hand, and that spec's last case only checks that every LISTED route was rendered.
// This test compares the list with the page files on disk, so a page added under src/app/(app)
// fails here until it is added to the list (and so to a case of the spec). It reads source files
// only; the E2E spec itself stays browser-only.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../..");
const APP_DIR = path.join(REPO_ROOT, "src", "app", "(app)");
const SPEC = path.join(REPO_ROOT, "tests", "e2e", "single-h1.spec.ts");

/** The URL pattern of every page.tsx under src/app/(app); route groups `(name)` add no segment. */
function pageRoutesOnDisk(): string[] {
  const routes: string[] = [];
  const walk = (dir: string, segments: string[]) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const isGroup = entry.name.startsWith("(") && entry.name.endsWith(")");
        walk(path.join(dir, entry.name), isGroup ? segments : [...segments, entry.name]);
      } else if (/^page\.(tsx|ts|jsx|js|mdx)$/.test(entry.name)) {
        routes.push(`/${segments.join("/")}`);
      }
    }
  };
  walk(APP_DIR, []);
  return routes.sort();
}

/** The string entries of the spec's `const APP_PAGE_ROUTES = [ ... ] as const;` literal. */
function routesListedInSpec(): string[] {
  const source = readFileSync(SPEC, "utf8");
  const match = /const APP_PAGE_ROUTES = \[([\s\S]*?)\] as const;/.exec(source);
  if (!match?.[1]) throw new Error("APP_PAGE_ROUTES literal not found in single-h1.spec.ts");
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1] as string).sort();
}

describe("single-h1.spec.ts route list (review c-WR-03)", () => {
  it("finds page files on disk and routes in the spec", () => {
    expect(pageRoutesOnDisk().length).toBeGreaterThan(0);
    expect(routesListedInSpec().length).toBeGreaterThan(0);
  });

  it("lists every page of src/app/(app), and nothing that is not a page", () => {
    expect(routesListedInSpec()).toEqual(pageRoutesOnDisk());
  });
});
