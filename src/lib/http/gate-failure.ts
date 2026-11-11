// What an API route answers when its session gate throws something other than AccessDeniedError
// (review a-IN-7). The gates read the session and the member rows, so a database outage throws
// here too; that is not "signed out". Only the gate's redirect to /login (no session) becomes a
// 401; anything else is a 500 with one fixed log line that carries the route and the error class,
// never the error text (it may name a host or hold request data).
//
// No framework import: the redirect is recognised by the digest Next gives it (the same test as
// Next's own isRedirectError), so a route keeps its own response shape.

export type GateFailure = "unauthorized" | "internal";

/** True for the error next/navigation's redirect() throws: digest `NEXT_REDIRECT;<type>;<url>;<status>;`. */
export function isRedirectSignal(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const digest = (err as { digest?: unknown }).digest;
  if (typeof digest !== "string") return false;
  const [code, type] = digest.split(";");
  return code === "NEXT_REDIRECT" && (type === "replace" || type === "push");
}

function errorClass(err: unknown): string {
  if (err instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(err.name)) return err.name;
  return "unknown";
}

/**
 * Classifies a gate failure that is not AccessDeniedError (the caller handles that one first):
 * the redirect to /login is `unauthorized` (401); everything else is `internal` (500) and logs
 * `[<route>] session gate failed: <error class>`.
 */
export function classifyGateFailure(route: string, err: unknown): GateFailure {
  if (isRedirectSignal(err)) return "unauthorized";
  try {
    console.error(`[${route}] session gate failed: ${errorClass(err)}`);
  } catch {
    // Logging must never replace the response.
  }
  return "internal";
}

/** The HTTP status of a gate failure. */
export function gateFailureStatus(failure: GateFailure): 401 | 500 {
  return failure === "unauthorized" ? 401 : 500;
}
