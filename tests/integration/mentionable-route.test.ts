// Run decision K175 (review d-WR-5, AIDA-45 45.1): GET /api/members/mentionable, the list the
// internal-note composer offers, through the real route on a real Postgres (Testcontainers).
//
// The caller signs in through in-process auth.api.signUpEmail and signInEmail, and the request
// carries the returned session cookie, as in membership-gate.test.ts: only the Next request scope
// is replaced (`next/headers` returns those headers, `next/navigation`'s redirect throws the same
// signal Next's redirect throws). The other people are plain user and member rows.
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const previous = { BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET };
  // Read once when src/lib/auth.ts loads.
  process.env.BETTER_AUTH_SECRET = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  return { previous, requestHeaders: new Headers() };
});

/** What next/navigation's redirect() throws: an Error with the NEXT_REDIRECT digest. */
const redirectSignal = vi.hoisted(
  () =>
    class RedirectSignal extends Error {
      readonly digest: string;
      constructor(readonly target: string) {
        super(`NEXT_REDIRECT ${target}`);
        this.digest = `NEXT_REDIRECT;replace;${target};307;`;
      }
    },
);

vi.mock("next/headers", () => ({ headers: async () => env.requestHeaders }));
vi.mock("next/navigation", () => ({
  redirect: (target: string) => {
    throw new redirectSignal(target);
  },
}));

import { GET as mentionableGet } from "@/app/api/members/mentionable/route";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

afterAll(() => {
  for (const [key, value] of Object.entries(env.previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

beforeEach(() => {
  env.requestHeaders = new Headers();
});

type Role = "owner" | "admin" | "member";

async function createOrg(name: string): Promise<string> {
  const orgId = randomUUID();
  await prisma.organization.create({
    data: { id: orgId, name, slug: `mentionable-${orgId}`, createdAt: new Date() },
  });
  return orgId;
}

async function addMember(orgId: string, userId: string, role: Role = "member") {
  await prisma.member.create({
    data: { id: randomUUID(), organizationId: orgId, userId, role, createdAt: new Date() },
  });
}

interface Person {
  id: string;
  name: string;
  email: string;
}

/** A user row (no sign-in). The email's local part is `${local}-<8 hex>`. */
async function person(name: string, local: string): Promise<Person> {
  const id = randomUUID();
  const email = `${local}-${id.slice(0, 8)}@example.test`;
  const now = new Date();
  await prisma.user.create({
    data: { id, name, email, emailVerified: true, createdAt: now, updatedAt: now },
  });
  return { id, name, email };
}

const localPart = (email: string) => email.slice(0, email.indexOf("@"));

interface Caller {
  userId: string;
  token: string;
}

/**
 * A signed-in member of orgId. The member row exists before the sign-in, so the session hook sets
 * the active organization; the request headers then carry the session cookie.
 */
async function signedInCaller(orgId: string): Promise<Caller> {
  const email = `mentionable-caller-${randomUUID()}@example.test`;
  const password = `pw-${randomUUID()}`;
  const signUp = await auth.api.signUpEmail({
    body: { name: "Aaron Caller", email, password },
  });
  await addMember(orgId, signUp.user.id, "member");
  const { headers, response } = await auth.api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  });
  const cookie = headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  expect(cookie).toContain("session_token=");
  env.requestHeaders = new Headers({ cookie });
  return { userId: signUp.user.id, token: response.token };
}

interface Seeded {
  orgA: string;
  orgB: string;
  caller: Caller;
  bea: Person;
  bo: Person;
  dora: Person;
  nameless: Person;
  atName: Person;
  removed: Person;
  foreign: Person;
  outsider: Person;
}

/**
 * Organization A: the caller, a member, a member of both organizations, a member with two rows
 * (owner and admin), a member without a name, a member whose name holds "@", and a removed member
 * (row deleted). Organization B: a user of B only. Plus a user with no member row at all.
 */
async function seed(): Promise<Seeded> {
  const orgA = await createOrg("Mentionable A");
  const orgB = await createOrg("Mentionable B");
  const caller = await signedInCaller(orgA);
  const bea = await person("Bea Member", "bea");
  await addMember(orgA, bea.id);
  const bo = await person("Bo Both", "bo");
  await addMember(orgA, bo.id);
  await addMember(orgB, bo.id);
  const dora = await person("Dora Double", "dora");
  await addMember(orgA, dora.id, "owner");
  await addMember(orgA, dora.id, "admin");
  const nameless = await person("", "nameless");
  await addMember(orgA, nameless.id);
  const atName = await person("ana@corp.example", "atname");
  await addMember(orgA, atName.id);
  const removed = await person("Rex Removed", "rex");
  await addMember(orgA, removed.id);
  await prisma.member.deleteMany({ where: { organizationId: orgA, userId: removed.id } });
  const foreign = await person("Fay Foreign", "fay");
  await addMember(orgB, foreign.id);
  const outsider = await person("Otto Outsider", "otto");
  return { orgA, orgB, caller, bea, bo, dora, nameless, atName, removed, foreign, outsider };
}

describe("GET /api/members/mentionable (K175, AIDA-45 45.1)", () => {
  it("lists the current members of the active organization only, once each, without the caller", async () => {
    const s = await seed();
    const res = await mentionableGet();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { members: Record<string, unknown>[] };

    // Presence and exact shape: sorted by name (case-insensitive), then id. A member without a
    // name, or whose name holds "@", is listed under the local part of their email.
    expect(body).toEqual({
      members: [
        { id: s.atName.id, name: localPart(s.atName.email), email: s.atName.email },
        { id: s.bea.id, name: "Bea Member", email: s.bea.email },
        { id: s.bo.id, name: "Bo Both", email: s.bo.email },
        { id: s.dora.id, name: "Dora Double", email: s.dora.email },
        { id: s.nameless.id, name: localPart(s.nameless.email), email: s.nameless.email },
      ],
    });
    for (const entry of body.members) {
      expect(Object.keys(entry).sort()).toEqual(["email", "id", "name"]);
      expect(entry.name).not.toContain("@");
      expect(entry.name).not.toBe("");
    }

    // Absence: the caller, the removed member, the user of the other organization only and a user
    // with no member row.
    const ids = body.members.map((m) => m.id);
    for (const absent of [s.caller.userId, s.removed.id, s.foreign.id, s.outsider.id]) {
      expect(ids).not.toContain(absent);
    }
    const text = JSON.stringify(body);
    for (const absent of [s.removed, s.foreign, s.outsider]) {
      expect(text).not.toContain(absent.email);
      expect(text).not.toContain(absent.name);
    }
  });

  it("answers 403 membership_ended for a removed member, and for a session without an active organization", async () => {
    const s = await seed();
    // Presence first: the same session lists members.
    expect((await mentionableGet()).status).toBe(200);

    await prisma.member.deleteMany({ where: { organizationId: s.orgA, userId: s.caller.userId } });
    const removed = await mentionableGet();
    expect(removed.status).toBe(403);
    expect(removed.headers.get("cache-control")).toBe("no-store");
    expect(await removed.json()).toEqual({ error: "membership_ended" });

    await addMember(s.orgA, s.caller.userId);
    expect((await mentionableGet()).status).toBe(200);
    await prisma.session.update({
      where: { token: s.caller.token },
      data: { activeOrganizationId: null },
    });
    const noOrg = await mentionableGet();
    expect(noOrg.status).toBe(403);
    expect(await noOrg.json()).toEqual({ error: "membership_ended" });
  });

  it("answers 401 without a session", async () => {
    await seed();
    env.requestHeaders = new Headers();
    const res = await mentionableGet();
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });
});
