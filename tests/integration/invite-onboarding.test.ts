// Phase 10, plan 10-08 (AIDA-42; D-03, D-05, V-04, V-13, V-23, V-24, R3-1, C9): the join flows of
// the invitation page, on a real Postgres through Testcontainers, with no mock of the database or
// of Better Auth.
//
// Users sign in through in-process auth.api.signInEmail with returnHeaders, and the request
// headers are built from the returned Set-Cookie values, exactly what a browser sends. The accept
// route's POST is called with constructed Requests carrying those cookies, an Origin header and a
// fresh client identity. The session cookie cache is off in AIDA (src/lib/auth.ts, R10-1); where a
// case proves that a cookie cached before accept does not hide the new organization, the cached
// copy is minted by a separate Better Auth instance with the cache on (cachingAuth), the way
// tests/integration/membership-gate.test.ts does. With the cache off that case is defence in depth.
//
// Built on better-auth 1.7.20 (D-01 as updated by V-01): a later Better Auth upgrade reruns this
// suite.
import { randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import { afterAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const previous = {
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    RATE_LIMIT_PEPPER: process.env.RATE_LIMIT_PEPPER,
  };
  const origin = "http://invite-onboarding.example.test:3100";
  // Read when src/lib/auth.ts loads (the secret) and on every call (the URL, the pepper).
  process.env.BETTER_AUTH_SECRET = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  process.env.BETTER_AUTH_URL = `${origin}/`;
  process.env.RATE_LIMIT_PEPPER ||= `test-pepper-${crypto.randomUUID()}`;
  return { previous, origin };
});

import { POST as acceptPost } from "@/app/(auth)/invite/[token]/accept/route";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readFreshSession } from "@/lib/fresh-session";
import {
  type CreateInvitationSuccess,
  createInvitation,
} from "@/lib/workspace-members/invitations";
import { uniqueClientIp } from "../support/client-ip";
import { seedOrgWithMembers } from "../support/inbox-fixtures";

