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
// Account creation (D-05, V-04; threat T-10-30): signUpAndAccept is the fourth in-process Better
// Auth sign-up caller (src/proxy.ts names all four; the HTTP sign-up route stays blocked
// there). It never opens sign-up: the invitation is validated first (a pending, unexpired link
// with no account for its address, R3-1), setup must be complete (the setupComplete setting
// /setup and bootstrapFromEnv write), and the email is always the invitation's own, never a
// caller value: there is no email parameter. It does not take the tenant seed lock
// (src/lib/tenant-seed-lock.ts): an organization already exists, so it cannot race the first
// tenant. If accept fails after the account exists (the link revoked or expired in between, C9),
// the account and its session stay; the defined retry is a new invitation to the same address,
// joined through signInAndAccept.
//
// Nothing here logs: the token is a bearer credential (threat T-10-21, C12).
//
// Relative imports only, no next/* import: the request headers are passed in, so an integration
// test calls these functions without a Next request scope.
import { isAPIError } from "better-auth/api";
import { auth } from "../auth";
import { getBrandingSettings } from "../branding/settings";
import { prisma } from "../db";
import { readFreshSession } from "../fresh-session";
import { scopedDb } from "../scoped-db";
import {
  type AcceptInvitationHooks,
  type AcceptInvitationResult,
  acceptInvitation,
  getInvitationView,
} from "./invitations";

/** The name limits of the create-account form (the route validates them). */
export const INVITEE_NAME_MAX_LENGTH = 100;
/** The password limits: the setup form's minimum, and Better Auth's default maximum. */
export const INVITEE_PASSWORD_MIN_LENGTH = 8;
export const INVITEE_PASSWORD_MAX_LENGTH = 128;

/** The SystemSetting key /setup writes once the first workspace exists. */
const SETUP_COMPLETE_KEY = "setupComplete";

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

/** A join that may have signed someone in: the Set-Cookie values the response must carry. */
export type JoinResult = OnboardingResult & { setCookies: string[] };

/** Test seams of the account flows. Production callers pass none. */
export interface JoinHooks extends AcceptInvitationHooks {
  /** Awaited after the account and its session exist and before accept (C9). */
  afterAccount?(): Promise<void> | void;
}

const noCookies = (result: OnboardingResult): JoinResult => ({ ...result, setCookies: [] });

/** The value or the rejection of a promise, so a Better Auth refusal is handled without a throw. */
async function settle<T>(
  promise: Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    return { ok: false, error };
  }
}

async function isSetupComplete(): Promise<boolean> {
  const row = await prisma.systemSetting.findUnique({
    where: { key: SETUP_COMPLETE_KEY },
    select: { value: true },
  });
  return row?.value === "true";
}

/** Accepts for a session that was just created, keeping its cookies on every outcome. */
async function acceptForNewSession(
  token: string,
  user: { id: string; email: string },
  sessionToken: string,
  setCookies: string[],
  hooks: JoinHooks | undefined,
): Promise<JoinResult> {
  const result = await acceptInvitation(
    { token, userId: user.id, userEmail: user.email, session: { token: sessionToken } },
    hooks,
  );
  return { ...(await toOnboardingResult(result)), setCookies };
}

export interface SignUpAndAcceptInput {
  token: string;
  /** Validated by the caller (1 to INVITEE_NAME_MAX_LENGTH characters, trimmed). */
  name: string;
  /** Validated by the caller (INVITEE_PASSWORD_MIN_LENGTH to INVITEE_PASSWORD_MAX_LENGTH). */
  password: string;
  /** The request's headers: Better Auth reads the client identity and user agent from them. */
  requestHeaders: Headers;
}

/**
 * "Create account and join": the account is created for exactly the invitation's address, then
 * the invitation is accepted on the new session. Invalid or already-used link, or an account that
 * already exists for the address → invalid, nothing created; setup not complete → server_error,
 * nothing created. See the header for the failed-accept case (C9).
 */
export async function signUpAndAccept(
  { token, name, password, requestHeaders }: SignUpAndAcceptInput,
  hooks?: JoinHooks,
): Promise<JoinResult> {
  const view = await getInvitationView(token);
  if (view.state !== "valid" || view.accountExists) return noCookies({ kind: "invalid" });
  if (!(await isSetupComplete())) return noCookies({ kind: "server_error" });

  // Better Auth's in-process sign-up, for the invitation's address only; the session cookies
  // come back in the returned headers.
  const outcome = await settle(
    auth.api.signUpEmail({
      body: { name, email: view.email, password },
      headers: requestHeaders,
      returnHeaders: true,
    }),
  );
  if (!outcome.ok) {
    // An account created for the address since the view (a race): the same generic refusal.
    const exists = isAPIError(outcome.error) && outcome.error.statusCode === 422;
    return noCookies({ kind: exists ? "invalid" : "server_error" });
  }
  const created = outcome.value;
  const setCookies = created.headers.getSetCookie();
  const sessionToken = created.response.token;
  if (!sessionToken) return { kind: "server_error", setCookies };

  await hooks?.afterAccount?.();
  return acceptForNewSession(token, created.response.user, sessionToken, setCookies, hooks);
}

export interface SignInAndAcceptInput {
  token: string;
  password: string;
  requestHeaders: Headers;
}

/**
 * "Sign in and join": signs in as the invitation's address with `password`, then accepts on that
 * new session. Invalid link → invalid; refused credentials → wrong_password, nothing accepted.
 */
export async function signInAndAccept(
  { token, password, requestHeaders }: SignInAndAcceptInput,
  hooks?: JoinHooks,
): Promise<JoinResult> {
  const view = await getInvitationView(token);
  if (view.state !== "valid") return noCookies({ kind: "invalid" });

  // Better Auth's in-process sign-in as the invitation's address.
  const outcome = await settle(
    auth.api.signInEmail({
      body: { email: view.email, password },
      headers: requestHeaders,
      returnHeaders: true,
    }),
  );
  if (!outcome.ok) {
    const refused = isAPIError(outcome.error) && outcome.error.statusCode === 401;
    return noCookies({ kind: refused ? "wrong_password" : "server_error" });
  }
  const signedIn = outcome.value;
  const setCookies = signedIn.headers.getSetCookie();
  const sessionToken = signedIn.response.token;
  if (!sessionToken) return { kind: "server_error", setCookies };

  await hooks?.afterAccount?.();
  return acceptForNewSession(token, signedIn.response.user, sessionToken, setCookies, hooks);
}
