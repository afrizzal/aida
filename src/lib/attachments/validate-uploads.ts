// Public upload validation and storage (plan 08-13, D-24, AIDA-30, F-12).
//
// validateUploadFiles checks every file (per-file size, running total against the combined cap,
// sniffed content type) and stores nothing, so a later invalid file leaves no earlier file on
// disk. storeValidatedUploads saves the validated files and, if one save fails, deletes the ones
// already saved before rethrowing. removeStoredUploads is the cleanup for a later failure
// (ticket creation, attachment rows, a rolled-back transaction); it is best-effort and never
// throws, so the caller's own error survives (see staged-files.ts for the delete semantics).
import { fileTypeFromBuffer } from "file-type";
import { ALLOWED_MIME, MAX_BYTES, MAX_TOTAL_REQUEST_BYTES } from "@/lib/attachments/constants";
import { buildStorageKey, localFileStorage } from "@/lib/attachments/local-file-storage";
import { saveStagedFiles } from "@/lib/attachments/staged-files";

export type ValidatedUpload = {
  data: Buffer;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
};

export type StoredUpload = ValidatedUpload & { storageKey: string };

export type UploadValidationResult =
  | { ok: true; uploads: ValidatedUpload[] }
  | {
      ok: false;
      status: 413 | 415;
      error: "file_too_large" | "payload_too_large" | "unsupported_file_type";
    };

export async function validateUploadFiles(files: File[]): Promise<UploadValidationResult> {
  const uploads: ValidatedUpload[] = [];
  let totalBytes = 0;
  for (const file of files) {
    if (file.size > MAX_BYTES) {
      return { ok: false, status: 413, error: "file_too_large" };
    }
    totalBytes += file.size;
    if (totalBytes > MAX_TOTAL_REQUEST_BYTES) {
      return { ok: false, status: 413, error: "payload_too_large" };
    }
    const data = Buffer.from(await file.arrayBuffer());
    const sniffed = await fileTypeFromBuffer(data);
    if (!sniffed || !ALLOWED_MIME.has(sniffed.mime)) {
      return { ok: false, status: 415, error: "unsupported_file_type" };
    }
    uploads.push({
      data,
      originalFilename: file.name,
      mimeType: sniffed.mime,
      sizeBytes: file.size,
    });
  }
  return { ok: true, uploads };
}

export async function storeValidatedUploads(
  orgId: string,
  uploads: readonly ValidatedUpload[],
): Promise<StoredUpload[]> {
  const stored = uploads.map((u) => ({ ...u, storageKey: buildStorageKey(u.originalFilename) }));
  // saveStagedFiles deletes every attempted key and rethrows when a save fails.
  await saveStagedFiles(
    localFileStorage,
    orgId,
    stored.map((s) => ({ key: s.storageKey, data: s.data })),
  );
  return stored;
}

export async function removeStoredUploads(orgId: string, keys: readonly string[]): Promise<void> {
  for (const key of keys) {
    try {
      await localFileStorage.delete({ orgId, key });
    } catch (err) {
      const code = err && typeof err === "object" && "code" in err ? String(err.code) : "UNKNOWN";
      if (code === "ENOENT") continue;
      try {
        console.error(`[attachments] stored upload delete failed: key=${key} code=${code}`);
      } catch {
        // Logging must never replace the request's own error.
      }
    }
  }
}
