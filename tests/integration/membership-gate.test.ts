// Phase 10, plan 10-02 (AIDA-43, D-08, V-23, V-05, V-27): the one membership gate, on a real
// Postgres through Testcontainers with no mock of the database or of Better Auth.
//
// A user is created and signed in through in-process auth.api.signUpEmail and signInEmail with
// returnHeaders, and the request headers are built from the returned Set-Cookie values (the
// session token cookie; the cookie cache is off, R10-1), exactly what a browser sends. Where a
// test needs a cached copy of the session in the cookies, as a browser may still hold one from a
// deployment with the cache on, a Better Auth instance with the cache on mints it (cachingAuth).
// Only the Next request scope is replaced: `next/headers` returns those headers and
// `next/navigation`'s redirect throws a recognisable error that carries its target.
//
// Proves: readFreshSession never trusts the cookie cache (a deleted session row is gone, a changed
// activeOrganizationId is seen), a valid session read sets no cookie (R10-1), getScopedDb re-reads
// membership on every call, and the attachment route answers a removed member exactly like a
// missing attachment.
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { betterAuth } from "better-auth";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const env = await vi.hoisted(async () => {
  const { mkdtemp } = await import("node:fs/promises");
  const os = await import("node:os");
  const nodePath = await import("node:path");
  const uploadsDir = await mkdtemp(nodePath.join(os.tmpdir(), "aida-membership-gate-"));
  const previous = {
    UPLOADS_DIR: process.env.UPLOADS_DIR,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
  };
  // Read once when src/lib/attachments/local-file-storage.ts and src/lib/auth.ts load.
  process.env.UPLOADS_DIR = uploadsDir;
  process.env.BETTER_AUTH_SECRET = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  return { uploadsDir, previous, requestHeaders: new Headers() };
});

/** The error the mocked redirect throws; `target` is the path redirect() was called with. */
class RedirectSignal extends Error {
  constructor(readonly target: string) {
    super(`NEXT_REDIRECT ${target}`);
  }
}

vi.mock("next/headers", () => ({ headers: async () => env.requestHeaders }));
vi.mock("next/navigation", () => ({
  redirect: (target: string) => {
    throw new RedirectSignal(target);
  },
}));

import { GET as attachmentGet } from "@/app/api/attachments/[id]/route";
import { POST as messagesPost } from "@/app/api/tickets/[id]/messages/route";
import { localFileStorage } from "@/lib/attachments/local-file-storage";
import { auth } from "@/lib/auth";
import { getActiveOrgAccess, requireOrgAdminScope } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { readFreshSession } from "@/lib/fresh-session";
import { AccessDeniedError } from "@/lib/membership";
import { requirePageAccess } from "@/lib/page-access";
import { getScopedDb, getSessionActor } from "@/lib/session";
import { seedTicket } from "../support/inbox-fixtures";

