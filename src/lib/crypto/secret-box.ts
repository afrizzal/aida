// AES-256-GCM "secret box" — the codebase's one at-rest encryption primitive for credentials
// (IMAP/SMTP passwords in Phase 3; LLM provider keys in Phase 4). Reused verbatim, not
// reimplemented, by future consumers.
//
// node:crypto only — no internal project imports — so this file is safely bundleable by both
// Next.js (webpack) and the worker (esbuild).
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit — GCM-recommended IV size
const TAG_LENGTH = 16; // GCM auth tag is always 16 bytes

function getKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) throw new Error("APP_ENCRYPTION_KEY is required to encrypt/decrypt secrets");
  const key = Buffer.from(raw, "base64"); // matches this repo's `openssl rand -base64 32` convention
  if (key.length !== 32) {
    throw new Error(
      "APP_ENCRYPTION_KEY must decode to exactly 32 bytes (generate with: openssl rand -base64 32)",
    );
  }
  return key;
}

/**
 * Encrypts a plaintext string with AES-256-GCM using a fresh random IV per call.
 * Packs iv + authTag + ciphertext into one opaque base64 string — fits the existing
 * `Setting.value: String` column with ZERO schema changes required for credential storage.
 *
 * Never logs the plaintext or the resulting ciphertext (SECURITY.md: credentials never logged).
 */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

/**
 * Decrypts a blob produced by `encryptSecret`. Throws (GCM auth-tag failure) on any tampering
 * or wrong key — never silently returns a value for a corrupted/tampered blob.
 */
export function decryptSecret(packed: string): string {
  const raw = Buffer.from(packed, "base64");
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = raw.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag); // MUST be called before .final()
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
