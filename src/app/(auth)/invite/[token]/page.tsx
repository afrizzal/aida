import { headers } from "next/headers";
import { consumeRateLimit } from "@/lib/rate-limit/check-rate-limit";
import {
  CLIENT_IP_HEADER,
  rateLimitKeyForIp,
  SHARED_CLIENT_BUCKET,
} from "@/lib/rate-limit/client-ip";
import { PUBLIC_RATE_LIMITS } from "@/lib/rate-limit/public-limits";
import { getCurrentSession } from "@/lib/session";
import { getInvitationView, normaliseInviteEmail } from "@/lib/workspace-members/invitations";
import { InviteCard, type InviteCardError, type InviteCardState } from "./invite-card";

// The invitation page (Phase 10, plan 10-08, AIDA-42; D-03, D-05, V-04, V-23; UI-SPEC Surface 2).
// It lives in the (auth) group, so the auth layout draws the background and this renders only the
// card. The server decides the one state; the token is never rendered as text (it is only in the
// URL and in the form's action). The proxy lists /invite as public and sends Referrer-Policy
// no-referrer for it (plan 10-15). Every join goes through the POST route beside this page.
//
// The view is rate limited before the token lookup (V-04), on the client identity the proxy
// writes. A throttled view looks nothing up and shows the server-error copy (amendment A6).
// The session is read only through the fresh getCurrentSession (V-23). Nothing here logs.

export const dynamic = "force-dynamic";

const ROLE_LABELS = { owner: "Owner", admin: "Admin", member: "Member" } as const;

const CARD_ERRORS: ReadonlySet<string> = new Set(["server", "field", "password"]);

function cardError(value: string | string[] | undefined): InviteCardError | null {
  return typeof value === "string" && CARD_ERRORS.has(value) ? (value as InviteCardError) : null;
}

interface InvitePageProps {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string | string[] }>;
}

export default async function InvitePage({ params, searchParams }: InvitePageProps) {
  const { token } = await params;
  const { error } = await searchParams;
  const actionPath = `/invite/${encodeURIComponent(token)}/accept`;

  // The limit first: no lookup of any kind before it.
  const requestHeaders = await headers();
  const identity = rateLimitKeyForIp(requestHeaders.get(CLIENT_IP_HEADER) ?? SHARED_CLIENT_BUCKET);
  const { scope, max, windowMs } = PUBLIC_RATE_LIMITS.inviteView;
  const limit = await consumeRateLimit(scope, identity, { max, windowMs });
  if (!limit.allowed) return <InviteCard state={{ kind: "throttled" }} />;

  const view = await getInvitationView(token);
  const session = await getCurrentSession();

  let state: InviteCardState;
  if (view.state !== "valid") {
    state = { kind: "invalid" };
  } else if (session) {
    const currentEmail = session.user.email;
    state =
      normaliseInviteEmail(currentEmail) === normaliseInviteEmail(view.email)
        ? {
            kind: "accept",
            workspaceName: view.workspaceName,
            roleLabel: ROLE_LABELS[view.role],
            currentEmail,
            actionPath,
            error: cardError(error),
          }
        : // The invited address is not passed: a different account never sees it (D-05).
          { kind: "wrong_account", currentEmail };
  } else {
    state = {
      kind: view.accountExists ? "sign_in" : "sign_up",
      workspaceName: view.workspaceName,
      roleLabel: ROLE_LABELS[view.role],
      invitedEmail: view.email,
      actionPath,
      error: cardError(error),
    };
  }
  return <InviteCard state={state} />;
}
