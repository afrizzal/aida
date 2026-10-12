// Phase 14, contract section 7 (D-09, C15): the pure recurrence date rules. Relative imports only,
// no date package: CalendarDate strings (YYYY-MM-DD, 1970-01-01 to 2999-12-31) and Date.UTC
// arithmetic on whole days, plus Intl (todayInTimeZone) for "today" in a time zone.
//
// The rules restated:
// - Sequence: the anchor, then +1 day (DAILY), +7 days (WEEKLY), or for MONTHLY the anchor's day
//   of month in each following month, clamped to that month's last day and computed from the
//   anchor each time, never chained from a clamped date (31 Jan, 28 or 29 Feb, 31 Mar, 30 Apr).
// - Next occurrence: the first sequence date strictly after the base. The index is computed
//   directly from the day or month distance, then corrected one step at a time (at most twice),
//   so a series running for centuries costs the same as one running for a week.
// - Base: dueDate, else startDate, else today in the series time zone at completion (a task
//   without dates). The zone database handles a daylight-saving change; no fixed offset is used.
// - The anchor is a calendar date and is never converted between time zones.
// - Successor dates: due = next when there was a due date; start shifted to keep the gap when both
//   existed; start = next when only a start existed; due = next when neither existed.
// Every function throws a RangeError on an invalid calendar date, rule, count, time zone or clock,
// and when a result would pass 2999-12-31: the services validate their input first, so a throw
// here is a programming error, never a user refusal.
import {
  type CalendarDate,
  isValidTimeZone,
  parseCalendarDate,
  RECURRENCE_RULES,
  type RecurrenceRule,
  todayInTimeZone,
} from "./contract";

const DAY_MS = 86_400_000;
const MAX_CORRECTIONS = 2;

function checkDate(value: unknown, what: string): CalendarDate {
  const parsed = parseCalendarDate(value);
  if (parsed === null) throw new RangeError(`Invalid calendar date for ${what}`);
  return parsed;
}

function checkRule(rule: unknown): RecurrenceRule {
  if (!(RECURRENCE_RULES as readonly unknown[]).includes(rule)) {
    throw new RangeError("Invalid recurrence rule");
  }
  return rule as RecurrenceRule;
}

function checkClock(now: Date): void {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new RangeError("Invalid clock");
}

function checkTimeZone(timeZone: string): void {
  if (!isValidTimeZone(timeZone)) throw new RangeError("Invalid time zone");
}

type Parts = { year: number; month: number; day: number };

function partsOf(date: CalendarDate): Parts {
  return {
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)),
    day: Number(date.slice(8, 10)),
  };
}

