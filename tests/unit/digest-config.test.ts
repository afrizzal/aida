// Phase 10, plan 10-09 (AIDA-46, D-24, V-15, V-29): the digest's operator setting and timing.
import { describe, expect, it } from "vitest";
import {
  assertDigestTiming,
  COMMIT_MARGIN_MS,
  DEFAULT_DIGEST_INTERVAL_HOURS,
  DIGEST_INTERVAL_HOURS,
  DIGEST_TIMING,
  digestCron,
  digestIntervalHours,
  digestIntervalText,
  LEASE_MS,
  NOTIFICATION_DIGEST_QUEUE,
  SEND_DEADLINE_MS,
  SMTP_TIMEOUT_MS,
} from "@/lib/notifications/digest-config";

const env = (value: string | undefined) => ({ AIDA_DIGEST_INTERVAL_HOURS: value });

describe("digest interval (AIDA_DIGEST_INTERVAL_HOURS)", () => {
  it("names the queue", () => {
    expect(NOTIFICATION_DIGEST_QUEUE).toBe("notification-digest");
  });

  it("allows exactly 1, 2, 3, 4, 6, 8, 12 and 24, with 4 as the default", () => {
    expect([...DIGEST_INTERVAL_HOURS]).toEqual([1, 2, 3, 4, 6, 8, 12, 24]);
    expect(DEFAULT_DIGEST_INTERVAL_HOURS).toBe(4);
  });

  it.each([
    ["1", 1, "0 * * * *", "every hour"],
    ["2", 2, "0 */2 * * *", "every 2 hours"],
    ["3", 3, "0 */3 * * *", "every 3 hours"],
    ["4", 4, "0 */4 * * *", "every 4 hours"],
    ["6", 6, "0 */6 * * *", "every 6 hours"],
    ["8", 8, "0 */8 * * *", "every 8 hours"],
    ["12", 12, "0 */12 * * *", "every 12 hours"],
    ["24", 24, "0 0 * * *", "once a day"],
    [" 6 ", 6, "0 */6 * * *", "every 6 hours"],
  ])("value %j reads as %d hours, cron %j, text %j", (raw, hours, cron, text) => {
    expect(digestIntervalHours(env(raw))).toBe(hours);
    expect(digestCron(env(raw))).toBe(cron);
    expect(digestIntervalText(env(raw))).toBe(text);
  });

  it.each([
    [undefined],
    [""],
    ["   "],
    ["0"],
    ["5"],
    ["7"],
    ["48"],
    ["-4"],
    ["4.5"],
    ["4h"],
    ["0x4"],
    ["four"],
    ["004"],
  ])("falls back to 4 hours for %j", (raw) => {
    expect(digestIntervalHours(env(raw))).toBe(4);
    expect(digestCron(env(raw))).toBe("0 */4 * * *");
    expect(digestIntervalText(env(raw))).toBe("every 4 hours");
  });

  it("reads process.env by default", () => {
    const saved = process.env.AIDA_DIGEST_INTERVAL_HOURS;
    try {
      process.env.AIDA_DIGEST_INTERVAL_HOURS = "12";
      expect(digestIntervalHours()).toBe(12);
      delete process.env.AIDA_DIGEST_INTERVAL_HOURS;
      expect(digestIntervalHours()).toBe(4);
    } finally {
      if (saved === undefined) delete process.env.AIDA_DIGEST_INTERVAL_HOURS;
      else process.env.AIDA_DIGEST_INTERVAL_HOURS = saved;
    }
  });
});

describe("digest timing (V-29)", () => {
  it("ships a 45 s deadline, a 15 s commit margin, a 5 min lease and a 10 s SMTP timeout", () => {
    expect(SEND_DEADLINE_MS).toBe(45_000);
    expect(COMMIT_MARGIN_MS).toBe(15_000);
    expect(LEASE_MS).toBe(300_000);
    expect(SMTP_TIMEOUT_MS).toBe(10_000);
    expect(DIGEST_TIMING).toEqual({
      sendDeadlineMs: 45_000,
      commitMarginMs: 15_000,
      leaseMs: 300_000,
      smtpTimeoutMs: 10_000,
    });
    expect(Object.isFrozen(DIGEST_TIMING)).toBe(true);
  });

  it("accepts the shipped values and the test override used by the integration suite", () => {
    expect(() => assertDigestTiming(DIGEST_TIMING)).not.toThrow();
    expect(() =>
      assertDigestTiming({
        sendDeadlineMs: 2_500,
        commitMarginMs: 15_000,
        leaseMs: 300_000,
        smtpTimeoutMs: 1_000,
      }),
    ).not.toThrow();
  });

  it("refuses a lease that does not exceed the deadline plus the margin", () => {
    expect(() =>
      assertDigestTiming({ ...DIGEST_TIMING, leaseMs: SEND_DEADLINE_MS + COMMIT_MARGIN_MS }),
    ).toThrow(/lease must exceed/);
    expect(() => assertDigestTiming({ ...DIGEST_TIMING, leaseMs: 10_000 })).toThrow(
      /lease must exceed/,
    );
  });

  it("refuses a deadline that does not exceed the SMTP timeout", () => {
    expect(() => assertDigestTiming({ ...DIGEST_TIMING, sendDeadlineMs: SMTP_TIMEOUT_MS })).toThrow(
      /deadline must exceed the SMTP timeout/,
    );
  });

  it.each([
    ["sendDeadlineMs", 0],
    ["commitMarginMs", -1],
    ["leaseMs", Number.NaN],
    ["smtpTimeoutMs", Number.POSITIVE_INFINITY],
  ])("refuses %s = %d", (name, value) => {
    expect(() => assertDigestTiming({ ...DIGEST_TIMING, [name]: value })).toThrow(
      new RegExp(`${name} must be a positive number`),
    );
  });
});
