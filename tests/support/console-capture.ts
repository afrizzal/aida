// Console capture for "this must never reach the server log" assertions (d-WR-d2).
//
// JSON.stringify drops an Error's message, stack and cause (they are not enumerable own
// properties), so `console.error("...", { err })` with a raw secret inside the Error used to pass
// such checks. serializeLogArg uses util.inspect instead, deep and with hidden properties, so the
// message, stack, cause and nested values all appear in the text that is searched.
import { inspect } from "node:util";
import { type MockInstance, vi } from "vitest";

/** Every console method that can carry an error object to the server log. */
export const CONSOLE_METHODS = ["log", "info", "warn", "error", "debug"] as const;

export type ConsoleMethod = (typeof CONSOLE_METHODS)[number];

export type ConsoleSpies = Record<ConsoleMethod, MockInstance<(...args: unknown[]) => void>>;

/** The text a log argument can put on the server log: strings as-is, anything else inspected. */
export function serializeLogArg(arg: unknown): string {
  if (typeof arg === "string") return arg;
  return inspect(arg, { depth: 8, showHidden: true, breakLength: Number.POSITIVE_INFINITY });
}

/** Silences and records every method in CONSOLE_METHODS. Restore with restoreConsole(). */
export function spyOnConsole(): ConsoleSpies {
  const spies = {} as ConsoleSpies;
  for (const method of CONSOLE_METHODS) {
    spies[method] = vi
      .spyOn(console, method)
      .mockImplementation(() => {}) as ConsoleSpies[ConsoleMethod];
  }
  return spies;
}

export function restoreConsole(spies: ConsoleSpies): void {
  for (const method of CONSOLE_METHODS) spies[method].mockRestore();
}

/** Every argument of every captured call, serialized with serializeLogArg. */
export function loggedTexts(spies: ConsoleSpies): string[] {
  return CONSOLE_METHODS.flatMap((method) =>
    spies[method].mock.calls.flatMap((call) => call.map(serializeLogArg)),
  );
}
