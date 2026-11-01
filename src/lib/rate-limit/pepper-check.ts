// Boot check for RATE_LIMIT_PEPPER (review b-IN-b7). Called once from src/instrumentation.ts.
//
// The limiter reads the pepper per call and fails closed without one (check-rate-limit.ts): the
// four public routes then answer 500 and never store an unsalted address hash. That stays as it
// is; boot never fails here. What this adds is one clear log line per process, naming the setting,
// so an operator sees the cause at start-up instead of in a 500 on the first public request. The
// .env.example placeholder is accepted by the limiter, but anyone can read it, which makes the
// stored hashes as easy to reverse as unsalted ones, so it gets a line as well. The value itself
// is never logged.
//
// No project imports: loaded by instrumentation before anything else.

const PLACEHOLDER_PREFIX = "replace-me";

let warned = false;

export type RateLimitPepperProblem = "missing" | "placeholder";

export function rateLimitPepperProblem(value: string | undefined): RateLimitPepperProblem | null {
  // `||` semantics, as getPepper: compose injects an unset variable as the empty string.
  const pepper = (value ?? "").trim();
  if (!pepper) return "missing";
  if (pepper.startsWith(PLACEHOLDER_PREFIX)) return "placeholder";
  return null;
}

/** Logs at most one line per process when RATE_LIMIT_PEPPER is missing or the placeholder. */
export function warnIfRateLimitPepperUnsafe(): void {
  if (warned) return;
  const problem = rateLimitPepperProblem(process.env.RATE_LIMIT_PEPPER);
  if (!problem) return;
  warned = true;
  console.error(
    problem === "missing"
      ? "RATE_LIMIT_PEPPER is not set. The public request form, the status-page follow-up, CSAT and status-page attachment downloads answer 500 until it is set (they never store an unsalted address hash). Generate a value with: openssl rand -base64 32"
      : "RATE_LIMIT_PEPPER is still the placeholder from .env.example. Anyone can read that value, so the stored address hashes are as easy to reverse as unsalted ones. Set a random value, generated with: openssl rand -base64 32",
  );
}

export function resetRateLimitPepperWarningForTests(): void {
  warned = false;
}