afterAll(async () => {
  await rm(env.uploadsDir, { recursive: true, force: true });
  for (const [key, value] of Object.entries(env.previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

beforeEach(() => {
  env.requestHeaders = new Headers();
});

type Role = "owner" | "admin" | "member";

async function createOrg(): Promise<string> {
  const orgId = randomUUID();
  await prisma.organization.create({
    data: { id: orgId, name: "Gate Org", slug: `gate-${orgId}`, createdAt: new Date() },
  });
  return orgId;
}

async function addMember(orgId: string, userId: string, role: Role, id: string = randomUUID()) {
  await prisma.member.create({
    data: { id, organizationId: orgId, userId, role, createdAt: new Date() },
  });
}

interface SignedIn {
  orgId: string;
  userId: string;
  /** The Cookie header a browser would send after this sign-in. */
  cookie: string;
  /** The session token, the session row's key. */
  token: string;
}

/**
 * An organization, a user who is a member with `role`, and a real sign-in. The member row exists
 * before the sign-in, so Better Auth's session hook (src/lib/auth.ts) sets the active organization.
 */
async function signedInMember(role: Role = "member"): Promise<SignedIn> {
  const orgId = await createOrg();
  const email = `gate-${randomUUID()}@example.test`;
  const password = `pw-${randomUUID()}`;
  const signUp = await auth.api.signUpEmail({ body: { name: "Gate Agent", email, password } });
  const userId = signUp.user.id;
  await addMember(orgId, userId, role);
  const { headers, response } = await auth.api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  });
  const cookie = headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  expect(cookie).toContain("session_token=");
  // The cookie cache is off (src/lib/auth.ts, R10-1), so the sign-in hands out no cached copy.
  expect(cookie).not.toContain("session_data=");
  return { orgId, userId, cookie, token: response.token };
}

function headersFor(cookie: string): Headers {
  return new Headers({ cookie });
}

/**
 * AIDA's Better Auth options with the five-minute cookie cache on, as configured before R10-1.
 * It shares the database and the secret, so the session_data cookie it hands out is a valid cached
 * copy of the same session row: the cookie a browser may still hold from such a deployment.
 */
const cachingAuth = betterAuth({
  ...auth.options,
  session: { ...auth.options.session, cookieCache: { enabled: true, maxAge: 5 * 60 } },
});

/** The Cookie header of `s` plus a cached copy of its session, minted by cachingAuth now. */
async function withCachedCopy(s: SignedIn): Promise<string> {
  const { headers } = await cachingAuth.api.getSession({
    headers: headersFor(s.cookie),
    returnHeaders: true,
  });
  const data = headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .filter((c) => c.includes("session_data="));
  expect(data).toHaveLength(1);
  return `${s.cookie}; ${data[0]}`;
}

/** A read that trusts the cookie cache, for comparison only: no AIDA path reads this way. */
function cacheTrustingRead(cookie: string) {
  return cachingAuth.api.getSession({ headers: headersFor(cookie) });
}

/** Better Auth's default read (no disableCookieCache), as its own HTTP endpoints read. */
function defaultRead(cookie: string) {
  return auth.api.getSession({ headers: headersFor(cookie) });
}

describe("readFreshSession (V-23): the cookie cache is never the source of truth", () => {
  it("returns the signed-in session with its active organization", async () => {
    const s = await signedInMember();
    const session = await readFreshSession(headersFor(s.cookie));
    expect(session?.user.id).toBe(s.userId);
    expect(session?.session.activeOrganizationId).toBe(s.orgId);
  });

  it("sees a session row deleted after sign-in as gone, with the same cookies and a cached copy", async () => {
    const s = await signedInMember();
    const cookie = await withCachedCopy(s);
    // Presence first, through every read, so a null below cannot come from a bad cookie.
    expect((await readFreshSession(headersFor(cookie)))?.user.id).toBe(s.userId);
    expect((await defaultRead(cookie))?.user.id).toBe(s.userId);
    expect((await cacheTrustingRead(cookie))?.user.id).toBe(s.userId);

    await prisma.session.delete({ where: { token: s.token } });

    expect(await readFreshSession(headersFor(cookie))).toBeNull();
    // With the cache off, Better Auth's default read (its own endpoints) sees the row gone too.
    expect(await defaultRead(cookie)).toBeNull();
    // Recorded for the SUMMARY: a cache-trusting read still answers from the session data cookie,
    // which is why the cache is off and no AIDA path may read that way.
    const cached = await cacheTrustingRead(cookie);
    expect(cached?.user.id).toBe(s.userId);
    expect(cached?.session.activeOrganizationId).toBe(s.orgId);
  });

  it("on a deleted row the fresh read expires the session token and the cached data cookies", async () => {
    const s = await signedInMember();
    const cookie = await withCachedCopy(s);
    expect((await readFreshSession(headersFor(cookie)))?.user.id).toBe(s.userId);
    await prisma.session.delete({ where: { token: s.token } });

    const { headers, response } = await auth.api.getSession({
      headers: headersFor(cookie),
      query: { disableCookieCache: true },
      returnHeaders: true,
    });
    expect(response).toBeNull();
    const expired = headers
      .getSetCookie()
      .filter((c) => /max-age=0/i.test(c))
      .map((c) => c.split("=")[0]);
    expect(expired.some((name) => name.endsWith("session_token"))).toBe(true);
    expect(expired.some((name) => name.endsWith("session_data"))).toBe(true);
  });

  it("sees a database update of session.activeOrganizationId on the next read", async () => {
    const s = await signedInMember();
    const cookie = await withCachedCopy(s);
    const otherOrg = await createOrg();
    await addMember(otherOrg, s.userId, "member");
    expect((await readFreshSession(headersFor(cookie)))?.session.activeOrganizationId).toBe(
      s.orgId,
    );
    expect((await cacheTrustingRead(cookie))?.session.activeOrganizationId).toBe(s.orgId);

    await prisma.session.update({
      where: { token: s.token },
      data: { activeOrganizationId: otherOrg },
    });

    expect((await readFreshSession(headersFor(cookie)))?.session.activeOrganizationId).toBe(
      otherOrg,
    );
    expect((await defaultRead(cookie))?.session.activeOrganizationId).toBe(otherOrg);
    // Recorded for the SUMMARY: the cached copy still names the old organization.
    expect((await cacheTrustingRead(cookie))?.session.activeOrganizationId).toBe(s.orgId);
  });

  it("returns null without a session cookie", async () => {
    expect(await readFreshSession(new Headers())).toBeNull();
  });
});

/**
 * The Set-Cookie values of every auth.api.getSession call made while `run` executes, one array per
 * call. The spy re-issues the caller's own arguments with returnHeaders and hands the caller only
 * the session, so readFreshSession runs unchanged and its real call is the one observed.
 */
async function setCookiesOfSessionReads(run: () => Promise<unknown>): Promise<string[][]> {
  const original = auth.api.getSession;
  const seen: string[][] = [];
  const spy = vi.spyOn(auth.api, "getSession").mockImplementation((async (context: {
    headers: Headers;
    query?: { disableCookieCache?: boolean; disableRefresh?: boolean };
  }) => {
    const { headers, response } = await original({ ...context, returnHeaders: true });
    seen.push(headers.getSetCookie());
    return response;
  }) as unknown as typeof original);
  try {
    await run();
  } finally {
    spy.mockRestore();
  }
  return seen;
}

describe("R10-1: a session read sets no cookie for a valid session", () => {
  // Better Auth's nextCookies plugin (src/lib/auth.ts) turns every Set-Cookie of an auth.api call
  // into cookies().set(), and Next.js re-renders the route of any server action that sets a cookie
  // (x-action-revalidated). A refused action must leave the page as it is (its alert, the selection,
  // focus), so the reads a server action makes may not set a cookie while the session is valid.
  it("readFreshSession, getSessionActor and getScopedDb each read once and set no cookie", async () => {
    const s = await signedInMember();
    // What a browser sends with a server action: its cookies and Next.js's action header.
    const actionHeaders = () => new Headers({ cookie: s.cookie, "next-action": "r10-1" });

    const fresh = await setCookiesOfSessionReads(async () => {
      expect((await readFreshSession(actionHeaders()))?.user.id).toBe(s.userId);
    });
    expect(fresh).toEqual([[]]);

    env.requestHeaders = actionHeaders();
    const actor = await setCookiesOfSessionReads(async () => {
      expect(await getSessionActor()).toEqual({ userId: s.userId, orgId: s.orgId });
    });
    expect(actor).toEqual([[]]);

    env.requestHeaders = actionHeaders();
    const scoped = await setCookiesOfSessionReads(async () => {
      expect((await getScopedDb()).orgId).toBe(s.orgId);
    });
    expect(scoped).toEqual([[]]);
  });

  it("expires a cached copy left from a deployment with the cache on, once, and reads the row", async () => {
    const s = await signedInMember();
    const cookie = await withCachedCopy(s);
    const seen = await setCookiesOfSessionReads(async () => {
      expect((await readFreshSession(headersFor(cookie)))?.user.id).toBe(s.userId);
    });
    // The only cookie this read sets is the expiry of the stale copy; the browser then drops it,
    // and every read after that sets none (the case above).
    expect(seen).toHaveLength(1);
    expect(seen[0]).toHaveLength(1);
    expect(seen[0][0]).toMatch(/^better-auth\.session_data=;/);
    expect(seen[0][0]).toMatch(/max-age=0/i);
  });
});

describe("getScopedDb (D-08): membership re-read on every call", () => {
  it("returns the organization, a scoped client and the role for a member", async () => {
    const s = await signedInMember("admin");
    env.requestHeaders = headersFor(s.cookie);
    const scoped = await getScopedDb();
    expect(scoped.orgId).toBe(s.orgId);
    expect(scoped.role).toBe("admin");
    expect(scoped.session.user.id).toBe(s.userId);
    expect(typeof scoped.db.ticket.findFirst).toBe("function");
  });

  it("throws AccessDeniedError (403) once the member row is deleted, with the same cookies", async () => {
    const s = await signedInMember();
    env.requestHeaders = headersFor(s.cookie);
    expect((await getScopedDb()).role).toBe("member");

    await prisma.member.deleteMany({ where: { organizationId: s.orgId, userId: s.userId } });

    const err = await getScopedDb().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AccessDeniedError);
    expect((err as AccessDeniedError).status).toBe(403);
  });

  it("throws AccessDeniedError when the session has no active organization", async () => {
    const s = await signedInMember();
    env.requestHeaders = headersFor(s.cookie);
    expect((await getScopedDb()).orgId).toBe(s.orgId);

    await prisma.session.update({
      where: { token: s.token },
      data: { activeOrganizationId: null },
    });

    await expect(getScopedDb()).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("throws AccessDeniedError when the session names an organization the user is not in", async () => {
    const s = await signedInMember();
    const foreignOrg = await createOrg();
    env.requestHeaders = headersFor(s.cookie);
    expect((await getScopedDb()).orgId).toBe(s.orgId);

    await prisma.session.update({
      where: { token: s.token },
      data: { activeOrganizationId: foreignOrg },
    });

    await expect(getScopedDb()).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("returns role member for mixed duplicate rows (owner and member), in both id orders", async () => {
    for (const extraId of ["0-gate-extra", "z-gate-extra"]) {
      const s = await signedInMember("owner");
      await addMember(s.orgId, s.userId, "member", `${extraId}-${randomUUID()}`);
      env.requestHeaders = headersFor(s.cookie);
      expect((await getScopedDb()).role).toBe("member");
    }
  });

  it("redirects to /login without a session", async () => {
    env.requestHeaders = new Headers();
    const err = await getScopedDb().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RedirectSignal);
    expect((err as RedirectSignal).target).toBe("/login");
  });
});

describe("/api/attachments/[id] (D-08): a removed member gets the missing-attachment answer", () => {
  async function seedAttachment(orgId: string) {
    const ticket = await seedTicket(orgId);
    const message = await prisma.message.create({
      data: {
        organizationId: orgId,
        ticketId: ticket.id,
        direction: "INBOUND",
        bodyMarkdown: "with file",
        bodyHtml: "<p>with file</p>",
      },
    });
    const key = `${randomUUID().replace(/-/g, "")}.txt`;
    await localFileStorage.save({ orgId, key, data: Buffer.from("gate file body") });
    return prisma.attachment.create({
      data: {
        organizationId: orgId,
        messageId: message.id,
        storageKey: key,
        originalFilename: "gate.txt",
        mimeType: "text/plain",
        sizeBytes: 14,
      },
    });
  }

  function get(id: string) {
    return attachmentGet(new Request(`http://localhost/api/attachments/${id}`), {
      params: Promise.resolve({ id }),
    });
  }

  it("serves the file to a member and answers 404 not_found for a missing id", async () => {
    const s = await signedInMember();
    const attachment = await seedAttachment(s.orgId);
    env.requestHeaders = headersFor(s.cookie);

    const ok = await get(attachment.id);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("gate file body");

    const missing = await get(`missing-${randomUUID()}`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "not_found" });
  });

  it("answers a removed member exactly as for a missing attachment", async () => {
    const s = await signedInMember();
    const attachment = await seedAttachment(s.orgId);
    env.requestHeaders = headersFor(s.cookie);
    expect((await get(attachment.id)).status).toBe(200);

    await prisma.member.deleteMany({ where: { organizationId: s.orgId, userId: s.userId } });

    const missing = await get(`missing-${randomUUID()}`);
    const existing = await get(attachment.id);
    expect(existing.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await existing.json()).toEqual({ error: "not_found" });
    expect(await missing.json()).toEqual({ error: "not_found" });
  });

  it("still answers 401 without a session", async () => {
    env.requestHeaders = new Headers();
    const res = await get(`any-${randomUUID()}`);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });
});

describe("requirePageAccess (V-27): the one page helper", () => {
  /** The redirect target requirePageAccess threw, or null when it returned. */
  async function redirectTarget(): Promise<string | null> {
    try {
      await requirePageAccess();
      return null;
    } catch (err) {
      // The redirect must reach the caller as thrown by redirect(), never wrapped or swallowed.
      expect(err).toBeInstanceOf(RedirectSignal);
      return (err as RedirectSignal).target;
    }
  }

  it("returns the session, organization, role and a scoped client for a member", async () => {
    const s = await signedInMember("owner");
    env.requestHeaders = headersFor(s.cookie);
    const access = await requirePageAccess();
    expect(access.orgId).toBe(s.orgId);
    expect(access.role).toBe("owner");
    expect(access.session.user.id).toBe(s.userId);
    expect(typeof access.db.ticket.findMany).toBe("function");
  });

  it("redirects to /no-access once the member row is deleted", async () => {
    const s = await signedInMember();
    env.requestHeaders = headersFor(s.cookie);
    expect(await redirectTarget()).toBeNull();

    await prisma.member.deleteMany({ where: { organizationId: s.orgId, userId: s.userId } });

    expect(await redirectTarget()).toBe("/no-access");
  });

  it("redirects to /no-access when the session has no active organization", async () => {
    const s = await signedInMember();
    env.requestHeaders = headersFor(s.cookie);
    expect(await redirectTarget()).toBeNull();

    await prisma.session.update({
      where: { token: s.token },
      data: { activeOrganizationId: null },
    });

    expect(await redirectTarget()).toBe("/no-access");
  });

  it("redirects to /login without a session, and after the session row is deleted", async () => {
    env.requestHeaders = new Headers();
    expect(await redirectTarget()).toBe("/login");

    const s = await signedInMember();
    env.requestHeaders = headersFor(s.cookie);
    expect(await redirectTarget()).toBeNull();
    await prisma.session.delete({ where: { token: s.token } });
    expect(await redirectTarget()).toBe("/login");
  });

  it("returns role member for mixed duplicate rows (admin and member)", async () => {
    const s = await signedInMember("admin");
    await addMember(s.orgId, s.userId, "member", `z-page-${randomUUID()}`);
    env.requestHeaders = headersFor(s.cookie);
    expect((await requirePageAccess()).role).toBe("member");
  });
});

describe("/api/tickets/[id]/messages (D-08): 403 for a removed member", () => {
  function post(ticketId: string) {
    const form = new FormData();
    form.set("mode", "internal");
    form.set("body", "Internal note from the gate suite");
    return messagesPost(
      new Request(`http://localhost/api/tickets/${ticketId}/messages`, {
        method: "POST",
        body: form,
      }),
      { params: Promise.resolve({ id: ticketId }) },
    );
  }

  function messageCount(ticketId: string) {
    return prisma.message.count({ where: { ticketId } });
  }

  it("writes an internal note for a member", async () => {
    const s = await signedInMember();
    const ticket = await seedTicket(s.orgId);
    env.requestHeaders = headersFor(s.cookie);
    const before = await messageCount(ticket.id);

    const res = await post(ticket.id);

    expect(res.status).toBe(200);
    expect(await messageCount(ticket.id)).toBe(before + 1);
  });

  it("answers 403 membership_ended for a removed member and writes no message", async () => {
    const s = await signedInMember();
    const ticket = await seedTicket(s.orgId);
    env.requestHeaders = headersFor(s.cookie);
    await prisma.member.deleteMany({ where: { organizationId: s.orgId, userId: s.userId } });
    const before = await messageCount(ticket.id);

    const res = await post(ticket.id);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "membership_ended" });
    expect(await messageCount(ticket.id)).toBe(before);
  });

  it("answers 403 for a session with no active organization", async () => {
    const s = await signedInMember();
    const ticket = await seedTicket(s.orgId);
    env.requestHeaders = headersFor(s.cookie);
    await prisma.session.update({
      where: { token: s.token },
      data: { activeOrganizationId: null },
    });

    const res = await post(ticket.id);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "membership_ended" });
  });

  it("still answers 401 without a session", async () => {
    env.requestHeaders = new Headers();
    const res = await post(`any-${randomUUID()}`);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });
});

