// The invitation link token (Phase 10, D-04, threat T-10-17): 32 random bytes (256 bits) in
// base64url, given to the inviter once in the link. Only its SHA-256 hex hash is stored, in
// invitation.tokenHash, so a database read never yields a usable link. The Better Auth
// invitation id is never the token (the plugin's list endpoints expose it).
//
// No logging here or in any caller: the token is a bearer credential.
//
// Relative imports only and no framework import.
import { createHash, randomBytes } from "node:crypto";

/** The number of random bytes in a token. */
export const INVITE_TOKEN_BYTES = 32;

/** A fresh link token: 32 random bytes, base64url (43 characters, no padding). */
export function createInviteToken(): string {
  return randomBytes(INVITE_TOKEN_BYTES).toString("base64url");
}

/** The stored form of a token: hex SHA-256 of its UTF-8 bytes (64 lowercase hex characters). */
export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** True for a string in the shape createInviteToken produces; anything else is never looked up. */
export function isInviteTokenShape(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}
