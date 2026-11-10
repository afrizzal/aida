// Phase 10, plan 10-11 Task 1 (AIDA-44, D-19, UI-SPEC Surface 3 and Copywriting): the bell's
// count pill, its accessible name and the row sentences, including the fallbacks for a ticket or
// actor that is gone.
import { describe, expect, it } from "vitest";
import {
  bellLabel,
  EMPTY_SUBJECT,
  formatBellCount,
  notificationSentence,
  notificationSubject,
  SUBJECT_FALLBACK,
} from "@/lib/notifications/format";

describe("formatBellCount", () => {
  it("shows no pill at zero", () => {
    expect(formatBellCount(0)).toBeNull();
  });

  it("shows the digit from 1 to 9", () => {
    expect(formatBellCount(1)).toBe("1");
    expect(formatBellCount(9)).toBe("9");
  });

  it("shows 9+ from 10", () => {
    expect(formatBellCount(10)).toBe("9+");
    expect(formatBellCount(99)).toBe("9+");
  });

  it("treats a negative or non-finite count as zero", () => {
    expect(formatBellCount(-3)).toBeNull();
    expect(formatBellCount(Number.NaN)).toBeNull();
  });
});

describe("bellLabel", () => {
  it("names the bell without a count at zero", () => {
    expect(bellLabel(0)).toBe("Notifications");
  });

  it("carries the exact count, never the capped pill text", () => {
    expect(bellLabel(1)).toBe("Notifications, 1 unread");
    expect(bellLabel(9)).toBe("Notifications, 9 unread");
    expect(bellLabel(10)).toBe("Notifications, 10 unread");
    expect(bellLabel(99)).toBe("Notifications, 99 unread");
  });
});

describe("notificationSentence", () => {
  it("writes each type with the ticket number", () => {
    expect(notificationSentence({ type: "ASSIGNED", ticketNumber: 118 })).toBe(
      "Ticket #118 was assigned to you",
    );
    expect(notificationSentence({ type: "CUSTOMER_REPLY", ticketNumber: 118 })).toBe(
      "New customer reply on ticket #118",
    );
    expect(notificationSentence({ type: "MENTION", ticketNumber: 118, actorName: "Dana" })).toBe(
      "Dana mentioned you on ticket #118",
    );
    expect(notificationSentence({ type: "SLA_AT_RISK", ticketNumber: 118 })).toBe(
      "Ticket #118 is at risk of missing its SLA",
    );
    expect(notificationSentence({ type: "SLA_BREACHED", ticketNumber: 118 })).toBe(
      "Ticket #118 missed its SLA",
    );
  });

  it("falls back to 'a ticket' when the ticket is gone", () => {
    expect(notificationSentence({ type: "ASSIGNED", ticketNumber: null })).toBe(
      "A ticket was assigned to you",
    );
    expect(notificationSentence({ type: "CUSTOMER_REPLY", ticketNumber: null })).toBe(
      "New customer reply on a ticket",
    );
    expect(notificationSentence({ type: "MENTION", ticketNumber: null, actorName: "Dana" })).toBe(
      "Dana mentioned you on a ticket",
    );
    expect(notificationSentence({ type: "SLA_AT_RISK", ticketNumber: null })).toBe(
      "A ticket is at risk of missing its SLA",
    );
    expect(notificationSentence({ type: "SLA_BREACHED", ticketNumber: null })).toBe(
      "A ticket missed its SLA",
    );
  });

  it("falls back to 'Someone' for a mention without a known actor", () => {
    expect(notificationSentence({ type: "MENTION", ticketNumber: 7, actorName: null })).toBe(
      "Someone mentioned you on ticket #7",
    );
    expect(notificationSentence({ type: "MENTION", ticketNumber: 7 })).toBe(
      "Someone mentioned you on ticket #7",
    );
    expect(notificationSentence({ type: "MENTION", ticketNumber: 7, actorName: "   " })).toBe(
      "Someone mentioned you on ticket #7",
    );
    expect(notificationSentence({ type: "MENTION", ticketNumber: null, actorName: null })).toBe(
      "Someone mentioned you on a ticket",
    );
  });

  it("keeps markup in an actor name as plain text", () => {
    expect(
      notificationSentence({ type: "MENTION", ticketNumber: 3, actorName: "<b>Eve</b>" }),
    ).toBe("<b>Eve</b> mentioned you on ticket #3");
  });
});

describe("notificationSubject", () => {
  it("keeps a stored subject as it is", () => {
    expect(notificationSubject("Printer on fire")).toBe("Printer on fire");
  });

  it("falls back when the ticket is gone or the subject is empty", () => {
    expect(notificationSubject(null)).toBe(SUBJECT_FALLBACK);
    expect(notificationSubject("  ")).toBe(EMPTY_SUBJECT);
  });
});
