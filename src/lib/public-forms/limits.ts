// Plain-English copy for the request limits of the public forms (the request form and the status
// page follow-up). The limits themselves live next to the byte caps in
// src/lib/attachments/constants.ts. Client-safe: no server imports.
import { MAX_FILES_PER_REQUEST } from "@/lib/attachments/constants";

export type PublicFormKind = "request" | "follow-up";

/** Shown when more files are chosen than one request may carry, and for a 413 too_many_files. */
export function tooManyFilesMessage(kind: PublicFormKind): string {
  return `You can attach up to ${MAX_FILES_PER_REQUEST} files to one ${kind}.`;
}
