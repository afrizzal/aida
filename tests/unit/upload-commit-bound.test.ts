// Run decision K155: every upload transaction that can reach the uncertain-commit path ends with
// boundUploadCommitInTx, so the server bounds a COMMIT that is still pending
// (src/lib/attachments/uncertain-commit.ts). The server behaviour itself is shown on PostgreSQL
// in tests/integration/upload-commit-bound.test.ts; this file checks the call sites, the
// statement and the margin against the queue delay.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import {
  boundUploadCommitInTx,
  UNCERTAIN_COMMIT_CLEANUP_DELAY_MINUTES,
  UNCERTAIN_COMMIT_MARGIN_SECONDS,
  UPLOAD_COMMIT_BOUND_SECONDS,
  UPLOAD_COMMIT_BOUND_SQL,
} from "@/lib/attachments/uncertain-commit";

const ROOT = path.resolve(__dirname, "../..");

/** The four paths that queue staged files after an unknown commit outcome (K148). */
const PATHS = [
  "src/app/api/public/intake/route.ts",
  "src/app/api/public/status/[token]/follow-up/route.ts",
  "src/app/api/tickets/[id]/messages/route.ts",
  "src/lib/projects/attachments.ts",
];

describe("K155: the upload transactions end with the server-side bound", () => {
  for (const file of PATHS) {
    it(`${file}: the statement before every commit-sent flag is boundUploadCommitInTx(tx)`, () => {
      const lines = readFileSync(path.join(ROOT, file), "utf8").split("\n");
      const flags = lines.flatMap((line, i) => (line.trim() === "commitSent = true;" ? [i] : []));
      expect(flags.length).toBeGreaterThan(0);
      for (const i of flags) {
        let j = i - 1;
        while (j >= 0 && (lines[j] as string).trim() === "") j -= 1;
        expect((lines[j] as string).trim(), `${file}:${i + 1}`).toBe(
          "await boundUploadCommitInTx(tx);",
        );
      }
      expect(lines.join("\n")).toContain("queueStagedFilesAfterUncertainCommit");
    });
  }

  it("the statement sets the idle limit for the transaction only, from the constant", () => {
    expect(UPLOAD_COMMIT_BOUND_SQL).toBe(
      "SELECT set_config('idle_in_transaction_session_timeout', '30s', true)",
    );
  });

  it("the bound (30 s) is shorter than the queue delay (15 min), with a margin of 870 s", () => {
    expect(UPLOAD_COMMIT_BOUND_SECONDS).toBe(30);
    expect(UNCERTAIN_COMMIT_CLEANUP_DELAY_MINUTES).toBe(15);
    expect(UNCERTAIN_COMMIT_MARGIN_SECONDS).toBe(870);
    expect(UNCERTAIN_COMMIT_MARGIN_SECONDS).toBeGreaterThan(UPLOAD_COMMIT_BOUND_SECONDS);
  });

  it("boundUploadCommitInTx runs exactly that one statement on the transaction client", async () => {
    const $executeRawUnsafe = vi.fn(async () => 1);
    await boundUploadCommitInTx({ $executeRawUnsafe });
    expect($executeRawUnsafe).toHaveBeenCalledTimes(1);
    expect($executeRawUnsafe).toHaveBeenCalledWith(UPLOAD_COMMIT_BOUND_SQL);
  });
});
