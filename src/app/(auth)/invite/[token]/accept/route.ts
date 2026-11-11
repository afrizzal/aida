// POST /invite/<token>/accept (Phase 10, plan 10-08, AIDA-42; V-24, V-23, V-04, D-03, D-05).
//
// The one join endpoint of the invitation page: a plain HTML form posts here and gets a 303, so
// the page needs no client fetch and no server action (CSP, V-24). The order is fixed:
//   (a) Origin: it acts on a signed-in session, so a request whose Origin header is missing or is
//       not exactly one of the application's origins (getTrustedAppOrigins: the origin of
//       BETTER_AUTH_URL plus BETTER_AUTH_TRUSTED_ORIGINS) is refused with 403 before anything else
//       is read (a cross-site form post cannot accept on someone's behalf; threat T-10-33). The
//       page sends Referrer-Policy same-origin (K159), so the card's own post carries its real
//       Origin; "null" and fetch metadata are never admitted (isSameOriginPost);
//   (b) the inviteAccept rate limit on the proxy-written client identity, before the token lookup
//       and the body (threat T-10-33b);
//   (c) the body, bounded in bytes and parts;
//   (d) the intent and its fields, validated here;
//   (e) one call into src/lib/workspace-members/invite-onboarding.ts with the request headers;
//   (f) a 303 with a relative Location (K160) to the next page: /tickets?joined=1 on success,
//       else back to the same link, whose page renders the matching state.
//
// Intents: `accept` (signed in), `sign-up` (name and password; the email is always the
// invitation's own, so a posted email field is never read) and `sign-in` (password). A sign-up or
// sign-in that created a session appends its Set-Cookie values to the 303, also when the accept
// after it failed (C9: the account stays signed in, with no membership). In the Next runtime
// Better Auth's nextCookies plugin also writes them through cookies(); Next merges those into this
// response by cookie name, and a cookie this response sets wins, so each one is sent once.
//
// Nothing here logs: the token is a bearer credential in the path (C12).
import { NextResponse } from "next/server";
import { getTrustedAppOrigins } from "@/lib/app-url";
import { readBoundedFormData } from "@/lib/http/read-bounded-form-data";
import { consumeRateLimit } from "@/lib/rate-limit/check-rate-limit";
import { getRateLimitIdentity } from "@/lib/rate-limit/client-ip";
import { PUBLIC_RATE_LIMITS, rateLimitedResponse } from "@/lib/rate-limit/public-limits";
import {
  acceptAsSignedIn,
  INVITEE_NAME_MAX_LENGTH,
  INVITEE_PASSWORD_MAX_LENGTH,
  INVITEE_PASSWORD_MIN_LENGTH,
  type JoinResult,
  type OnboardingResult,
  signInAndAccept,
  signUpAndAccept,
} from "@/lib/workspace-members/invite-onboarding";

export const runtime = "nodejs";

/** The form carries at most intent, name, password and the read-only email: under 1 KiB. */
const MAX_FORM_BYTES = 4 * 1024;
const MAX_FORM_PARTS = 4;

/**
 * A 303 to `path`, a root-relative target (K160, b-WR-5). The browser resolves it against the URL
 * it actually posted to, so the redirect keeps the scheme and host the invitee is on (behind
 * Caddy, https://localhost while BETTER_AUTH_URL may say http://localhost) and depends on no
 * request header. Every caller passes a path that starts with exactly one "/".
 */
function seeOther(path: string, setCookies: readonly string[] = []): NextResponse {
  const response = new NextResponse(null, { status: 303, headers: { Location: path } });
  for (const cookie of setCookies) response.headers.append("set-cookie", cookie);
  return response;
}

/**
 * Whether the request is a same-origin post from this application (V-24, K159): its Origin header
 * is exactly one of the trusted origins (string equality). Everything else is refused: a missing
 * Origin, a foreign one, and the literal "null" whatever fetch metadata comes with it. The
 * invitation page sends Referrer-Policy same-origin, under which a browser sends its own form
 * post with the page's real Origin (Fetch Standard); "null" there would mean an opaque origin
 * such as a sandboxed frame. A BETTER_AUTH_URL that is missing or invalid refuses everything.
 */
function isSameOriginPost(headers: Headers): boolean {
  const sent = headers.get("origin");
  if (sent === null) return false;
  let trusted: string[];
  try {
    trusted = getTrustedAppOrigins();
  } catch {
    return false;
  }
  return trusted.includes(sent);
}

/** A string field of the form, or null when absent or a file. */
function field(form: FormData, name: string): string | null {
  const value = form.get(name);
  return typeof value === "string" ? value : null;
}

/** The sign-up name, trimmed, when it is 1 to 100 characters; else null. */
function validName(value: string | null): string | null {
  const name = value?.trim() ?? "";
  return name.length >= 1 && name.length <= INVITEE_NAME_MAX_LENGTH ? name : null;
}

function validPassword(value: string | null, minLength: number): string | null {
  if (value === null) return null;
  return value.length >= minLength && value.length <= INVITEE_PASSWORD_MAX_LENGTH ? value : null;
}

/** The 303 target of a join result. */
function targetFor(result: OnboardingResult, invitePath: string): string {
  switch (result.kind) {
    case "ok":
      return "/tickets?joined=1";
    case "signed_out":
    case "invalid":
      return invitePath;
    case "wrong_password":
      return `${invitePath}?error=password`;
    default:
      return `${invitePath}?error=server`;
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  // (a) Origin first, before any read.
  if (!isSameOriginPost(request.headers)) {
    return NextResponse.json({ error: "forbidden_origin" }, { status: 403 });
  }

  // (b) The limit before the token lookup and the body parse.
  const { scope, max, windowMs } = PUBLIC_RATE_LIMITS.inviteAccept;
  const limit = await consumeRateLimit(scope, getRateLimitIdentity(request), { max, windowMs });
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);

  // (c) The bounded body.
  const body = await readBoundedFormData(request, MAX_FORM_BYTES, { maxParts: MAX_FORM_PARTS });
  if (!body.ok) {
    if (body.reason === "invalid") {
      return NextResponse.json({ error: "invalid_form_data" }, { status: 400 });
    }
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }
  const form = body.form;

  const { token } = await params;
  const invitePath = `/invite/${encodeURIComponent(token)}`;

  // (d) The intent and its fields; (e) the one onboarding call; (f) the 303.
  const intent = field(form, "intent");
  const requestHeaders = request.headers;
  if (intent === "accept") {
    const result = await acceptAsSignedIn({ token, requestHeaders });
    return seeOther(targetFor(result, invitePath));
  }
  if (intent === "sign-up" || intent === "sign-in") {
    const name = intent === "sign-up" ? validName(field(form, "name")) : "";
    const password = validPassword(
      field(form, "password"),
      intent === "sign-up" ? INVITEE_PASSWORD_MIN_LENGTH : 1,
    );
    if (name === null || password === null) {
      return seeOther(`${invitePath}?error=field`);
    }
    const result: JoinResult =
      intent === "sign-up"
        ? await signUpAndAccept({ token, name, password, requestHeaders })
        : await signInAndAccept({ token, password, requestHeaders });
    return seeOther(targetFor(result, invitePath), result.setCookies);
  }
  return NextResponse.json({ error: "invalid_intent" }, { status: 400 });
}