afterAll(() => {
  for (const [key, value] of Object.entries(env.previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const ORIGIN = env.origin;

/** The Cookie header a browser sends after a response with these Set-Cookie values. */
function cookieFrom(setCookies: readonly string[]): string {
  return setCookies.map((c) => c.split(";")[0]).join("; ");
}

/** A user with a password, created in-process (not signed in). */
async function createAccount(email = `joiner-${randomUUID()}@example.test`) {
  const password = `pw-${randomUUID()}`;
  const signUp = await auth.api.signUpEmail({ body: { name: "Joiner", email, password } });
  return { userId: signUp.user.id, email, password };
}

interface SignedIn {
  userId: string;
  email: string;
  password: string;
  /** The Cookie header after the sign-in. */
  cookie: string;
  token: string;
}

/** A real in-process sign-in of an existing account. */
async function signIn(account: { userId: string; email: string; password: string }) {
  const { headers, response } = await auth.api.signInEmail({
    body: { email: account.email, password: account.password },
    returnHeaders: true,
  });
  const cookie = cookieFrom(headers.getSetCookie());
  expect(cookie).toContain("session_token=");
  return { ...account, cookie, token: response.token } satisfies SignedIn;
}

/** A member of a fresh organization (A), signed in: the session hook makes A active. */
async function signedInMemberOfOtherOrg(email?: string) {
  const { orgId } = await seedOrgWithMembers(prisma, []);
  const account = await createAccount(email);
  await prisma.member.create({
    data: {
      id: randomUUID(),
      organizationId: orgId,
      userId: account.userId,
      role: "member",
      createdAt: new Date(),
    },
  });
  const signedIn = await signIn(account);
  return { orgA: orgId, ...signedIn };
}

/**
 * AIDA's Better Auth options with the five-minute cookie cache on, as configured before R10-1. It
 * shares the database and the secret, so its session_data cookie is a valid cached copy of the
 * same session row: the cookie a browser may still hold from such a deployment.
 */
const cachingAuth = betterAuth({
  ...auth.options,
  session: { ...auth.options.session, cookieCache: { enabled: true, maxAge: 5 * 60 } },
});

/** The Cookie header plus a cached copy of the session, minted by cachingAuth now. */
async function withCachedCopy(cookie: string): Promise<string> {
  const { headers } = await cachingAuth.api.getSession({
    headers: new Headers({ cookie }),
    returnHeaders: true,
  });
  const data = headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .filter((c) => c.includes("session_data="));
  expect(data).toHaveLength(1);
  return `${cookie}; ${data[0]}`;
}

/** A read that trusts the cookie cache, for comparison only: no AIDA path reads this way. */
function cacheTrustingRead(cookie: string) {
  return cachingAuth.api.getSession({ headers: new Headers({ cookie }) });
}

/** An organization (B) with an owner, and a pending invitation of B for `email`; returns its token. */
async function invite(email: string, role: "member" | "admin" = "member") {
  const { orgId, users } = await seedOrgWithMembers(prisma, ["owner"]);
  const result = await createInvitation({ orgId, actorUserId: users[0].id, email, role });
  if (!result.ok) throw new Error(`createInvitation refused: ${result.error}`);
  const success: CreateInvitationSuccess = result;
  if (success.delivery === "sent") throw new Error("the invitation was emailed; no link returned");
  const match = /\/invite\/([A-Za-z0-9_-]+)$/.exec(success.link);
  if (!match?.[1]) throw new Error("no token in link");
  return { orgId, ownerId: users[0].id, invitationId: success.invitationId, token: match[1] };
}

interface PostOptions {
  cookie?: string;
  /** The Origin header; null sends none. Default: the configured origin. */
  origin?: string | null;
  /** The client address; default a fresh one per request. */
  ip?: string;
}

/** A browser form post (url-encoded, as an HTML form sends it) to the accept route. */
function acceptRequest(token: string, fields: Record<string, string>, opts: PostOptions = {}) {
  const headers = new Headers({ "x-forwarded-for": opts.ip ?? uniqueClientIp() });
  const origin = opts.origin === undefined ? ORIGIN : opts.origin;
  if (origin !== null) headers.set("origin", origin);
  if (opts.cookie) headers.set("cookie", opts.cookie);
  return new Request(`${ORIGIN}/invite/${token}/accept`, {
    method: "POST",
    headers,
    body: new URLSearchParams(fields),
  });
}

function post(token: string, fields: Record<string, string>, opts?: PostOptions) {
  return acceptPost(acceptRequest(token, fields, opts), {
    params: Promise.resolve({ token }),
  });
}

function memberRows(orgId: string, userId: string) {
  return prisma.member.findMany({ where: { organizationId: orgId, userId }, select: { id: true } });
}

describe("tracer: a signed-in invited user posts Accept and the next request is in the invited workspace", () => {
  it("answers 303 to /tickets?joined=1, and the fresh read with the pre-accept cookies (cached copy included) names B", async () => {
    const user = await signedInMemberOfOtherOrg();
    // The cookies a browser could hold before accept: the session token and a cached copy of the
    // session naming A (minted with the cache on; AIDA itself mints none, R10-1).
    const cookie = await withCachedCopy(user.cookie);
    expect((await readFreshSession(new Headers({ cookie })))?.session.activeOrganizationId).toBe(
      user.orgA,
    );
    expect((await cacheTrustingRead(cookie))?.session.activeOrganizationId).toBe(user.orgA);

    const { orgId: orgB, token } = await invite(user.email);
    const response = await post(token, { intent: "accept" }, { cookie });

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/tickets?joined=1`);
    // The next request, with exactly the cookies held before accept, is in B.
    const after = await readFreshSession(new Headers({ cookie }));
    expect(after?.user.id).toBe(user.userId);
    expect(after?.session.activeOrganizationId).toBe(orgB);
    expect(await memberRows(orgB, user.userId)).toHaveLength(1);
    // Recorded for the SUMMARY: a cache-trusting read would still name A from the cached copy,
    // which is why AIDA never reads that way (defence in depth with the cache off).
    expect((await cacheTrustingRead(cookie))?.session.activeOrganizationId).toBe(user.orgA);
  });
});
