// Phase 9 fix batch F6 (Codex diff critique round 2): what docs/OPERATIONS.md tells an operator
// about rolling back, validating and repairing. Each case reads the checked-in text.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DOC = readFileSync(path.resolve(__dirname, "../../docs/OPERATIONS.md"), "utf8");

/** The text from the line `## <name>` to the next `## ` heading (comment lines in code blocks start with `# `). */
function section(heading: string): string {
  const start = DOC.indexOf(`\n${heading}\n`);
  if (start < 0) throw new Error(`no heading ${heading}`);
  const rest = DOC.slice(start + heading.length + 2);
  const next = rest.indexOf("\n## ");
  return next < 0 ? rest : rest.slice(0, next);
}

describe("K153: a failed rollback restore is recovered by restoring the database and the uploads as a pair", () => {
  const upgrading = section("## Upgrading");
  const failed = upgrading.slice(upgrading.indexOf("**If the restore in step 6 fails**"));

  it("never offers renaming the kept database back without its uploads", () => {
    expect(upgrading).not.toMatch(/rename `<db>_before_rollback` back to/);
    expect(failed).toContain("do not rename `<db>_before_rollback` back");
  });

  it("restores the step 2 set (database and uploads) with the new release before any service starts", () => {
    const restore = failed.indexOf("./scripts/restore.sh <current-setId> --yes");
    const up = failed.indexOf("docker compose up -d");
    expect(failed.indexOf("./scripts/restore.sh <current-setId> --validate-only")).toBeGreaterThan(
      failed.indexOf("git checkout <new-tag>"),
    );
    expect(restore).toBeGreaterThan(0);
    expect(up).toBeGreaterThan(restore);
    expect(failed).toContain("do not start any service");
    expect(failed).not.toMatch(/dropdb|DROP DATABASE/);
  });
});
