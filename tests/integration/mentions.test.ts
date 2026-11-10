// Phase 10, plan 10-07 (AIDA-45, D-20, D-21, V-12): mentions in internal notes, through the real
// messages route on a real Postgres (Testcontainers).
//
// The author signs in through in-process auth.api.signUpEmail and signInEmail, and the request
// carries the returned session cookie, as in membership-gate.test.ts: only the Next request scope
// is replaced (`next/headers` returns those headers, `next/navigation`'s redirect throws). The
// outbound queue is a recording double. Mentioned people are plain user and member rows.
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const env = await vi.hoisted(async () => {
  const { mkdtemp } = await import("node:fs/promises");
  const os = await import("node:os");
  const nodePath = await import("node:path");
  const uploadsDir = await mkdtemp(nodePath.join(os.tmpdir(), "aida-mentions-"));
  const previous = {
    UPLOADS_DIR: process.env.UPLOADS_DIR,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
  };
  // Read once when src/lib/attachments/local-file-storage.ts and src/lib/auth.ts load.
  process.env.UPLOADS_DIR = uploadsDir;
  process.env.BETTER_AUTH_SECRET = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  return { uploadsDir, previous, requestHeaders: new Headers() };
});

// The queue double records what the route enqueues after commit; nothing is sent from it.
const queue = vi.hoisted(() => ({ sent: [] as { name: string; data: unknown }[] }));

vi.mock("next/headers", () => ({ headers: async () => env.requestHeaders }));
vi.mock("next/navigation", () => ({
  redirect: (target: string) => {
    throw new Error(`NEXT_REDIRECT ${target}`);
  },
}));
vi.mock("@/lib/queue/boss-client", () => ({
  getBoss: async () => ({
    send: async (name: string, data: unknown) => {
      queue.sent.push({ name, data });
      return "job";
    },
  }),
}));

import { POST as messagesPost } from "@/app/api/tickets/[id]/messages/route";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { seedTicket } from "../support/inbox-fixtures";

const MENTION_SPAN_OPEN = '<span class="font-semibold text-primary-emphasis">';

afterAll(async () => {
  await rm(env.uploadsDir, { recursive: true, force: true });
  for (const [key, value] of Object.entries(env.previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

beforeEach(() => {
  env.requestHeaders = new Headers();
  queue.sent.length = 0;
});

type Role = "owner" | "admin" | "member";

async function createOrg(): Promise<string> {
  const orgId = randomUUID();
  await prisma.organization.create({
    data: { id: orgId, name: "Mention Org", slug: `mention-${orgId}`, createdAt: new Date() },
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

/** A user row (no sign-in), optionally a member of orgId. */
async function person(name: string, orgId?: string, role: Role = "member"): Promise<Person> {
  const id = randomUUID();
  const email = `mention-${id}@example.test`;
  const now = new Date();
  await prisma.user.create({
    data: { id, name, email, emailVerified: true, createdAt: now, updatedAt: now },
  });
  if (orgId) await addMember(orgId, id, role);
  return { id, name, email };
}

interface Author {
  orgId: string;
  userId: string;
}

/**
 * An organization and a signed-in member who writes the notes. The member row exists before the
 * sign-in, so the session hook (src/lib/auth.ts) sets the active organization; the request
 * headers then carry the session cookie, as a browser sends it.
 */
async function signedInAuthor(role: Role = "member"): Promise<Author> {
  const orgId = await createOrg();
  const email = `mention-author-${randomUUID()}@example.test`;
  const password = `pw-${randomUUID()}`;
  const signUp = await auth.api.signUpEmail({ body: { name: "Note Author", email, password } });
  const userId = signUp.user.id;
  await addMember(orgId, userId, role);
  const { headers } = await auth.api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  });
  const cookie = headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  expect(cookie).toContain("session_token=");
  env.requestHeaders = new Headers({ cookie });
  return { orgId, userId };
}

/** POSTs the composer form to the real messages route. */
async function post(ticketId: string, fields: Record<string, string>): Promise<Response> {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return messagesPost(
    new Request(`http://localhost/api/tickets/${ticketId}/messages`, {
      method: "POST",
      body: form,
    }),
    { params: Promise.resolve({ id: ticketId }) },
  );
}

async function latestMessage(ticketId: string) {
  return prisma.message.findFirstOrThrow({
    where: { ticketId, direction: "OUTBOUND" },
    orderBy: { seq: "desc" },
    select: { id: true, visibility: true, bodyMarkdown: true, bodyHtml: true },
  });
}

function mentionsOf(messageId: string) {
  return prisma.messageMention.findMany({
    where: { messageId },
    select: { organizationId: true, mentionedUserId: true },
  });
}

function mentionNotifications(orgId: string) {
  return prisma.notification.findMany({
    where: { organizationId: orgId, type: "MENTION" },
    select: {
      recipientUserId: true,
      actorUserId: true,
      eventKey: true,
      entityType: true,
      entityId: true,
    },
  });
}

describe("mention tracer (D-20)", () => {
  it("an internal note posted to the route with one mention stores it, notifies and renders the span", async () => {
    const author = await signedInAuthor();
    const mira = await person("Mira Tracer", author.orgId);
    const ticket = await seedTicket(author.orgId);

    const response = await post(ticket.id, {
      mode: "internal",
      body: "Please check this, @Mira Tracer.",
      mentions: JSON.stringify([mira.id]),
    });
    expect(response.status).toBe(200);

    const message = await latestMessage(ticket.id);
    expect(message.visibility).toBe("INTERNAL");
    expect(message.bodyMarkdown).toBe("Please check this, @Mira Tracer.");
    expect(message.bodyHtml).toContain(`${MENTION_SPAN_OPEN}@Mira Tracer</span>`);
    expect(message.bodyHtml).not.toContain(mira.email);

    expect(await mentionsOf(message.id)).toEqual([
      { organizationId: author.orgId, mentionedUserId: mira.id },
    ]);
    expect(await mentionNotifications(author.orgId)).toEqual([
      {
        recipientUserId: mira.id,
        actorUserId: author.userId,
        eventKey: `mention:${message.id}`,
        entityType: "ticket",
        entityId: ticket.id,
      },
    ]);
    // An internal note is never queued for the customer.
    expect(queue.sent).toEqual([]);
  });
});
