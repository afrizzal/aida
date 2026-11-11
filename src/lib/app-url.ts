// The application's own base URL and origin, from configuration only (Phase 10, D-06, V-15).
//
// Invitation links (and later digest links) and the expected Origin of the invitation accept
// route come from BETTER_AUTH_URL, the URL the deployment already gives Better Auth
// (docker-compose.yml, tests/e2e/global-setup.ts); the accept route also admits the exact
// origins of BETTER_AUTH_TRUSTED_ORIGINS (K159). Never from the request Host or a forwarded
// host header: a link built from a request header can be poisoned by whoever sends the request
// (threat T-10-20).
//
// Pure environment read. Relative imports only (none today) and no framework import: the worker
// may bundle it.

export type AppUrlErrorReason = "missing" | "invalid" | "scheme";

/** BETTER_AUTH_URL is missing, does not parse, or is not http or https. Never carries the value. */
export class AppUrlError extends Error {
  readonly reason: AppUrlErrorReason;

  constructor(reason: AppUrlErrorReason) {
    super(
      reason === "missing"
        ? "BETTER_AUTH_URL is not set"
        : reason === "invalid"
          ? "BETTER_AUTH_URL is not a valid URL"
          : "BETTER_AUTH_URL must use http or https",
    );
    this.name = "AppUrlError";
    this.reason = reason;
  }
}

type Env = Record<string, string | undefined>;

function parseAppUrl(env: Env): URL {
  const raw = env.BETTER_AUTH_URL?.trim() ?? "";
  if (raw === "") throw new AppUrlError("missing");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppUrlError("invalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new AppUrlError("scheme");
  return url;
}

/**
 * The origin plus path of BETTER_AUTH_URL with no trailing slash, for example
 * `https://help.example.com` or `https://example.com/aida`. Query and fragment are dropped.
 * Throws AppUrlError when the variable is missing, invalid or not http(s).
 */
export function getAppBaseUrl(env: Env = process.env): string {
  const url = parseAppUrl(env);
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${path}`;
}

/** The origin of BETTER_AUTH_URL (scheme, host and port), for Origin checks. */
export function getAppOrigin(env: Env = process.env): string {
  return parseAppUrl(env).origin;
}

/**
 * The origins a same-origin form post of this application may carry (K159): the origin of
 * BETTER_AUTH_URL first, then each entry of BETTER_AUTH_TRUSTED_ORIGINS (comma-separated, the
 * list Better Auth already trusts for its own CSRF checks) that is an exact http(s) origin,
 * reduced to its origin, each once. Wildcard patterns, other schemes and unparsable entries are
 * skipped: the caller compares the Origin header for exact equality only. Throws AppUrlError like
 * getAppOrigin when BETTER_AUTH_URL is missing or invalid.
 */
export function getTrustedAppOrigins(env: Env = process.env): string[] {
  const origins = [getAppOrigin(env)];
  for (const raw of (env.BETTER_AUTH_TRUSTED_ORIGINS ?? "").split(",")) {
    const entry = raw.trim();
    if (entry === "" || entry.includes("*")) continue;
    let url: URL;
    try {
      url = new URL(entry);
    } catch {
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    if (!origins.includes(url.origin)) origins.push(url.origin);
  }
  return origins;
}
