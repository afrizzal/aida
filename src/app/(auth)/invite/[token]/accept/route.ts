// POST /invite/<token>/accept (Phase 10, plan 10-08, AIDA-42; V-24, V-23, V-04, D-03, D-05).
//
// The one join endpoint of the invitation page: a plain HTML form posts here and gets a 303, so
// the page needs no client fetch and no server action (CSP, V-24). The order is fixed:
//   (a) Origin: it acts on a signed-in session, so a request whose Origin header is missing or is
//       not the origin of BETTER_AUTH_URL is refused with 403 before anything else is read (a
//       cross-site form post cannot accept on someone's behalf; threat T-10-33);
//   (b) the inviteAccept rate limit on the proxy-written client identity, before the token lookup
//       and the body (threat T-10-33b);
//   (c) the body, bounded in bytes and parts;
//   (d) the intent and its fields, validated here;
//   (e) one call into src/lib/workspace-members/invite-onboarding.ts with the request headers;
//   (f) a 303 to the next page: /tickets?joined=1 on success, else back to the same link, whose
//       page renders the matching state.
//
// Nothing here logs: the token is a bearer credential in the path (C12).
import { NextResponse } from "next/server";
import { getAppOrigin } from "@/lib/app-url";
import { readBoundedFormData } from "@/lib/http/read-bounded-form-data";
import { consumeRateLimit } from "@/lib/rate-limit/check-rate-limit";
import { getRateLimitIdentity } from "@/lib/rate-limit/client-ip";
import { PUBLIC_RATE_LIMITS, rateLimitedResponse } from "@/lib/rate-limit/public-limits";
import { acceptAsSignedIn, type OnboardingResult } from "@/lib/workspace-members/invite-onboarding";

export const runtime = "nodejs";

/** The form carries at most intent, name and password: a few hundred bytes. */
const MAX_FORM_BYTES = 4 * 1024;
const MAX_FORM_PARTS = 4;

/** The configured origin, or null when BETTER_AUTH_URL is missing or invalid (refuse all). */
function expectedOrigin(): string | null {
  try {
    return getAppOrigin();
  } catch {
    return null;
  }
}

function seeOther(origin: string, path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: `${origin}${path}` } });
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
  const origin = expectedOrigin();
  const sent = request.headers.get("origin");
  if (origin === null || sent === null || sent !== origin) {
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

  // (d) The intent.
  const intent = form.get("intent");
  if (intent !== "accept") {
    return NextResponse.json({ error: "invalid_intent" }, { status: 400 });
  }

  // (e) and (f).
  const result = await acceptAsSignedIn({ token, requestHeaders: request.headers });
  return seeOther(origin, targetFor(result, invitePath));
}
