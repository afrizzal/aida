// Parser for the auto-close quiet period in days (Phase 11, D-15, AIDA-51). Pure, relative
// imports only: the settings form, the settings service and the worker job all use it.
//
// Accepted: an integer number 0..365, or a string that, after trimming surrounding whitespace,
// consists of ASCII digits only and denotes 0..365 (leading zeros are normalised: "007" is 7).
// Refused: everything else, including "", "1.5", "1e2", "+5", "-1", non-ASCII digits and 366.

export const MAX_AUTO_CLOSE_DAYS = 365;

export type AutoCloseDaysResult = { ok: true; days: number } | { ok: false };

const ASCII_DIGITS = /^[0-9]+$/;

export function parseAutoCloseDays(raw: unknown): AutoCloseDaysResult {
  if (typeof raw === "number") {
    if (!Number.isInteger(raw) || raw < 0 || raw > MAX_AUTO_CLOSE_DAYS) return { ok: false };
    return { ok: true, days: raw === 0 ? 0 : raw };
  }
  if (typeof raw !== "string") return { ok: false };
  const trimmed = raw.trim();
  if (!ASCII_DIGITS.test(trimmed)) return { ok: false };
  const significant = trimmed.replace(/^0+(?=[0-9])/, "");
  // At most three significant digits can be 0..365; this also keeps huge inputs out of Number.
  if (significant.length > 3) return { ok: false };
  const days = Number(significant);
  if (days > MAX_AUTO_CLOSE_DAYS) return { ok: false };
  return { ok: true, days };
}
