// A `$` in POSTGRES_PASSWORD is documented (review a-IN-2). Compose reads `$name` in an unquoted
// or double-quoted .env value as a variable; a single-quoted value or `$$` keeps the `$`. That
// behaviour was checked with `docker compose config` when the docs were written (F4 report);
// this test pins that the operator-facing files say so.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

describe("a $ in POSTGRES_PASSWORD is documented (a-IN-2)", () => {
  for (const file of [".env.example", "docs/OPERATIONS.md", "scripts/database-url.sh"]) {
    it(`${file} names the $ case, single quotes and $$`, () => {
      const text = read(file);
      expect(text).toMatch(/A `?\$`? in (`?POSTGRES_PASSWORD`?|the value)/);
      expect(text).toContain("$$");
      expect(text).toMatch(/[Ss]ingle-quote/);
    });
  }

  it(".env.example gives the examples that resolve to ab$cd", () => {
    const text = read(".env.example");
    expect(text).toContain("POSTGRES_PASSWORD='ab$cd'");
    expect(text).toContain("POSTGRES_PASSWORD=ab$$cd");
  });
});
