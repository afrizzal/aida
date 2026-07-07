import { describe, expect, it } from "vitest";
import { redactSecrets } from "../../src/lib/llm/redact";

describe("redactSecrets", () => {
  it("redacts an OpenAI-style API key (sk-proj-...)", () => {
    const text = "here is my key sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 please use it";
    expect(redactSecrets(text)).toBe("here is my key [redacted] please use it");
  });

  it("redacts an Anthropic-style API key (sk-ant-...)", () => {
    const text = "key: sk-ant-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    expect(redactSecrets(text)).toBe("key: [redacted]");
  });

  it("redacts an AWS access key id (AKIA + 16 uppercase/digits)", () => {
    const text = "aws_access_key_id = AKIAABCDEFGHIJ1234";
    expect(redactSecrets(text)).toBe("aws_access_key_id = [redacted]");
  });

  it("redacts a Bearer token (>=20 chars)", () => {
    const text = "Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345";
    expect(redactSecrets(text)).toBe("Authorization: [redacted]");
  });

  it("redacts a 16-digit card-like sequence", () => {
    const text = "card number 4111111111111111 expires soon";
    expect(redactSecrets(text)).toBe("card number [redacted] expires soon");
  });

  it("redacts a card-like sequence with dashes/spaces", () => {
    const text = "card 4111-1111-1111-1111 on file";
    expect(redactSecrets(text)).toBe("card [redacted] on file");
  });

  it("leaves ordinary ticket prose untouched (idempotent on clean text)", () => {
    const text =
      "Hi team, my invoice #4521 didn't arrive and I'm frustrated. Can someone check the account?";
    expect(redactSecrets(text)).toBe(text);
  });
});
