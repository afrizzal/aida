import { randomBytes } from "node:crypto";

// A dedicated high-entropy public status-page bearer token — never the ticket
// id/cuid. cuids are time-ordered with only partial randomness and routinely
// leak through logs/URLs/error messages; a separate token keeps `id` freely
// referenceable everywhere else without it also being a security secret.
export function generateStatusToken(): string {
  return randomBytes(24).toString("base64url");
}