/** Days since 1970-01-01 of a valid calendar date. */
function dayNumber(date: CalendarDate): number {
  const { year, month, day } = partsOf(date);
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/** A calendar date from its parts, refused when it falls outside 1970-01-01 to 2999-12-31. */
function dateOf(year: number, month: number, day: number): CalendarDate {
  return checkDate(`${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`, "a computed result");
}

function dateFromDayNumber(days: number): CalendarDate {
  const date = new Date(days * DAY_MS);
  return dateOf(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The calendar date `days` whole days after (or before, when negative) the given date. */
export function addDays(date: CalendarDate, days: number): CalendarDate {
  const valid = checkDate(date, "addDays");
  if (!Number.isInteger(days)) throw new RangeError("Invalid day count");
  return dateFromDayNumber(dayNumber(valid) + days);
}

function sequenceAt(anchor: CalendarDate, rule: RecurrenceRule, index: number): CalendarDate {
  if (rule === "DAILY") return dateFromDayNumber(dayNumber(anchor) + index);
  if (rule === "WEEKLY") return dateFromDayNumber(dayNumber(anchor) + 7 * index);
  const { year, month, day } = partsOf(anchor);
  const monthIndex = month - 1 + index;
  const targetYear = year + Math.floor(monthIndex / 12);
  const targetMonth = (monthIndex % 12) + 1;
  return dateOf(targetYear, targetMonth, Math.min(day, daysInMonth(targetYear, targetMonth)));
}

/** The sequence date with the given index (0 is the anchor itself). */
export function sequenceDate(
  anchor: CalendarDate,
  rule: RecurrenceRule,
  index: number,
): CalendarDate {
  const validAnchor = checkDate(anchor, "the anchor");
  const validRule = checkRule(rule);
  if (!Number.isInteger(index) || index < 0) throw new RangeError("Invalid sequence index");
  return sequenceAt(validAnchor, validRule, index);
}

export type NextOccurrenceDetail = {
  /** The first sequence date strictly after the base. */
  date: CalendarDate;
  /** Its sequence index. */
  index: number;
  /** The single-step corrections taken after the direct index computation (at most 2). */
  steps: number;
};

/**
 * The next occurrence with how it was found: the index computed directly from the day or month
 * distance between the anchor and the base, then at most two single-step corrections.
 */
export function nextOccurrenceDetailed(
  anchor: CalendarDate,
  rule: RecurrenceRule,
  base: CalendarDate,
): NextOccurrenceDetail {
  const validAnchor = checkDate(anchor, "the anchor");
  const validRule = checkRule(rule);
  const validBase = checkDate(base, "the base");
  // YYYY-MM-DD strings compare in calendar order.
  if (validBase < validAnchor) return { date: validAnchor, index: 0, steps: 0 };

  let index: number;
  if (validRule === "MONTHLY") {
    const a = partsOf(validAnchor);
    const b = partsOf(validBase);
    // The sequence date in the base's own month.
    index = (b.year - a.year) * 12 + (b.month - a.month);
  } else {
    const period = validRule === "DAILY" ? 1 : 7;
    // The last sequence date on or before the base.
    index = Math.floor((dayNumber(validBase) - dayNumber(validAnchor)) / period);
  }

  let steps = 0;
  let date = sequenceAt(validAnchor, validRule, index);
  while (date <= validBase) {
    steps += 1;
    if (steps > MAX_CORRECTIONS) throw new RangeError("Recurrence index correction overrun");
    index += 1;
    date = sequenceAt(validAnchor, validRule, index);
  }
  while (index > 0) {
    const previous = sequenceAt(validAnchor, validRule, index - 1);
    if (previous <= validBase) break;
    steps += 1;
    if (steps > MAX_CORRECTIONS) throw new RangeError("Recurrence index correction overrun");
    index -= 1;
    date = previous;
  }
  return { date, index, steps };
}

/** The first sequence date strictly after the base. */
export function nextOccurrence(
  anchor: CalendarDate,
  rule: RecurrenceRule,
  base: CalendarDate,
): CalendarDate {
  return nextOccurrenceDetailed(anchor, rule, base).date;
}

type TaskDates = { dueDate: CalendarDate | null; startDate: CalendarDate | null };

/** The base of an occurrence: dueDate, else startDate, else today in the series time zone. */
export function occurrenceBase(task: TaskDates, timeZone: string, now: Date): CalendarDate {
  if (task.dueDate !== null) return checkDate(task.dueDate, "the dueDate");
  if (task.startDate !== null) return checkDate(task.startDate, "the startDate");
  checkTimeZone(timeZone);
  checkClock(now);
  return todayInTimeZone(timeZone, now);
}

/** The successor's dates for the next occurrence (contract section 7). */
export function successorDates(predecessor: TaskDates, next: CalendarDate): TaskDates {
  const validNext = checkDate(next, "the next occurrence");
  const due = predecessor.dueDate === null ? null : checkDate(predecessor.dueDate, "the dueDate");
  const start =
    predecessor.startDate === null ? null : checkDate(predecessor.startDate, "the startDate");
  if (due !== null && start !== null) {
    const gap = dayNumber(due) - dayNumber(start);
    return { startDate: addDays(validNext, -gap), dueDate: validNext };
  }
  if (due === null && start !== null) return { startDate: validNext, dueDate: null };
  return { startDate: null, dueDate: validNext };
}

/** The anchor of a new series: anchorDate, else dueDate, else startDate, else today in the zone. */
export function initialAnchor(
  input: {
    anchorDate?: CalendarDate | null;
    dueDate?: CalendarDate | null;
    startDate?: CalendarDate | null;
  },
  timeZone: string,
  now: Date,
): CalendarDate {
  if (input.anchorDate != null) return checkDate(input.anchorDate, "the anchorDate");
  if (input.dueDate != null) return checkDate(input.dueDate, "the dueDate");
  if (input.startDate != null) return checkDate(input.startDate, "the startDate");
  checkTimeZone(timeZone);
  checkClock(now);
  return todayInTimeZone(timeZone, now);
}
