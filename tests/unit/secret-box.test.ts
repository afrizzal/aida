import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "../../src/lib/crypto/secret-box";

describe("secret-box", () => {
  beforeAll(() => {
    process.env.APP_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  });

  it("round-trips a UTF-8 string exactly, including unicode", () => {
    const original = "s3cr3t-éèà-p@ssw0rd-🔐";
    const packed = encryptSecret(original);
    expect(decryptSecret(packed)).toBe(original);
  });

  it("uses a fresh IV per call (two calls on the same input differ)", () => {
    const a = encryptSecret("same-input");
    const b = encryptSecret("same-input");
    expect(a).not.toBe(b);
  });

  it("throws when decrypting a tampered (byte-flipped) blob", () => {
    const packed = encryptSecret("tamper-me");
    const raw = Buffer.from(packed, "base64");
    // Flip one byte in the ciphertext region (after 12-byte IV + 16-byte auth tag).
    const tamperedIndex = 12 + 16;
    raw[tamperedIndex] = raw[tamperedIndex] ^ 0xff;
    const tampered = raw.toString("base64");
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("throws a clear error when APP_ENCRYPTION_KEY is unset", () => {
    const saved = process.env.APP_ENCRYPTION_KEY;
    delete process.env.APP_ENCRYPTION_KEY;
    try {
      expect(() => encryptSecret("x")).toThrow(/APP_ENCRYPTION_KEY is required/);
    } finally {
      process.env.APP_ENCRYPTION_KEY = saved;
    }
  });

  it("throws when APP_ENCRYPTION_KEY does not decode to exactly 32 bytes", () => {
    const saved = process.env.APP_ENCRYPTION_KEY;
    process.env.APP_ENCRYPTION_KEY = Buffer.from("too-short").toString("base64");
    try {
      expect(() => encryptSecret("x")).toThrow(/must decode to exactly 32 bytes/);
    } finally {
      process.env.APP_ENCRYPTION_KEY = saved;
    }
  });
});
