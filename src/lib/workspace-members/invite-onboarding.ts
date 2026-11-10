// The join flows of the invitation page (Phase 10, plan 10-08, AIDA-42; D-03, D-05, V-04, V-23,
// V-24). The accept route (src/app/(auth)/invite/[token]/accept/route.ts) is a thin layer over
// this module: it checks Origin, rate limits, reads the bounded form, validates it, and calls one
// function here with the request headers.
//
// Session reads (V-23): only readFreshSession (../fresh-session), which reads the session row and
// never trusts a cookie cache. The activation of the invited organization is not done here:
// acceptInvitation (./invitations) sets activeOrganizationId on exactly the requesting session row
// inside its organization-locked transaction, so the next request is in the invited workspace
// whatever cookie the browser still holds. Better Auth's setActiveOrganization is never called.
//
// Nothing here logs: the token is a bearer credential (threat T-10-21, C12).
//
// Relative imports only, no next/* import: the request headers are passed in, so an integration
// test calls these functions without a Next request scope.
import { getBrandingSettings } from "../branding/settings";
import { prisma } from "../db";
import { readFreshSession } from "../fresh-session";
import { scopedDb } from "../scoped-db";
import {
  type AcceptInvitationHooks,
  type AcceptInvitationResult,
  acceptInvitation,
} from "./invitations";

/**
 * What a join attempt ended in. The route maps each kind to one 303 target:
 * - ok: the member row exists and the requesting session is in orgId;
 * - signed_out: no fresh session, or it was signed out or deleted before accept committed
 *   (SESSION_GONE); nothing was accepted and the invitation is still pending;
 * - invalid: the one generic refusal (D-03), whatever the reason;
 * - wrong_password: the sign-in path's credentials were refused; nothing was accepted;
 * - server_error: anything else.
 */
export type OnboardingResult =
  | { kind: "ok"; orgId: string; workspaceName: string }
  | { kind: "signed_out" }
  | { kind: "invalid" }
  | { kind: "wrong_password" }
  | { kind: "server_error" };

/** The display name of orgId: the branding name, else the organization name. */
async function workspaceNameOf(orgId: string): Promise<string> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { name: true },
  });
  const branding = await getBrandingSettings(scopedDb(orgId), org?.name ?? "");
  return branding.workspaceName;
}

/** The one mapping of acceptInvitation's result, shared by every join flow. */
async function toOnboardingResult(result: AcceptInvitationResult): Promise<OnboardingResult> {
  if (result.ok) {
    return { kind: "ok", orgId: result.orgId, workspaceName: await workspaceNameOf(result.orgId) };
  }
  if (result.error === "SESSION_GONE") return { kind: "signed_out" };
  if (result.error === "INVALID_INVITATION") return { kind: "invalid" };
  return { kind: "server_error" };
}

export interface AcceptAsSignedInInput {
  /** The raw link token. */
  token: string;
  /** The request's headers (its cookies carry the session). */
  requestHeaders: Headers;
}

/**
 * "Accept invitation" for a signed-in user: one fresh session read, then acceptInvitation with
 * that session's id, user and email. No session → signed_out. The email check (D-03) and the
 * activation of the requesting session (V-23) happen inside acceptInvitation's transaction.
 */
export async function acceptAsSignedIn(
  { token, requestHeaders }: AcceptAsSignedInInput,
  hooks?: AcceptInvitationHooks,
): Promise<OnboardingResult> {
  const session = await readFreshSession(requestHeaders);
  if (!session) return { kind: "signed_out" };
  const result = await acceptInvitation(
    {
      token,
      userId: session.user.id,
      userEmail: session.user.email,
      session: { id: session.session.id },
    },
    hooks,
  );
  return toOnboardingResult(result);
}
