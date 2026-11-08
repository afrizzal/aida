// Phase 9 fix batch F7 (run decision K156, Codex diff critique round 3, finding 1): no code block
// of docs/OPERATIONS.md starts services after a failed restore. Each bash block that runs
// scripts/restore.sh is executed as an operator would paste it into an interactive shell (sh -c,
// no errexit: every line runs even after a failure), in a scratch directory whose
// scripts/restore.sh and scripts/backup.sh are stubs and whose PATH holds a fake `docker` and a
// fake `git` that only record their calls. Nothing here reaches Docker, git or a database.
//
// Codex r3-4 (static half): no bash block puts `\"` inside a command (the runbook's SQL goes
// through psql variables and a quoted heredoc instead). The commands themselves are run against a
// real database in tests/integration/operations-runbook-sql.test.ts.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const DOC = readFileSync(path.resolve(__dirname, "../../docs/OPERATIONS.md"), "utf8");

/** Every ```bash block, de-indented by its fence's indentation (blocks inside list items). */
function bashBlocks(text: string): string[] {
  const blocks: string[] = [];
  let indent: string | null = null;
  let lines: string[] = [];
  for (const line of text.split("\n")) {
    if (indent === null) {
      const open = /^(\s*)```bash\s*$/.exec(line);
      if (open) {
        indent = open[1] as string;
        lines = [];
      }
      continue;
    }
    if (line.trim() === "```") {
      blocks.push(lines.join("\n"));
      indent = null;
      continue;
    }
    lines.push(line.startsWith(indent) ? line.slice(indent.length) : line.trimStart());
  }
  return blocks;
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const RECORDER = `#!/bin/sh
printf '%s %s\\n' "$(basename "$0")" "$*" >>"$OPS_LOG"
[ -t 0 ] || cat >/dev/null
exit 0
`;
// --validate-only succeeds (nothing is changed); any other restore exits RESTORE_EXIT.
const RESTORE_STUB = `#!/bin/sh
printf 'restore.sh %s\\n' "$*" >>"$OPS_LOG"
case " $* " in *" --validate-only "*) exit 0 ;; esac
exit "$RESTORE_EXIT"
`;

/** Runs one block as pasted (placeholders such as <setId> replaced) and returns its call log. */
function paste(block: string, restoreExit: number): string[] {
  const dir = mkdtempSync(path.join(os.tmpdir(), "aida-ops-blocks-"));
  dirs.push(dir);
  const bin = path.join(dir, "bin");
  mkdirSync(bin);
  mkdirSync(path.join(dir, "scripts"));
  for (const tool of ["docker", "git"]) {
    writeFileSync(path.join(bin, tool), RECORDER);
    chmodSync(path.join(bin, tool), 0o755);
  }
  writeFileSync(path.join(dir, "scripts", "restore.sh"), RESTORE_STUB);
  writeFileSync(path.join(dir, "scripts", "backup.sh"), RECORDER);
  chmodSync(path.join(dir, "scripts", "restore.sh"), 0o755);
  chmodSync(path.join(dir, "scripts", "backup.sh"), 0o755);
  const log = path.join(dir, "calls.log");
  writeFileSync(log, "");
  const script = block.replace(/<[A-Za-z][A-Za-z0-9-]*>/g, "X");
  spawnSync("/bin/sh", ["-c", script], {
    cwd: dir,
    env: {
      NODE_ENV: "test",
      PATH: `${bin}:/usr/bin:/bin`,
      HOME: dir,
      LC_ALL: "C",
      OPS_LOG: log,
      RESTORE_EXIT: String(restoreExit),
    },
    input: "",
    encoding: "utf8",
    timeout: 20_000,
  });
  return readFileSync(log, "utf8")
    .split("\n")
    .filter((line) => line !== "");
}

const STARTS = /^docker compose (up|start)\b/;
const isRestore = (call: string) =>
  call.startsWith("restore.sh ") &&
  !call.includes("--validate-only") &&
  !call.includes("--break-stale-lock");

describe("K156: no runbook block starts services after a failed restore", () => {
  const blocks = bashBlocks(DOC).filter((b) => /\.\/scripts\/restore\.sh\s+</.test(b));

  it("the runbook has the restore blocks this test executes (rollback and its recovery among them)", () => {
    const withYesAndUp = blocks.filter(
      (b) => /restore\.sh <[^>]+> --yes/.test(b) && /docker compose up/.test(b),
    );
    expect(withYesAndUp.length).toBeGreaterThanOrEqual(2);
  });

  it("a failed restore: nothing after it in the same block starts a service", () => {
    for (const block of blocks) {
      const calls = paste(block, 1);
      const failed = calls.findIndex(isRestore);
      if (failed < 0) continue;
      const after = calls.slice(failed + 1).filter((call) => STARTS.test(call));
      expect(after, `${block}\n---\n${calls.join("\n")}`).toEqual([]);
    }
  });

  it("a successful restore: the blocks that start the instance do start it (control)", () => {
    for (const block of blocks.filter((b) => /docker compose up/.test(b))) {
      const calls = paste(block, 0);
      const restored = calls.findIndex(isRestore);
      expect(restored, block).toBeGreaterThanOrEqual(0);
      expect(
        calls.slice(restored + 1).some((call) => STARTS.test(call)),
        calls.join("\n"),
      ).toBe(true);
    }
  });
});

describe("Codex r3-4: no runbook command escapes a double quote", () => {
  it('no bash block contains \\"', () => {
    const offending = bashBlocks(DOC)
      .flatMap((block) => block.split("\n"))
      .filter((line) => line.includes('\\"'));
    expect(offending).toEqual([]);
  });
});
