// AIDA-36 (D-14), plan 09-09 Task 3, threat T-09-31: the E2E fault hook is inert unless the
// server is not a production one AND AIDA_E2E_FAULTS is exactly "1". Request input alone (the
// cookie) never acts, and with the gate closed the hook never reads cookies at all.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cookiesMock } = vi.hoisted(() => ({ cookiesMock: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: cookiesMock }));

import {
  E2E_FAULT_COOKIE,
  E2E_FAULT_DELAY_MS,
  E2E_FAULT_POINTS,
  type E2EFaultPoint,
  e2eFault,
  resolveE2EFault,
} from "@/lib/testing/e2e-fault";

const PAGE_POINTS: readonly E2EFaultPoint[] = [
  "tickets-page",
  "ticket-detail-page",
  "contacts-page",
  "contact-detail-page",
];

/** A cookies() result holding the fault cookie with the given value (or none). */
function cookieStore(value: string | undefined) {
  return {
    get: (name: string) =>
      name === E2E_FAULT_COOKIE && value !== undefined ? { name, value } : undefined,
  };
}

describe("resolveE2EFault (pure gate)", () => {
  const open = { NODE_ENV: "development", AIDA_E2E_FAULTS: "1" };

  it("lists exactly the five fault points of the plan", () => {
    expect([...E2E_FAULT_POINTS].sort()).toEqual([...PAGE_POINTS, "tickets-list-delay"].sort());
  });

  it("returns null in production, even with the flag and a matching cookie", () => {
    for (const point of E2E_FAULT_POINTS) {
      expect(resolveE2EFault({ NODE_ENV: "production", AIDA_E2E_FAULTS: "1" }, point, point)).toBe(
        null,
      );
    }
  });

  it("returns null in development when the flag is unset or any value other than '1'", () => {
    for (const flag of [undefined, "", "0", "true", "yes", " 1", "1 ", "01", "on"]) {
      expect(
        resolveE2EFault(
          { NODE_ENV: "development", AIDA_E2E_FAULTS: flag },
          "tickets-page",
          "tickets-page",
        ),
      ).toBe(null);
    }
  });

  it("returns null when the cookie is absent or names a different point", () => {
    expect(resolveE2EFault(open, undefined, "tickets-page")).toBe(null);
    expect(resolveE2EFault(open, "", "tickets-page")).toBe(null);
    expect(resolveE2EFault(open, "contacts-page", "tickets-page")).toBe(null);
    expect(resolveE2EFault(open, "tickets-list-delay", "tickets-page")).toBe(null);
    expect(resolveE2EFault(open, "tickets-page", "tickets-list-delay")).toBe(null);
    expect(resolveE2EFault(open, "TICKETS-PAGE", "tickets-page")).toBe(null);
  });

  it("returns 'throw' for a page point and 'delay' for the list delay point when the gate is open", () => {
    for (const point of PAGE_POINTS) expect(resolveE2EFault(open, point, point)).toBe("throw");
    expect(resolveE2EFault(open, "tickets-list-delay", "tickets-list-delay")).toBe("delay");
    // NODE_ENV "test" is not production either.
    expect(
      resolveE2EFault({ NODE_ENV: "test", AIDA_E2E_FAULTS: "1" }, "tickets-page", "tickets-page"),
    ).toBe("throw");
  });
});

describe("e2eFault (server entry point)", () => {
  beforeEach(() => {
    cookiesMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("in production does nothing and never calls cookies(), with the flag and a matching cookie", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AIDA_E2E_FAULTS", "1");
    cookiesMock.mockResolvedValue(cookieStore("tickets-page"));
    for (const point of E2E_FAULT_POINTS) {
      await expect(e2eFault(point)).resolves.toBeUndefined();
    }
    expect(cookiesMock).not.toHaveBeenCalled();
  });

  it("with the flag unset or not exactly '1' does nothing and never calls cookies()", async () => {
    vi.stubEnv("NODE_ENV", "development");
    cookiesMock.mockResolvedValue(cookieStore("tickets-page"));
    for (const flag of [undefined, "", "0", "true", " 1"]) {
      vi.stubEnv("AIDA_E2E_FAULTS", flag);
      await expect(e2eFault("tickets-page")).resolves.toBeUndefined();
    }
    expect(cookiesMock).not.toHaveBeenCalled();
  });

  it("with the gate open throws for a matching page point, naming only the point", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AIDA_E2E_FAULTS", "1");
    for (const point of PAGE_POINTS) {
      cookiesMock.mockResolvedValue(cookieStore(point));
      await expect(e2eFault(point)).rejects.toThrow(new Error(`E2E fault: ${point}`));
    }
    expect(cookiesMock).toHaveBeenCalledTimes(PAGE_POINTS.length);
  });

  it("with the gate open does nothing when the cookie is absent or names another point", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AIDA_E2E_FAULTS", "1");
    cookiesMock.mockResolvedValue(cookieStore(undefined));
    await expect(e2eFault("tickets-page")).resolves.toBeUndefined();
    cookiesMock.mockResolvedValue(cookieStore("contacts-page"));
    await expect(e2eFault("tickets-page")).resolves.toBeUndefined();
  });

  it("with the gate open waits the fixed delay for the list delay point", async () => {
    vi.useFakeTimers();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AIDA_E2E_FAULTS", "1");
    cookiesMock.mockResolvedValue(cookieStore("tickets-list-delay"));
    let settled = false;
    const pending = e2eFault("tickets-list-delay").then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(E2E_FAULT_DELAY_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(settled).toBe(true);
    expect(E2E_FAULT_DELAY_MS).toBe(4000);
  });
});
