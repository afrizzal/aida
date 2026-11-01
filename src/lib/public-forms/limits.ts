// Field schemas and plain-English copy for the request limits of the public forms (the request
// form and the status page follow-up). The routes and the forms share these, so a client check
// and a server answer always use the same limit and the same words. The limits themselves live
// next to the byte caps in src/lib/attachments/constants.ts. Client-safe: no server imports.
import { z } from "zod/v4";
import { MAX_FILES_PER_REQUEST, PUBLIC_TEXT_LIMITS } from "@/lib/attachments/constants";

export type PublicFormKind = "request" | "follow-up";

/** Shown when more files are chosen than one request may carry, and for a 413 too_many_files. */
export function tooManyFilesMessage(kind: PublicFormKind): string {
  return `You can attach up to ${MAX_FILES_PER_REQUEST} files to one ${kind}.`;
}

function atMost(label: string, max: number): string {
  return `${label} must be at most ${max.toLocaleString("en-US")} characters.`;
}

/** The follow-up form's sentence for a message over PUBLIC_TEXT_LIMITS.message (K129). */
export const followUpTooLongMessage = `Your message is too long. The limit is ${PUBLIC_TEXT_LIMITS.message.toLocaleString("en-US")} characters.`;

/** Public intake fields (K129). A failure answers 400 with one zod issue per field. */
export const intakeSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(PUBLIC_TEXT_LIMITS.name, atMost("Name", PUBLIC_TEXT_LIMITS.name)),
  email: z
    .string()
    .email("Valid email address is required")
    .max(PUBLIC_TEXT_LIMITS.email, atMost("Email", PUBLIC_TEXT_LIMITS.email)),
  subject: z
    .string()
    .min(1, "Subject is required")
    .max(PUBLIC_TEXT_LIMITS.subject, atMost("Subject", PUBLIC_TEXT_LIMITS.subject)),
  message: z
    .string()
    .min(1, "Message is required")
    .max(PUBLIC_TEXT_LIMITS.message, atMost("Message", PUBLIC_TEXT_LIMITS.message)),
});

/** Public follow-up fields (K129). */
export const followUpSchema = z.object({
  message: z
    .string()
    .min(1, "Message is required")
    .max(PUBLIC_TEXT_LIMITS.message, atMost("Message", PUBLIC_TEXT_LIMITS.message)),
});

export type IntakeField = keyof z.infer<typeof intakeSchema>;

/** A zod issue as the routes send it in `{ error: "validation_failed", issues }`. */
export type FieldIssue = { path?: unknown[]; message?: unknown; code?: unknown };
