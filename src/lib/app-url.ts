// The application's own base URL and origin, from configuration only (Phase 10, D-06, V-15).
//
// Invitation links (and later digest links) and the expected Origin of the invitation accept
// route come from BETTER_AUTH_URL, the URL the deployment already gives Better Auth
// (docker-compose.yml, tests/e2e/global-setup.ts); the accept route also admits the exact
// origins of BETTER_AUTH_TRUSTED_ORIGINS (K159). Never from the request Host or a forwarded
// host header: a link built from a request header can be poisoned by whoever sends the request
// (threat T-10-20).
//
// BETTER_AUTH_URL must be the bare public origin (K165, review a-WR-2 and b-IN-4). Better Auth
// takes any path of that URL as its own base path, while AIDA mounts it at /api/auth and has no
// Next basePath: a sub-path such as /aida breaks sign-in, and /api/auth would put every invitation
// and digest link under Better Auth's catch-all. So a path, a query, a fragment or credentials are
// refused here (reason not_origin), and both the app (src/instrumentation.ts) and the worker
// (src/lib/worker/index.ts) refuse to start on such a value (assertAppUrlAtStart). Sub-path
// deployments are not supported.
//
// Pure environment read. Relative imports only (none today) and no framework import: the worker
// may bundle it.

export type AppUrlErrorReason = "missing" | "invalid" | "scheme" | "not_origin";

function messageFor(reason: AppUrlErrorReason): string {
  switch (reason) {
    case "missing":
      return "BETTER_AUTH_URL is not set";
    case "invalid":
      return "BETTER_AUTH_URL is not a valid URL";
    case "scheme":
      return "BETTER_AUTH_URL must use http or https";
    case "not_origin":
      return "BETTER_AUTH_URL must be the bare public origin (scheme, host and optional port, for example https://help.example.com) with no path, query, fragment or credentials; AIDA does not support a sub-path";
  }
}

/**
 * BETTER_AUTH_URL is missing, does not parse, is not http or https, or is not a bare origin.
 * Never carries the value.
 */
export class AppUrlError extends Error {
  readonly reason: AppUrlErrorReason;

  constructor(reason: AppUrlErrorReason) {
    super(messageFor(reason));
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
  // The URL parser gives a bare origin the path "/" whether or not a trailing slash was written; a
  // "?" or "#" with nothing after it still counts, so the raw text is checked too.
  const bare =
    url.pathname === "/" &&
    url.search === "" &&
    url.hash === "" &&
    url.username === "" &&
    url.password === "" &&
    !raw.includes("?") &&
    !raw.includes("#");
  if (!bare) throw new AppUrlError("not_origin");
  return url;
}

/**
 * The base of every link AIDA builds (invitation and digest links): the origin of BETTER_AUTH_URL,
 * for example `https://help.example.com`, never with a path (K165). Throws AppUrlError when the
 * variable is missing, invalid, not http(s) or not a bare origin.
 */
export function getAppBaseUrl(env: Env = process.env): string {
  return parseAppUrl(env).origin;
}

/**
 * The start-up check of BETTER_AUTH_URL (K165), run by the app (src/instrumentation.ts) and the
 * worker (src/lib/worker/index.ts) before either serves: a value that is set must be a bare http(s)
 * origin, or this throws AppUrlError and the caller logs its message and exits. An unset or blank
 * value passes here: invitations then answer INVITE_CONFIG and the digest pass refuses, as before.
 */
export function assertAppUrlAtStart(env: Env = process.env): void {
  if ((env.BETTER_AUTH_URL?.trim() ?? "") === "") return;
  parseAppUrl(env);
}

/** The origin of BETTER_AUTH_URL (scheme, host and port), for Origin checks; refused like getAppBaseUrl. */
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
