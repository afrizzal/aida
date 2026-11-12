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
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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
import { rateLimitLockKey } from "@/lib/rate-limit/check-rate-limit";
import { rateLimitKeyForIp } from "@/lib/rate-limit/client-ip";
import { PUBLIC_RATE_LIMITS } from "@/lib/rate-limit/public-limits";
import {
  type CreateInvitationSuccess,
  createInvitation,
  revokeInvitation,
} from "@/lib/workspace-members/invitations";
import {
  acceptAsSignedIn,
  signInAndAccept,
  signUpAndAccept,
} from "@/lib/workspace-members/invite-onboarding";
import { inviteTokenRateLimitIdentity } from "@/lib/workspace-members/invite-token";
import { uniqueClientIp } from "../support/client-ip";
import { seedOrgWithMembers } from "../support/inbox-fixtures";

const SETUP_COMPLETE = "setupComplete";
/** The setupComplete row as this file found it, restored afterwards (other files share the DB). */
let setupBefore: string | null = null;

beforeAll(async () => {
  const row = await prisma.systemSetting.findUnique({ where: { key: SETUP_COMPLETE } });
  setupBefore = row?.value ?? null;
  await markSetupComplete();
});

afterAll(async () => {
  if (setupBefore === null) {
    await prisma.systemSetting.deleteMany({ where: { key: SETUP_COMPLETE } });
  } else {
    await prisma.systemSetting.upsert({
      where: { key: SETUP_COMPLETE },
      update: { value: setupBefore },
      create: { key: SETUP_COMPLETE, value: setupBefore },
    });
  }
  for (const [key, value] of Object.entries(env.previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

/** What /setup writes once the first workspace exists (src/app/(auth)/setup/actions.ts). */
async function markSetupComplete() {
  await prisma.systemSetting.upsert({
    where: { key: SETUP_COMPLETE },
    update: { value: "true" },
    create: { key: SETUP_COMPLETE, value: "true" },
  });
}

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
  /** Sec-Fetch-Site and Sec-Fetch-Mode, as a browser sends them; default none. */
  fetchMetadata?: { site: string; mode: string };
}

/** A browser form post (url-encoded, as an HTML form sends it) to the accept route. */
function acceptRequest(token: string, fields: Record<string, string>, opts: PostOptions = {}) {
  const headers = new Headers({ "x-forwarded-for": opts.ip ?? uniqueClientIp() });
  const origin = opts.origin === undefined ? ORIGIN : opts.origin;
  if (origin !== null) headers.set("origin", origin);
  if (opts.cookie) headers.set("cookie", opts.cookie);
  if (opts.fetchMetadata) {
    headers.set("sec-fetch-site", opts.fetchMetadata.site);
    headers.set("sec-fetch-mode", opts.fetchMetadata.mode);
  }
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
    expect(response.headers.get("location")).toBe(`/tickets?joined=1`);
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

// ---------------------------------------------------------------------------------------------
// Task 2: create account and sign in, fixed to the invited address (D-05, V-04, V-13, R3-1, C9)
// ---------------------------------------------------------------------------------------------

const NEW_PASSWORD = "correct horse battery";

/** The users whose email is `email` (any case). */
function usersWithEmail(email: string) {
  return prisma.user.findMany({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, email: true, name: true },
  });
}

function freshEmail() {
  return `invitee-${randomUUID()}@example.test`;
}

function invitationStatus(invitationId: string) {
  return prisma.invitation
    .findUniqueOrThrow({ where: { id: invitationId }, select: { status: true } })
    .then((r) => r.status);
}

describe("signUpAndAccept: the account is created only for the invited address", () => {
  it("creates the user with exactly the invited address, the member row with the invited role, and a session active in the organization", async () => {
    const email = freshEmail();
    const { orgId, token } = await invite(email, "admin");

    const result = await signUpAndAccept({
      token,
      name: "New Invitee",
      password: NEW_PASSWORD,
      requestHeaders: new Headers({ "x-forwarded-for": uniqueClientIp() }),
      // Not a parameter: a caller that smuggles an address in changes nothing.
      ...({ email: "attacker@example.test" } as object),
    });

    expect(result.kind).toBe("ok");
    const users = await usersWithEmail(email);
    expect(users).toHaveLength(1);
    expect(users[0].email).toBe(email);
    expect(await usersWithEmail("attacker@example.test")).toEqual([]);
    const rows = await prisma.member.findMany({
      where: { organizationId: orgId, userId: users[0].id },
      select: { role: true },
    });
    expect(rows.map((r) => r.role)).toEqual(["admin"]);
    expect(result.setCookies.join("\n")).toContain("session_token=");
    const session = await readFreshSession(new Headers({ cookie: cookieFrom(result.setCookies) }));
    expect(session?.user.id).toBe(users[0].id);
    expect(session?.session.activeOrganizationId).toBe(orgId);
  });

  it("refuses as invalid when an account with that address already exists, and creates nothing", async () => {
    const existing = await createAccount(freshEmail());
    const { orgId, invitationId, token } = await invite(existing.email);

    const result = await signUpAndAccept({
      token,
      name: "Second Account",
      password: NEW_PASSWORD,
      requestHeaders: new Headers(),
    });

    expect(result).toEqual({ kind: "invalid", setCookies: [] });
    expect(await usersWithEmail(existing.email)).toHaveLength(1);
    expect(await memberRows(orgId, existing.userId)).toEqual([]);
    expect(await invitationStatus(invitationId)).toBe("pending");
  });

  it("R3-1: a link revoked before the form is submitted creates no account", async () => {
    const email = freshEmail();
    const { orgId, ownerId, invitationId, token } = await invite(email);
    expect(await revokeInvitation({ orgId, actorUserId: ownerId, invitationId })).toEqual({
      ok: true,
    });

    const result = await signUpAndAccept({
      token,
      name: "Too Late",
      password: NEW_PASSWORD,
      requestHeaders: new Headers(),
    });

    expect(result).toEqual({ kind: "invalid", setCookies: [] });
    expect(await usersWithEmail(email)).toEqual([]);
  });

  it("R3-1: a link expired before the form is submitted creates no account", async () => {
    const email = freshEmail();
    const { invitationId, token } = await invite(email);
    await prisma.invitation.update({
      where: { id: invitationId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const result = await signUpAndAccept({
      token,
      name: "Too Late",
      password: NEW_PASSWORD,
      requestHeaders: new Headers(),
    });

    expect(result).toEqual({ kind: "invalid", setCookies: [] });
    expect(await usersWithEmail(email)).toEqual([]);
  });

  it("refuses with server_error and creates no user while setupComplete is absent", async () => {
    const email = freshEmail();
    const { invitationId, token } = await invite(email);
    await prisma.systemSetting.deleteMany({ where: { key: SETUP_COMPLETE } });
    try {
      const result = await signUpAndAccept({
        token,
        name: "Before Setup",
        password: NEW_PASSWORD,
        requestHeaders: new Headers(),
      });
      expect(result).toEqual({ kind: "server_error", setCookies: [] });
      expect(await usersWithEmail(email)).toEqual([]);
      expect(await invitationStatus(invitationId)).toBe("pending");
    } finally {
      await markSetupComplete();
    }
  });
});

describe("C9: account created, accept failed, and the defined retry", () => {
  for (const fault of ["revoked", "expired"] as const) {
    it(`the invitation ${fault} between sign-up and accept leaves the account signed in with no membership; a new invitation joins through sign-in`, async () => {
      const email = freshEmail();
      const first = await invite(email);

      const failed = await signUpAndAccept(
        {
          token: first.token,
          name: "Unlucky Invitee",
          password: NEW_PASSWORD,
          requestHeaders: new Headers(),
        },
        {
          afterAccount: async () => {
            if (fault === "revoked") {
              const revoked = await revokeInvitation({
                orgId: first.orgId,
                actorUserId: first.ownerId,
                invitationId: first.invitationId,
              });
              expect(revoked).toEqual({ ok: true });
            } else {
              await prisma.invitation.update({
                where: { id: first.invitationId },
                data: { expiresAt: new Date(Date.now() - 1000) },
              });
            }
          },
        },
      );

      expect(failed.kind).toBe("invalid");
      const users = await usersWithEmail(email);
      expect(users).toHaveLength(1);
      const userId = users[0].id;
      expect(await memberRows(first.orgId, userId)).toEqual([]);
      // Signed in (the route hands these cookies to the browser), with no membership anywhere.
      const signedIn = await readFreshSession(
        new Headers({ cookie: cookieFrom(failed.setCookies) }),
      );
      expect(signedIn?.user.id).toBe(userId);
      expect(signedIn?.session.activeOrganizationId).toBeNull();
      expect(await prisma.member.count({ where: { userId } })).toBe(0);

      // The retry: a new invitation to the same address, joined through the sign-in path.
      const second = await createInvitation({
        orgId: first.orgId,
        actorUserId: first.ownerId,
        email,
        role: "member",
      });
      if (!second.ok || second.delivery === "sent") throw new Error("no copyable invitation");
      const token = second.link.slice(second.link.lastIndexOf("/") + 1);
      const retried = await signInAndAccept({
        token,
        password: NEW_PASSWORD,
        requestHeaders: new Headers(),
      });

      expect(retried.kind).toBe("ok");
      expect(await memberRows(first.orgId, userId)).toHaveLength(1);
      const session = await readFreshSession(
        new Headers({ cookie: cookieFrom(retried.setCookies) }),
      );
      expect(session?.user.id).toBe(userId);
      expect(session?.session.activeOrganizationId).toBe(first.orgId);
    });
  }
});

describe("signInAndAccept", () => {
  it("joins with the right password and activates the new session", async () => {
    const account = await createAccount(freshEmail());
    const { orgId, invitationId, token } = await invite(account.email);

    const result = await signInAndAccept({
      token,
      password: account.password,
      requestHeaders: new Headers(),
    });

    expect(result.kind).toBe("ok");
    expect(await memberRows(orgId, account.userId)).toHaveLength(1);
    expect(await invitationStatus(invitationId)).toBe("accepted");
    const session = await readFreshSession(new Headers({ cookie: cookieFrom(result.setCookies) }));
    expect(session?.session.activeOrganizationId).toBe(orgId);
  });

  it("refuses a wrong password as wrong_password and accepts nothing", async () => {
    const account = await createAccount(freshEmail());
    const { orgId, invitationId, token } = await invite(account.email);

    const result = await signInAndAccept({
      token,
      password: "not the password",
      requestHeaders: new Headers(),
    });

    expect(result).toEqual({ kind: "wrong_password", setCookies: [] });
    expect(await memberRows(orgId, account.userId)).toEqual([]);
    expect(await invitationStatus(invitationId)).toBe("pending");
  });
});

describe("V-23: a session revoked before accept", () => {
  it("a session row deleted after the view gives signed_out, accepts nothing, and sign-in then joins", async () => {
    const user = await signedInMemberOfOtherOrg();
    const { orgId: orgB, invitationId, token } = await invite(user.email);
    // The session is valid first, so the result below cannot come from a bad cookie.
    const before = await readFreshSession(new Headers({ cookie: user.cookie }));
    expect(before?.user.id).toBe(user.userId);

    await prisma.session.delete({ where: { token: user.token } });

    const result = await acceptAsSignedIn({
      token,
      requestHeaders: new Headers({ cookie: user.cookie }),
    });
    expect(result).toEqual({ kind: "signed_out" });
    expect(await memberRows(orgB, user.userId)).toEqual([]);
    expect(await invitationStatus(invitationId)).toBe("pending");

    const joined = await signInAndAccept({
      token,
      password: user.password,
      requestHeaders: new Headers(),
    });
    expect(joined.kind).toBe("ok");
    expect(await memberRows(orgB, user.userId)).toHaveLength(1);
  });

  it("SESSION_GONE inside accept (the row deleted after the fresh read) gives signed_out and rolls the accept back", async () => {
    const user = await signedInMemberOfOtherOrg();
    const { orgId: orgB, invitationId, token } = await invite(user.email);
    expect((await readFreshSession(new Headers({ cookie: user.cookie })))?.user.id).toBe(
      user.userId,
    );

    const result = await acceptAsSignedIn(
      { token, requestHeaders: new Headers({ cookie: user.cookie }) },
      {
        // After the fresh read and before the locked transaction: the session ends.
        beforeLock: async () => {
          await prisma.session.delete({ where: { token: user.token } });
        },
      },
    );

    expect(result).toEqual({ kind: "signed_out" });
    expect(await memberRows(orgB, user.userId)).toEqual([]);
    expect(await invitationStatus(invitationId)).toBe("pending");
  });
});

describe("the accept route (V-24): Origin, rate limit, validation, 303", () => {
  /** The limiter rows of the inviteAccept scope for this client address. */
  function limiterRows(ip: string) {
    const { scope } = PUBLIC_RATE_LIMITS.inviteAccept;
    const ipHash = rateLimitLockKey(scope, rateLimitKeyForIp(ip)).slice(scope.length + 1);
    return prisma.rateLimitHit.count({ where: { scope, ipHash } });
  }

  /** The limiter rows of the inviteAcceptToken scope for this invitation token. */
  function tokenLimiterRows(token: string) {
    const { scope } = PUBLIC_RATE_LIMITS.inviteAcceptToken;
    const ipHash = rateLimitLockKey(scope, inviteTokenRateLimitIdentity(token)).slice(
      scope.length + 1,
    );
    return prisma.rateLimitHit.count({ where: { scope, ipHash } });
  }

  /**
   * K161 (b-WR-3, a-WR-3): a refusal of the form post is a 303 back to the invitation page with a
   * readable state, never a JSON body the browser would show as text. It sets no cookie.
   */
  async function expectRefusal(response: Response, token: string, state: string) {
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `/invite/${encodeURIComponent(token)}?error=${state}`,
    );
    expect(response.headers.get("content-type") ?? "").not.toContain("json");
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await response.text()).toBe("");
  }

  it("refuses a request with no Origin before any read (303 ?error=origin): the invitation is unchanged and no limiter row is written", async () => {
    const user = await signedInMemberOfOtherOrg();
    const { orgId: orgB, invitationId, token } = await invite(user.email);
    const before = await prisma.invitation.findUniqueOrThrow({ where: { id: invitationId } });
    const ip = uniqueClientIp();

    const response = await post(
      token,
      { intent: "accept" },
      { cookie: user.cookie, origin: null, ip },
    );

    await expectRefusal(response, token, "origin");
    expect(await prisma.invitation.findUniqueOrThrow({ where: { id: invitationId } })).toEqual(
      before,
    );
    expect(await memberRows(orgB, user.userId)).toEqual([]);
    expect(await limiterRows(ip)).toBe(0);
  });

  it("refuses a foreign Origin (303 ?error=origin) and accepts nothing", async () => {
    const user = await signedInMemberOfOtherOrg();
    const { orgId: orgB, invitationId, token } = await invite(user.email);
    const ip = uniqueClientIp();

    for (const origin of ["https://evil.example.test", `${ORIGIN}.evil.example.test`, "null"]) {
      const response = await post(token, { intent: "accept" }, { cookie: user.cookie, origin, ip });
      await expectRefusal(response, token, "origin");
    }
    expect(await invitationStatus(invitationId)).toBe("pending");
    expect(await memberRows(orgB, user.userId)).toEqual([]);
    expect(await limiterRows(ip)).toBe(0);
  });

  // K159 (b-WR-1, a-IN-2; amends D-04): the invitation page sends Referrer-Policy: same-origin, so
  // a browser sends the card's own post with its real Origin. The "null" Origin plus fetch
  // metadata shape that dd941e0 admitted under no-referrer is refused again, whatever the
  // metadata says; so is a missing Origin with metadata and a foreign Origin with metadata.
  it("refuses Origin null even with same-origin navigation metadata (the dd941e0 shape) and accepts nothing", async () => {
    const user = await signedInMemberOfOtherOrg();
    const { orgId: orgB, invitationId, token } = await invite(user.email);
    const ip = uniqueClientIp();
    const response = await post(
      token,
      { intent: "accept" },
      {
        cookie: user.cookie,
        origin: "null",
        fetchMetadata: { site: "same-origin", mode: "navigate" },
        ip,
      },
    );
    await expectRefusal(response, token, "origin");
    expect(await invitationStatus(invitationId)).toBe("pending");
    expect(await memberRows(orgB, user.userId)).toEqual([]);
    expect(await limiterRows(ip)).toBe(0);
  });

  it("refuses Origin null with any other metadata, and a missing or foreign Origin with metadata", async () => {
    const user = await signedInMemberOfOtherOrg();
    const { orgId: orgB, invitationId, token } = await invite(user.email);
    const ip = uniqueClientIp();
    const cases: Array<{ origin: string | null; fetchMetadata: { site: string; mode: string } }> = [
      { origin: "null", fetchMetadata: { site: "cross-site", mode: "navigate" } },
      { origin: "null", fetchMetadata: { site: "same-site", mode: "navigate" } },
      { origin: "null", fetchMetadata: { site: "none", mode: "navigate" } },
      { origin: "null", fetchMetadata: { site: "same-origin", mode: "cors" } },
      { origin: "null", fetchMetadata: { site: "same-origin", mode: "no-cors" } },
      { origin: null, fetchMetadata: { site: "same-origin", mode: "navigate" } },
      {
        origin: "https://evil.example.test",
        fetchMetadata: { site: "same-origin", mode: "navigate" },
      },
    ];
    for (const { origin, fetchMetadata } of cases) {
      const response = await post(
        token,
        { intent: "accept" },
        { cookie: user.cookie, origin, fetchMetadata, ip },
      );
      await expectRefusal(response, token, "origin");
    }
    expect(await invitationStatus(invitationId)).toBe("pending");
    expect(await memberRows(orgB, user.userId)).toEqual([]);
    expect(await limiterRows(ip)).toBe(0);
  });

  // K159: the exact match also admits an origin the operator listed in BETTER_AUTH_TRUSTED_ORIGINS
  // (the shipped default lists http://localhost and https://localhost, because Caddy serves
  // https://localhost while BETTER_AUTH_URL is http://localhost). Exact equality only: a listed
  // origin with another port or a suffix is still refused.
  it("admits an exact origin from BETTER_AUTH_TRUSTED_ORIGINS and refuses near misses of it", async () => {
    const trusted = "https://alias.invite-onboarding.example.test";
    const before = process.env.BETTER_AUTH_TRUSTED_ORIGINS;
    process.env.BETTER_AUTH_TRUSTED_ORIGINS = `${ORIGIN}, ${trusted}/`;
    try {
      const user = await signedInMemberOfOtherOrg();
      const { orgId: orgB, token } = await invite(user.email);
      for (const origin of [`${trusted}:444`, `${trusted}.evil.example.test`, `${trusted}/`]) {
        const refused = await post(token, { intent: "accept" }, { cookie: user.cookie, origin });
        await expectRefusal(refused, token, "origin");
      }
      expect(await memberRows(orgB, user.userId)).toEqual([]);
      const response = await post(
        token,
        { intent: "accept" },
        { cookie: user.cookie, origin: trusted },
      );
      expect(response.status).toBe(303);
      expect(await memberRows(orgB, user.userId)).toHaveLength(1);
    } finally {
      if (before === undefined) delete process.env.BETTER_AUTH_TRUSTED_ORIGINS;
      else process.env.BETTER_AUTH_TRUSTED_ORIGINS = before;
    }
  });

  // K182 (Codex diff round 1, LOW): a listed entry with a path, a query or a fragment is not a
  // bare origin and is ignored for the accept check; its origin is never trusted through it.
  it("K182: an entry of BETTER_AUTH_TRUSTED_ORIGINS with a path, a query or a fragment trusts nothing", async () => {
    const pathHost = "https://path.invite-onboarding.example.test";
    const queryHost = "https://query.invite-onboarding.example.test";
    const fragmentHost = "https://fragment.invite-onboarding.example.test";
    const bareHost = "https://bare.invite-onboarding.example.test";
    const before = process.env.BETTER_AUTH_TRUSTED_ORIGINS;
    process.env.BETTER_AUTH_TRUSTED_ORIGINS = `${pathHost}/app,${queryHost}/?x=1,${fragmentHost}/#a,${bareHost}`;
    try {
      const user = await signedInMemberOfOtherOrg();
      const { orgId: orgB, token } = await invite(user.email);
      for (const origin of [pathHost, queryHost, fragmentHost]) {
        const refused = await post(token, { intent: "accept" }, { cookie: user.cookie, origin });
        await expectRefusal(refused, token, "origin");
      }
      expect(await memberRows(orgB, user.userId)).toEqual([]);
      // Presence: the bare entry of the same list is admitted.
      const response = await post(
        token,
        { intent: "accept" },
        { cookie: user.cookie, origin: bareHost },
      );
      expect(response.status).toBe(303);
      expect(await memberRows(orgB, user.userId)).toHaveLength(1);
    } finally {
      if (before === undefined) delete process.env.BETTER_AUTH_TRUSTED_ORIGINS;
      else process.env.BETTER_AUTH_TRUSTED_ORIGINS = before;
    }
  });

  // K161 (a-WR-3, b-WR-3): 60 posts per hour per client address, so a team behind one address can
  // join, plus 10 per hour per invitation token, so password guessing through one link stays
  // capped whatever the address. Both are consumed before the token lookup and the body.
  it("K161: the 61st POST in an hour from one address lands on the invitation page as throttled, before the token lookup", async () => {
    expect(PUBLIC_RATE_LIMITS.inviteAccept.max).toBe(60);
    const ip = uniqueClientIp();
    for (let i = 0; i < PUBLIC_RATE_LIMITS.inviteAccept.max; i++) {
      // A different unknown token each time, so only the address limit can fill up; the unknown
      // intent is refused after the limits were consumed.
      const token = `not-a-token-${randomUUID()}`;
      await expectRefusal(await post(token, { intent: "probe" }, { ip }), token, "request");
    }
    expect(await limiterRows(ip)).toBe(60);
    const token = `not-a-token-${randomUUID()}`;
    const limited = await post(token, { intent: "accept" }, { ip });
    await expectRefusal(limited, token, "throttled");
    expect(await tokenLimiterRows(token)).toBe(0);
  });

  it("K161: the 11th POST in an hour for one invitation is throttled from any address and joins nothing; another invitation from the same address is not", async () => {
    expect(PUBLIC_RATE_LIMITS.inviteAcceptToken.max).toBe(10);
    const account = await createAccount(freshEmail());
    const { orgId, invitationId, token } = await invite(account.email);
    for (let i = 0; i < PUBLIC_RATE_LIMITS.inviteAcceptToken.max; i++) {
      // A fresh address each time, so only the token limit can fill up.
      const wrong = await post(token, { intent: "sign-in", password: `wrong-${i}` });
      expect(wrong.headers.get("location")).toBe(`/invite/${token}?error=password`);
    }
    expect(await tokenLimiterRows(token)).toBe(10);
    // The right password from a new address: still throttled, and nothing is accepted.
    const ip = uniqueClientIp();
    await expectRefusal(
      await post(token, { intent: "sign-in", password: account.password }, { ip }),
      token,
      "throttled",
    );
    expect(await memberRows(orgId, account.userId)).toEqual([]);
    expect(await invitationStatus(invitationId)).toBe("pending");
    // The same address is not throttled for another invitation.
    const other = await createAccount(freshEmail());
    const second = await invite(other.email);
    const joined = await post(
      second.token,
      { intent: "sign-in", password: other.password },
      { ip },
    );
    expect(joined.headers.get("location")).toBe("/tickets?joined=1");
  });

  it("K161: a malformed, oversized or many-part body and an unknown intent land on the invitation page as ?error=request", async () => {
    const email = freshEmail();
    const { invitationId, token } = await invite(email);
    const send = (body: string, contentType: string) =>
      acceptPost(
        new Request(`${ORIGIN}/invite/${token}/accept`, {
          method: "POST",
          headers: {
            origin: ORIGIN,
            "x-forwarded-for": uniqueClientIp(),
            "content-type": contentType,
          },
          body,
        }),
        { params: Promise.resolve({ token }) },
      );
    const formType = "application/x-www-form-urlencoded";
    const cases: Array<[string, Response]> = [
      ["json body", await send(JSON.stringify({ intent: "accept" }), "application/json")],
      ["oversized", await send(`intent=sign-up&name=${"x".repeat(5 * 1024)}`, formType)],
      ["five parts", await send("intent=sign-up&name=a&password=b&email=c&extra=d", formType)],
      ["unknown intent", await post(token, { intent: "probe" })],
    ];
    for (const [label, response] of cases) {
      expect(response.status, label).toBe(303);
      await expectRefusal(response, token, "request");
    }
    expect(await usersWithEmail(email)).toEqual([]);
    expect(await invitationStatus(invitationId)).toBe("pending");
  });

  // K160 (b-WR-5): every 303 has a relative Location, so the browser resolves it against the URL
  // it actually posted to. With the shipped default (BETTER_AUTH_URL http://localhost, Caddy
  // serving https://localhost) an absolute target on BETTER_AUTH_URL would send the browser from
  // https to http after the form post, which CSP form-action 'self' blocks.
  it("K160: a join posted from a trusted origin with another scheme gets a relative Location, never one on BETTER_AUTH_URL", async () => {
    const otherScheme = ORIGIN.replace(/^http:/, "https:");
    const before = process.env.BETTER_AUTH_TRUSTED_ORIGINS;
    process.env.BETTER_AUTH_TRUSTED_ORIGINS = otherScheme;
    try {
      const user = await signedInMemberOfOtherOrg();
      const { orgId: orgB, token } = await invite(user.email);
      const response = await post(
        token,
        { intent: "accept" },
        { cookie: user.cookie, origin: otherScheme },
      );
      expect(response.status).toBe(303);
      const location = response.headers.get("location") ?? "";
      expect(location).toBe("/tickets?joined=1");
      expect(location.startsWith("//")).toBe(false);
      expect(location).not.toContain(ORIGIN);
      expect(await memberRows(orgB, user.userId)).toHaveLength(1);
    } finally {
      if (before === undefined) delete process.env.BETTER_AUTH_TRUSTED_ORIGINS;
      else process.env.BETTER_AUTH_TRUSTED_ORIGINS = before;
    }
  });

  it("intent sign-up answers 303 to /tickets?joined=1 with the new session cookie; a posted email field is ignored", async () => {
    const email = freshEmail();
    const { orgId, token } = await invite(email);

    const response = await post(token, {
      intent: "sign-up",
      name: "Route Invitee",
      password: NEW_PASSWORD,
      email: "someone-else@example.test",
    });

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/tickets?joined=1`);
    const setCookies = response.headers.getSetCookie();
    expect(setCookies.filter((c) => c.split("=")[0].endsWith("session_token"))).toHaveLength(1);
    const users = await usersWithEmail(email);
    expect(users).toHaveLength(1);
    expect(await usersWithEmail("someone-else@example.test")).toEqual([]);
    const session = await readFreshSession(new Headers({ cookie: cookieFrom(setCookies) }));
    expect(session?.user.id).toBe(users[0].id);
    expect(session?.session.activeOrganizationId).toBe(orgId);
  });

  it("intent sign-in with a wrong password answers 303 to ?error=password and sets no cookie", async () => {
    const account = await createAccount(freshEmail());
    const { orgId, token } = await invite(account.email);

    const response = await post(token, { intent: "sign-in", password: "wrong password!" });

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/invite/${token}?error=password`);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await memberRows(orgId, account.userId)).toEqual([]);
  });

  it("intent sign-in with the right password answers 303 to /tickets?joined=1 with the session cookie", async () => {
    const account = await createAccount(freshEmail());
    const { orgId, token } = await invite(account.email);

    const response = await post(token, { intent: "sign-in", password: account.password });

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/tickets?joined=1`);
    const session = await readFreshSession(
      new Headers({ cookie: cookieFrom(response.headers.getSetCookie()) }),
    );
    expect(session?.user.id).toBe(account.userId);
    expect(session?.session.activeOrganizationId).toBe(orgId);
  });

  it("refuses invalid sign-up fields with 303 to ?error=field and creates no account", async () => {
    const email = freshEmail();
    const { token } = await invite(email);
    for (const fields of [
      { name: "   ", password: NEW_PASSWORD },
      { name: "x".repeat(101), password: NEW_PASSWORD },
      { name: "Short Password", password: "1234567" },
      { name: "Long Password", password: "p".repeat(129) },
    ]) {
      const response = await post(token, { intent: "sign-up", ...fields });
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(`/invite/${token}?error=field`);
    }
    expect(await usersWithEmail(email)).toEqual([]);
  });

  it("signed out, accept answers 303 back to the link (the page then renders the sign-in or create-account state)", async () => {
    const email = freshEmail();
    const { invitationId, token } = await invite(email);

    const response = await post(token, { intent: "accept" });

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/invite/${token}`);
    expect(await invitationStatus(invitationId)).toBe("pending");
  });

  it("an unknown token answers 303 back to the link with no detail", async () => {
    const user = await signedInMemberOfOtherOrg();
    const token = "A".repeat(43);

    const response = await post(token, { intent: "accept" }, { cookie: user.cookie });

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/invite/${token}`);
  });
});
