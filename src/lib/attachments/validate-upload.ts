// Phase 14, contract C10 and D-14: the shared upload validator for task attachments. One helper,
// not a fifth inline copy; the four existing inline checks (ticket messages, public intake,
// public follow-up and the email channel) are left as they are.
//
// Order matters: the declared size is checked against MAX_BYTES before a single byte is read, then
// the bytes are sniffed by their magic number (file-type) against ALLOWED_MIME; the client's
// declared type and the file name's extension are never trusted. The file name is untrusted
// metadata (D-14): it is cleaned into a display name only (control characters removed, trimmed,
// cut to FILE_NAME_MAX code points, "file" when nothing is left) and is never used for a path.
// The storage key comes from buildStorageKey (local-file-storage.ts) only.
import { fileTypeFromBuffer } from "file-type";
import { FILE_NAME_MAX } from "../projects/contract";
import { ALLOWED_MIME, MAX_BYTES } from "./constants";

/** The part of a web File the validator reads. */
export type UploadCandidate = {
  name: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
};

export type ValidatedUpload = {
  ok: true;
  buffer: Buffer;
  mimeType: string;
  sizeBytes: number;
  originalFilename: string;
};

export type UploadRefusal = { ok: false; code: "FILE_TOO_LARGE" | "UNSUPPORTED_FILE_TYPE" };

const FALLBACK_FILE_NAME = "file";

function isControlCodePoint(codePoint: number): boolean {
  return codePoint <= 0x1f || codePoint === 0x7f;
}

/** The display name of an uploaded file: metadata only, never a path. */
export function cleanDisplayName(raw: string): string {
  let kept = "";
  for (const char of raw) {
    if (!isControlCodePoint(char.codePointAt(0) ?? 0)) kept += char;
  }
  const trimmed = kept.trim();
  const cut = [...trimmed].slice(0, FILE_NAME_MAX).join("").trim();
  return cut === "" ? FALLBACK_FILE_NAME : cut;
}

export async function validateUpload(
  file: UploadCandidate,
): Promise<ValidatedUpload | UploadRefusal> {
  if (!Number.isFinite(file.size) || file.size < 0 || file.size > MAX_BYTES) {
    return { ok: false, code: "FILE_TOO_LARGE" };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  // The declared size is the client's word; the bytes actually read are checked too.
  if (buffer.length > MAX_BYTES) return { ok: false, code: "FILE_TOO_LARGE" };

  const sniffed = buffer.length === 0 ? undefined : await fileTypeFromBuffer(buffer);
  if (!sniffed || !ALLOWED_MIME.has(sniffed.mime)) {
    return { ok: false, code: "UNSUPPORTED_FILE_TYPE" };
  }

  return {
    ok: true,
    buffer,
    mimeType: sniffed.mime,
    sizeBytes: buffer.length,
    originalFilename: cleanDisplayName(file.name),
  };
}
