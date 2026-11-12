// Phase 10, plan 10-07 (AIDA-45, D-20, D-21, V-12): mentions in internal notes, through the real
// messages route on a real Postgres (Testcontainers).
//
// The author signs in through in-process auth.api.signUpEmail and signInEmail, and the request
// carries the returned session cookie, as in membership-gate.test.ts: only the Next request scope
// is replaced (`next/headers` returns those headers, `next/navigation`'s redirect throws). The
// outbound queue is a recording double. Mentioned people are plain user and member rows.
//
// Leak proofs (D-21, V-12, T-10-26): the outbound worker sends only OUTBOUND PUBLIC messages and
// re-renders bodyMarkdown, so the assertion is on the mail it hands to the SMTP transport. The
// transport is a test double that records each mail (as in email-outbound-merge.test.ts, which
// V-15 allows for plain sends): no SMTP server is contacted and no email is sent.
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

interface SentMail {
  to: unknown;
  subject: string;
  text?: string;
  html?: string;
}

// Every mail the worker hands to the transport.
const transport = vi.hoisted(() => ({ sent: [] as SentMail[] }));

vi.mock("next/headers", () => ({ headers: async () => env.requestHeaders }));
vi.mock("next/navigation", () => ({
  redirect: (target: string) => {
    throw new Error(`NEXT_REDIRECT ${target}`);
  },
}));
// The worker imports this module by a relative path; the alias resolves to the same file, so the
// worker gets this recording transport.
vi.mock("@/lib/channels/email/smtp-client", () => ({
  createSmtpTransport: () => ({
    sendMail: async (mail: SentMail) => {
      transport.sent.push(mail);
      return { messageId: "fake" };
    },
  }),
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
import { saveEmailSettings } from "@/lib/channels/email/settings";
import { prisma } from "@/lib/db";
import {
  findMentionQuery,
  initialMentionDraft,
  type MentionDraftState,
  mentionDraftReducer,
  outgoingMentionIds,
} from "@/lib/mentions/composer-tokens";
import { MAX_MENTIONS } from "@/lib/mentions/mentions";
import { scopedDb } from "@/lib/scoped-db";
import { loadStatusPageData } from "@/lib/tickets/status-page-data";
import { emailOutboundSendHandler } from "@/lib/worker/jobs/email-outbound-send";
import { seedTicket } from "../support/inbox-fixtures";
import { seedContactTicket } from "../support/lifecycle-fixtures";

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
  transport.sent.length = 0;
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

async function messageCount(ticketId: string): Promise<number> {
  return prisma.message.count({ where: { ticketId, direction: "OUTBOUND" } });
}

async function expectRefused(response: Response, code: string) {
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: code });
}

describe("mention field validation over HTTP (D-21, V-12)", () => {
  it("refuses a mention on a public reply with 400 mentions_not_allowed and writes nothing", async () => {
    const author = await signedInAuthor();
    const mira = await person("Mira Public", author.orgId);
    const ticket = await seedTicket(author.orgId);

    await expectRefused(
      await post(ticket.id, {
        mode: "public",
        body: "Hello @Mira Public",
        mentions: JSON.stringify([mira.id]),
      }),
      "mentions_not_allowed",
    );
    // A mode outside the two counts as public (the route's default), so it is refused too.
    await expectRefused(
      await post(ticket.id, {
        mode: "INTERNAL",
        body: "Hello @Mira Public",
        mentions: JSON.stringify([mira.id]),
      }),
      "mentions_not_allowed",
    );
    expect(await messageCount(ticket.id)).toBe(0);
    expect(await prisma.messageMention.count({ where: { organizationId: author.orgId } })).toBe(0);
    expect(await mentionNotifications(author.orgId)).toEqual([]);
    expect(queue.sent).toEqual([]);
  });

  it("refuses malformed mention data and more than MAX_MENTIONS ids with 400 invalid_mentions", async () => {
    const author = await signedInAuthor();
    const mira = await person("Mira Malformed", author.orgId);
    const ticket = await seedTicket(author.orgId);
    const tooMany = Array.from({ length: MAX_MENTIONS + 1 }, () => randomUUID());
    expect(tooMany).toHaveLength(51);

    for (const mentions of [
      "[not json",
      JSON.stringify({ ids: [mira.id] }),
      JSON.stringify(mira.id),
      JSON.stringify([mira.id, 42]),
      JSON.stringify([""]),
      JSON.stringify(["x".repeat(129)]),
      JSON.stringify(tooMany),
    ]) {
      await expectRefused(
        await post(ticket.id, { mode: "internal", body: "Note @Mira Malformed", mentions }),
        "invalid_mentions",
      );
    }
    expect(await messageCount(ticket.id)).toBe(0);
    expect(await prisma.messageMention.count({ where: { organizationId: author.orgId } })).toBe(0);
    expect(await mentionNotifications(author.orgId)).toEqual([]);
  });

  it("accepts exactly MAX_MENTIONS ids", async () => {
    const author = await signedInAuthor();
    const ticket = await seedTicket(author.orgId);
    const ids = Array.from({ length: MAX_MENTIONS }, () => randomUUID());
    const response = await post(ticket.id, {
      mode: "internal",
      body: "Note with fifty unknown ids",
      mentions: JSON.stringify(ids),
    });
    expect(response.status).toBe(200);
    // None of them is a member, so nothing is recorded.
    const message = await latestMessage(ticket.id);
    expect(await mentionsOf(message.id)).toEqual([]);
  });
});

describe("who is recorded and notified (D-16, D-20, V-26, T-10-27)", () => {
  it("collapses duplicates, drops the author, non-members and users of another organization", async () => {
    const author = await signedInAuthor();
    const ana = await person("Ana Dupe", author.orgId);
    const outsider = await person("Otto Outsider");
    const otherOrg = await createOrg();
    const foreign = await person("Fay Foreign", otherOrg);
    const ticket = await seedTicket(author.orgId);

    const response = await post(ticket.id, {
      mode: "internal",
      body: "@Ana Dupe @Ana Dupe @Note Author @Otto Outsider @Fay Foreign",
      mentions: JSON.stringify([
        ana.id,
        ana.id,
        author.userId,
        outsider.id,
        foreign.id,
        randomUUID(),
      ]),
    });
    expect(response.status).toBe(200);

    const message = await latestMessage(ticket.id);
    expect(await mentionsOf(message.id)).toEqual([
      { organizationId: author.orgId, mentionedUserId: ana.id },
    ]);
    expect(await mentionNotifications(author.orgId)).toEqual([
      {
        recipientUserId: ana.id,
        actorUserId: author.userId,
        eventKey: `mention:${message.id}`,
        entityType: "ticket",
        entityId: ticket.id,
      },
    ]);
    // Nothing reached the other organization or the outsider.
    expect(await prisma.notification.count({ where: { organizationId: otherOrg } })).toBe(0);
    expect(
      await prisma.notification.count({
        where: { recipientUserId: { in: [outsider.id, foreign.id, author.userId] } },
      }),
    ).toBe(0);
    // Only the validated member's name became a span, twice; the others stay plain text.
    expect(message.bodyHtml.match(/<span\b/g)).toHaveLength(2);
    expect(message.bodyHtml).toContain(`${MENTION_SPAN_OPEN}@Ana Dupe</span>`);
    for (const plain of ["@Note Author", "@Otto Outsider", "@Fay Foreign"]) {
      expect(message.bodyHtml).toContain(plain);
      expect(message.bodyHtml).not.toContain(`${MENTION_SPAN_OPEN}${plain}`);
    }
  });

  it("shows the email local part for a member without a name, never the full email", async () => {
    const author = await signedInAuthor();
    const nameless = await person("", author.orgId);
    const local = nameless.email.slice(0, nameless.email.indexOf("@"));
    const ticket = await seedTicket(author.orgId);

    const response = await post(ticket.id, {
      mode: "internal",
      body: `Over to @${local} please`,
      mentions: JSON.stringify([nameless.id]),
    });
    expect(response.status).toBe(200);
    const message = await latestMessage(ticket.id);
    expect(message.bodyHtml).toContain(`${MENTION_SPAN_OPEN}@${local}</span>`);
    expect(message.bodyHtml).not.toContain(nameless.email);
    expect(await mentionsOf(message.id)).toHaveLength(1);
  });

  it("keeps the span of a former member in history and records no new mention of them", async () => {
    const author = await signedInAuthor();
    const lea = await person("Lea Leaver", author.orgId);
    const ticket = await seedTicket(author.orgId);

    expect(
      (
        await post(ticket.id, {
          mode: "internal",
          body: "First @Lea Leaver",
          mentions: JSON.stringify([lea.id]),
        })
      ).status,
    ).toBe(200);
    const first = await latestMessage(ticket.id);
    await prisma.member.deleteMany({ where: { organizationId: author.orgId, userId: lea.id } });

    expect(
      (
        await post(ticket.id, {
          mode: "internal",
          body: "Second @Lea Leaver",
          mentions: JSON.stringify([lea.id]),
        })
      ).status,
    ).toBe(200);
    const second = await latestMessage(ticket.id);
    expect(second.id).not.toBe(first.id);

    const stored = await prisma.message.findUniqueOrThrow({
      where: { id: first.id },
      select: { bodyHtml: true },
    });
    expect(stored.bodyHtml).toContain(`${MENTION_SPAN_OPEN}@Lea Leaver</span>`);
    expect(second.bodyHtml).not.toContain("<span");
    expect(await mentionsOf(second.id)).toEqual([]);
    expect(await mentionNotifications(author.orgId)).toEqual([
      expect.objectContaining({ recipientUserId: lea.id, eventKey: `mention:${first.id}` }),
    ]);
  });
});

// The composer's actions, as in mention-mode-switch.test.ts: a keystroke is an `edit` with the
// caret after the typed text, a Backspace an `edit` one to the left, a pick an `insert`.
function typeText(state: MentionDraftState, chars: string, at = state.caret ?? state.text.length) {
  const text = state.text.slice(0, at) + chars + state.text.slice(at);
  return mentionDraftReducer(state, { type: "edit", text, caret: at + chars.length });
}

function backspace(state: MentionDraftState): MentionDraftState {
  const at = state.caret ?? state.text.length;
  const text = state.text.slice(0, at - 1) + state.text.slice(at);
  return mentionDraftReducer(state, { type: "edit", text, caret: at - 1 });
}

function pick(state: MentionDraftState, who: Person): MentionDraftState {
  const typed = typeText(state, "@");
  const query = findMentionQuery(typed.text, typed.caret ?? typed.text.length, typed.spans);
  if (query === null) throw new Error(`no trigger in ${JSON.stringify(typed.text)}`);
  return mentionDraftReducer(typed, {
    type: "insert",
    query,
    member: { userId: who.id, name: who.name },
  });
}

const internalDraft = mentionDraftReducer(initialMentionDraft, {
  type: "setMode",
  mode: "internal",
});

// K172 (review d-WR-2): the route keeps a mentioned id only when the member's current display name
// is rendered as a mention span in the body (the boundary rule of mention-syntax.ts). Any other id
// is dropped: no MessageMention, no notification.
describe("only a mention the body shows is recorded (K172)", () => {
  it("direct HTTP: an id whose name is not in the body records and notifies nobody", async () => {
    const author = await signedInAuthor();
    const mira = await person("Mira Hidden", author.orgId);
    const ticket = await seedTicket(author.orgId);

    for (const body of ["hi", "hi Mira Hidden", "hi @Mira", "mail x@Mira Hidden now"]) {
      const response = await post(ticket.id, {
        mode: "internal",
        body,
        mentions: JSON.stringify([mira.id]),
      });
      expect(response.status, body).toBe(200);
      const message = await latestMessage(ticket.id);
      expect(message.bodyMarkdown).toBe(body);
      expect(message.bodyHtml, body).not.toContain("<span");
      expect(await mentionsOf(message.id), body).toEqual([]);
    }
    expect(await mentionNotifications(author.orgId)).toEqual([]);
    expect(await prisma.notification.count({ where: { recipientUserId: mira.id } })).toBe(0);
  });

  it("insert, Backspace, type: '@Zetax' and 'x@Zeta' are no mention; the composer sends no id and the route records none", async () => {
    const author = await signedInAuthor();
    const zeta = await person("Zeta", author.orgId);
    const ana = await person("Ana Shown", author.orgId);
    const ticket = await seedTicket(author.orgId);

    // The review's sequence: insert "@Zeta ", Backspace removes the space, then type "x".
    let draft = pick(typeText(internalDraft, "Hi "), zeta);
    expect(draft.text).toBe("Hi @Zeta ");
    draft = typeText(backspace(draft), "x");
    expect(draft.text).toBe("Hi @Zetax");
    expect(outgoingMentionIds(draft)).toEqual([]);
    // A letter typed right before the "@" of an inserted name.
    let before = pick(typeText(internalDraft, "Hi "), zeta);
    before = typeText(before, "x", 3);
    expect(before.text).toBe("Hi x@Zeta ");
    expect(outgoingMentionIds(before)).toEqual([]);

    // An older composer, or a direct post, still sends the id: the route drops it. Ana is shown
    // in the same note, so the note does record a mention (presence first).
    for (const body of ["Hi @Zetax and @Ana Shown", "Hi x@Zeta and @Ana Shown"]) {
      const response = await post(ticket.id, {
        mode: "internal",
        body,
        mentions: JSON.stringify([zeta.id, ana.id]),
      });
      expect(response.status, body).toBe(200);
      const message = await latestMessage(ticket.id);
      expect(message.bodyHtml, body).toContain(`${MENTION_SPAN_OPEN}@Ana Shown</span>`);
      expect(message.bodyHtml.match(/<span\b/g), body).toHaveLength(1);
      expect(await mentionsOf(message.id), body).toEqual([
        { organizationId: author.orgId, mentionedUserId: ana.id },
      ]);
    }
    expect(await prisma.notification.count({ where: { recipientUserId: zeta.id } })).toBe(0);
    expect(await prisma.notification.count({ where: { recipientUserId: ana.id } })).toBe(2);
  });

  it("rename: a member renamed after the composer loaded the list is not recorded under the old name", async () => {
    const author = await signedInAuthor();
    const rita = await person("Rita Before", author.orgId);
    const ana = await person("Ana Stays", author.orgId);
    const ticket = await seedTicket(author.orgId);

    // The composer inserted both names from the list it loaded.
    let draft = pick(typeText(internalDraft, "Ping "), rita);
    draft = pick(typeText(draft, "and "), ana);
    expect(draft.text).toBe("Ping @Rita Before and @Ana Stays ");
    expect(outgoingMentionIds(draft)).toEqual([rita.id, ana.id]);
    // Rita renames herself before the note is saved.
    await prisma.user.update({ where: { id: rita.id }, data: { name: "Rita After" } });

    const response = await post(ticket.id, {
      mode: "internal",
      body: draft.text,
      mentions: JSON.stringify(outgoingMentionIds(draft)),
    });
    expect(response.status).toBe(200);
    const message = await latestMessage(ticket.id);
    expect(message.bodyHtml).toContain(`${MENTION_SPAN_OPEN}@Ana Stays</span>`);
    expect(message.bodyHtml).not.toContain(`${MENTION_SPAN_OPEN}@Rita`);
    expect(message.bodyHtml).not.toContain("Rita After");
    expect(await mentionsOf(message.id)).toEqual([
      { organizationId: author.orgId, mentionedUserId: ana.id },
    ]);
    expect(await prisma.notification.count({ where: { recipientUserId: rita.id } })).toBe(0);
    expect(await prisma.notification.count({ where: { recipientUserId: ana.id } })).toBe(1);
  });

  it("K174: a name holding Markdown is inserted escaped, rendered as one span with no link, and recorded", async () => {
    const author = await signedInAuthor();
    const odd = await person("Zeta [docs](https://example.invalid) *star*", author.orgId);
    const ticket = await seedTicket(author.orgId);

    const draft = typeText(pick(typeText(internalDraft, "Hi "), odd), "please check");
    expect(draft.text).not.toContain(`@${odd.name}`);
    expect(outgoingMentionIds(draft)).toEqual([odd.id]);
    const response = await post(ticket.id, {
      mode: "internal",
      body: draft.text,
      mentions: JSON.stringify(outgoingMentionIds(draft)),
    });
    expect(response.status).toBe(200);
    const message = await latestMessage(ticket.id);
    expect(message.bodyHtml).toBe(`<p>Hi ${MENTION_SPAN_OPEN}@${odd.name}</span> please check</p>`);
    expect(message.bodyHtml).not.toContain("<a");
    expect(message.bodyHtml).not.toContain("<em");
    expect(await mentionsOf(message.id)).toEqual([
      { organizationId: author.orgId, mentionedUserId: odd.id },
    ]);
  });
});

describe("a mention never reaches the customer (D-21, V-12, T-10-26)", () => {
  const SELF_ADDRESS = "support@mentions.test";

  async function seedEmailTicket(author: Author) {
    await saveEmailSettings(scopedDb(author.orgId), author.orgId, {
      enabled: true,
      fromAddress: SELF_ADDRESS,
      smtpHost: "fake-smtp.invalid",
      smtpPort: 2525,
      smtpSecure: false,
      smtpUser: "fake",
    });
    const contactEmail = `mention-contact-${randomUUID()}@example.test`;
    const ticket = await seedContactTicket(author.orgId, { contactEmail });
    return { ticket, contactEmail };
  }

  /** The one public reply the route queued, sent by the worker through the recording transport. */
  async function sendQueuedReply(): Promise<SentMail> {
    expect(queue.sent).toHaveLength(1);
    const [job] = queue.sent;
    expect(job.name).toBe("email-outbound-send");
    await emailOutboundSendHandler(job.data as { messageId: string });
    expect(transport.sent).toHaveLength(1);
    return transport.sent[0];
  }

  it("a public reply sent after a note with a mention carries no mention, class or member email", async () => {
    const author = await signedInAuthor();
    const quill = await person("Quillon Vantablack", author.orgId);
    const { ticket, contactEmail } = await seedEmailTicket(author);

    expect(
      (
        await post(ticket.id, {
          mode: "internal",
          body: "@Quillon Vantablack can you confirm the refund?",
          mentions: JSON.stringify([quill.id]),
        })
      ).status,
    ).toBe(200);
    const note = await latestMessage(ticket.id);
    expect(note.bodyHtml).toContain(`${MENTION_SPAN_OPEN}@Quillon Vantablack</span>`);
    expect(await mentionsOf(note.id)).toHaveLength(1);
    // The internal note is never queued.
    expect(queue.sent).toEqual([]);

    const replyText = "Your refund was approved today.";
    expect((await post(ticket.id, { mode: "public", body: replyText })).status).toBe(200);
    const mail = await sendQueuedReply();

    // Presence first: this is the reply, addressed to the contact.
    expect(mail.to).toBe(contactEmail);
    expect(mail.text).toContain(replyText);
    expect(mail.html).toContain(replyText);
    // Then absence, in both parts.
    for (const part of [mail.text ?? "", mail.html ?? ""]) {
      expect(part).not.toContain("Quillon");
      expect(part).not.toContain("Vantablack");
      expect(part).not.toContain("text-primary-emphasis");
      expect(part).not.toContain("font-semibold");
      expect(part).not.toContain(quill.email);
      expect(part).not.toContain("refund?");
    }

    // The customer status page shows the reply and nothing of the note.
    const statusRow = await prisma.ticket.findUniqueOrThrow({
      where: { id: ticket.id },
      select: { statusToken: true },
    });
    const page = await loadStatusPageData(statusRow.statusToken);
    expect(page?.messages.some((m) => m.bodyHtml.includes(replyText))).toBe(true);
    for (const message of page?.messages ?? []) {
      expect(message.visibility).toBe("PUBLIC");
      expect(message.bodyHtml).not.toContain("Quillon");
      expect(message.bodyHtml).not.toContain("text-primary-emphasis");
      expect(message.bodyHtml).not.toContain(quill.email);
    }
  });

  it("a plain @Name in a public reply stays plain text and notifies nobody", async () => {
    const author = await signedInAuthor();
    const quill = await person("Quillon Plaintext", author.orgId);
    const { ticket } = await seedEmailTicket(author);

    const replyText = "Thanks! @Quillon Plaintext from our team will follow up.";
    expect((await post(ticket.id, { mode: "public", body: replyText })).status).toBe(200);
    const reply = await latestMessage(ticket.id);
    expect(reply.visibility).toBe("PUBLIC");
    expect(reply.bodyHtml).not.toContain("<span");
    expect(await mentionsOf(reply.id)).toEqual([]);
    expect(await mentionNotifications(author.orgId)).toEqual([]);
    expect(await prisma.notification.count({ where: { recipientUserId: quill.id } })).toBe(0);

    const mail = await sendQueuedReply();
    expect(mail.text).toContain("@Quillon Plaintext");
    expect(mail.html).toContain("@Quillon Plaintext");
    expect(mail.html).not.toContain("<span");
    expect(mail.html).not.toContain("text-primary-emphasis");
    expect(mail.text).not.toContain(quill.email);
    expect(mail.html).not.toContain(quill.email);
  });

  it("an empty mentions list on a public reply is no mention and sends normally", async () => {
    const author = await signedInAuthor();
    const { ticket } = await seedEmailTicket(author);
    const replyText = "All set on our side.";
    expect(
      (await post(ticket.id, { mode: "public", body: replyText, mentions: "[]" })).status,
    ).toBe(200);
    const mail = await sendQueuedReply();
    expect(mail.text).toContain(replyText);
    expect(await prisma.messageMention.count({ where: { organizationId: author.orgId } })).toBe(0);
  });
});
