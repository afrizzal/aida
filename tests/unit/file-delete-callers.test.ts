// Phase 9 plan 09-04, U-13: the static inventory of every path that deletes a stored file. A text
// scan of src/ (no import of src): a new caller of a FileStorage delete, a new direct unlink, a new
// enqueue of the deletion queue or an organization delete must be added here on purpose, together
// with its test in tests/integration/file-delete-inventory.test.ts. The logo store (plan 09-05)
// enqueues the dereferenced key on replace and remove; its tests are in
// tests/integration/logo-store.test.ts.
//
// Organization delete (PATTERNS D4): no code in src/ deletes an organization, so the
// ProjectFileCleanup organization cascade removes queue rows only through a path src/ does not
// have. Stated limit (plan 09-04 SUMMARY): Better Auth's organization plugin keeps its own
// owner-only delete endpoint (disableOrganizationDeletion is not set in src/lib/auth.ts); a
// successful call would remove reference rows and queue rows together and leave the files on disk,
// never a referenced key without its file.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const SRC = path.join(ROOT, "src");

interface SourceFile {
  rel: string;
  /** The text with line comments and block comments blanked (line numbers kept). */
  code: string;
}

function blankComments(text: string): string {
  const keepNewlines = (m: string) => m.replace(/[^\n]/g, " ");
  return text
    .replace(/\/\*[\s\S]*?\*\//g, keepNewlines)
    .replace(
      /(^|[\s;{}(),])\/\/[^\n]*/g,
      (m, lead: string) => lead + keepNewlines(m.slice(lead.length)),
    );
}

async function sourceFiles(): Promise<SourceFile[]> {
  const entries = await readdir(SRC, { recursive: true, withFileTypes: true });
  const files: SourceFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/\.(ts|tsx|mts|cts|js|mjs)$/.test(entry.name)) continue;
    const abs = path.join(entry.parentPath, entry.name);
    const rel = path.relative(ROOT, abs).split(path.sep).join("/");
    if (rel.startsWith("src/generated/")) continue;
    files.push({ rel, code: blankComments(await readFile(abs, "utf8")) });
  }
  return files;
}

function lineOf(code: string, index: number): number {
  return code.slice(0, index).split("\n").length;
}

/** Every `<receiver>.delete(` where the receiver is a FileStorage, as `file:line`. */
function fileStorageDeletes(file: SourceFile): string[] {
  const receivers = new Set(["storage", "localFileStorage"]);
  for (const m of file.code.matchAll(
    /\b([A-Za-z_$][\w$]*)\??\s*:\s*(?:Readonly<)?FileStorage\b/g,
  )) {
    receivers.add(m[1] as string);
  }
  const hits: string[] = [];
  for (const m of file.code.matchAll(/\b([A-Za-z_$][\w$]*)\s*\??\.\s*delete\s*\(/g)) {
    if (receivers.has(m[1] as string)) hits.push(`${file.rel}:${lineOf(file.code, m.index ?? 0)}`);
  }
  return hits;
}

const files = await sourceFiles();

describe("U-13 inventory of stored-file deletion", () => {
  it("scans the source tree", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => f.rel === "src/lib/projects/file-cleanup.ts")).toBe(true);
  });

  it("FileStorage.delete is called only by the fenced sweep, the staged-upload rollback and removeStoredUploads", () => {
    const hits = files.flatMap(fileStorageDeletes);
    const callers = [...new Set(hits.map((h) => h.split(":")[0]))].sort();
    expect(callers).toEqual([
      "src/lib/attachments/staged-files.ts",
      "src/lib/attachments/validate-uploads.ts",
      "src/lib/projects/file-cleanup.ts",
    ]);
    // One call site each.
    expect(hits).toHaveLength(3);
  });

  it("only the FileStorage implementation unlinks or removes files", () => {
    const pattern = /\b(?:unlink|unlinkSync|rm|rmSync|rmdir|rmdirSync)\s*\(/;
    const users = files.filter((f) => pattern.test(f.code)).map((f) => f.rel);
    expect(users).toEqual(["src/lib/attachments/local-file-storage.ts"]);
  });

  it("the deletion queue is enqueued by the project attachment delete, the task and project hard delete, the logo store (replace and remove, plan 09-05) and the staged uploads after an unknown commit outcome (K148)", () => {
    const callers = files
      .filter((f) => f.rel !== "src/lib/projects/file-cleanup.ts")
      .filter((f) => /\benqueueFileCleanupInTx\s*\(/.test(f.code))
      .map((f) => f.rel)
      .sort();
    expect(callers).toEqual([
      "src/lib/attachments/uncertain-commit.ts",
      "src/lib/branding/logo-store.ts",
      "src/lib/projects/attachments.ts",
      "src/lib/projects/delete.ts",
    ]);
  });

  it("the logo store deletes no file itself: replace and remove only enqueue, and its staged rollback is saveStagedFiles", () => {
    const store = files.find((f) => f.rel === "src/lib/branding/logo-store.ts");
    expect(store).toBeDefined();
    const code = (store as SourceFile).code;
    expect(fileStorageDeletes(store as SourceFile)).toEqual([]);
    expect(code.match(/\benqueueFileCleanupInTx\s*\(/g)).toHaveLength(2);
    expect(code).toMatch(/\bsaveStagedFiles\s*\(/);
  });

  it("no code in src/ deletes an organization (the queue's organization cascade is unreachable from src/)", () => {
    const patterns = [
      /\borganization\s*\.\s*(?:delete|deleteMany)\s*\(/,
      /\bdeleteOrganization\b/,
      /DELETE\s+FROM\s+"?organization"?(?:\s|;|$)/i,
      /organization\/delete/,
    ];
    const offenders = files.filter((f) => patterns.some((p) => p.test(f.code))).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });
});
