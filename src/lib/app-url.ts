// The application's own base URL and origin, from configuration only (Phase 10, D-06, V-15).
//
// Invitation links (and later digest links) and the expected Origin of the invitation accept
// route come from BETTER_AUTH_URL, the URL the deployment already gives Better Auth
// (docker-compose.yml, tests/e2e/global-setup.ts). Never from the request Host or a forwarded
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
