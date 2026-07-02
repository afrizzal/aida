import { randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FileStorage } from "./file-storage";

const ROOT = process.env.UPLOADS_DIR ?? "/data/uploads";

// Keys are always server-generated (random hex + extension) — never derived from
// user-supplied filenames. This regex is the path-traversal guard: reject anything
// that isn't exactly that shape.
function safeKey(key: string): string {
  if (!/^[a-z0-9]+\.[a-z0-9]{1,8}$/i.test(key)) throw new Error("invalid attachment key");
  return key;
}

export const localFileStorage: FileStorage = {
  async save({ orgId, key, data }) {
    const dir = path.join(ROOT, orgId);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, safeKey(key)), data);
    return { key, sizeBytes: data.byteLength };
  },
  async read({ orgId, key }) {
    return readFile(path.join(ROOT, orgId, safeKey(key)));
  },
  async delete({ orgId, key }) {
    await unlink(path.join(ROOT, orgId, safeKey(key)));
  },
};

// Builds a server-generated, path-traversal-proof on-disk key. The original filename
// is stored ONLY as Attachment.originalFilename metadata, never used to construct a path.
export function buildStorageKey(originalFilename: string): string {
  const id = randomBytes(16).toString("hex");
  const rawExt = originalFilename.includes(".") ? (originalFilename.split(".").pop() ?? "") : "";
  const sanitizedExt = rawExt
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 8);
  const ext = sanitizedExt.length > 0 ? sanitizedExt : "bin";
  return `${id}.${ext}`;
}