describe("authz gates keep their results through the fresh session read", () => {
  it("getActiveOrgAccess gives the role for a member and an admin, and null for a non-member", async () => {
    const member = await signedInMember("member");
    env.requestHeaders = headersFor(member.cookie);
    expect(await getActiveOrgAccess()).toMatchObject({ orgId: member.orgId, role: "member" });

    const admin = await signedInMember("admin");
    env.requestHeaders = headersFor(admin.cookie);
    expect(await getActiveOrgAccess()).toMatchObject({ orgId: admin.orgId, role: "admin" });

    await prisma.member.deleteMany({
      where: { organizationId: admin.orgId, userId: admin.userId },
    });
    expect(await getActiveOrgAccess()).toMatchObject({ orgId: admin.orgId, role: null });
  });

  it("requireOrgAdminScope admits an admin and refuses a member and a non-member", async () => {
    const admin = await signedInMember("admin");
    env.requestHeaders = headersFor(admin.cookie);
    const scope = await requireOrgAdminScope();
    expect(scope.orgId).toBe(admin.orgId);
    expect(scope.role).toBe("admin");

    const member = await signedInMember("member");
    env.requestHeaders = headersFor(member.cookie);
    await expect(requireOrgAdminScope()).rejects.toThrow(/Forbidden/);

    env.requestHeaders = headersFor(admin.cookie);
    await prisma.member.deleteMany({
      where: { organizationId: admin.orgId, userId: admin.userId },
    });
    await expect(requireOrgAdminScope()).rejects.toThrow(/Forbidden/);
  });
});
