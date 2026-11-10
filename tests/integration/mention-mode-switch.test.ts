// Phase 10, plan 10-12 Task 3 (AIDA-45, D-21; review rows C7, R2-1, R3-2, V-12): after a switch
// from an internal note to a public reply, no inserted member name reaches the stored PUBLIC body
// or the customer's email.
//
// The text is built by driving mentionDraftReducer with the action sequence the composer
// dispatches (src/components/tickets/composer.tsx): every keystroke is an `edit` with the caret the
// textarea reports, every pick is an `insert` after an edit that typed "@" and the first letters of
// the name (as the autocomplete does), and the switch is the `setMode` action that the composer's
// single changeMode function dispatches. The outgoing form is built the way the composer builds it
// (outgoingMentionIds decides the `mentions` field) and posted through the real messages route
// with a real Better Auth session; the queued job is run through emailOutboundSendHandler with the
// transport mocked as in email-outbound-merge.test.ts (V-15: no SMTP double needed here). No SMTP
// server is contacted and no email is sent. The real-composer proof is plan 10-13.
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const env = await vi.hoisted(async () => {
  const { mkdtemp } = await import("node:fs/promises");
  const os = await import("node:os");
  const nodePath = await import("node:path");
  const uploadsDir = await mkdtemp(nodePath.join(os.tmpdir(), "aida-mention-switch-"));
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
  type MentionMember,
  mentionDraftReducer,
  outgoingMentionIds,
  reconcileMentionIds,
} from "@/lib/mentions/composer-tokens";
import { scopedDb } from "@/lib/scoped-db";
import { emailOutboundSendHandler } from "@/lib/worker/jobs/email-outbound-send";
import { seedContactTicket } from "../support/lifecycle-fixtures";

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

interface Person {
  id: string;
  name: string;
  email: string;
}

async function addMember(orgId: string, userId: string) {
  await prisma.member.create({
    data: {
      id: randomUUID(),
      organizationId: orgId,
      userId,
      role: "member",
      createdAt: new Date(),
    },
  });
}

/** A user row (no sign-in) who is a member of orgId. */
async function member(name: string, orgId: string): Promise<Person> {
  const id = randomUUID();
  const email = `switch-${id}@example.test`;
  const now = new Date();
  await prisma.user.create({
    data: { id, name, email, emailVerified: true, createdAt: now, updatedAt: now },
  });
  await addMember(orgId, id);
  return { id, name, email };
}

/** An organization and a signed-in member; the request headers carry the session cookie. */
async function signedInAuthor(): Promise<{ orgId: string; userId: string }> {
  const orgId = randomUUID();
  await prisma.organization.create({
    data: { id: orgId, name: "Switch Org", slug: `switch-${orgId}`, createdAt: new Date() },
  });
  const email = `switch-author-${randomUUID()}@example.test`;
  const password = `pw-${randomUUID()}`;
  const signUp = await auth.api.signUpEmail({ body: { name: "Switch Author", email, password } });
  await addMember(orgId, signUp.user.id);
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
  return { orgId, userId: signUp.user.id };
}

// The composer's actions. A keystroke or paste is an `edit` with the caret after the typed text;
// a Backspace is an `edit` with the caret one to the left; a pick is an `insert`.
function typeText(state: MentionDraftState, chars: string): MentionDraftState {
  const at = state.caret ?? state.text.length;
  const text = state.text.slice(0, at) + chars + state.text.slice(at);
  return mentionDraftReducer(state, { type: "edit", text, caret: at + chars.length });
}

function backspace(state: MentionDraftState): MentionDraftState {
  const at = state.caret ?? state.text.length;
  const text = state.text.slice(0, at - 1) + state.text.slice(at);
  return mentionDraftReducer(state, { type: "edit", text, caret: at - 1 });
}

function pick(state: MentionDraftState, person: Person): MentionDraftState {
  const typed = typeText(state, `@${person.name.slice(0, 2)}`);
  const query = findMentionQuery(typed.text, typed.caret ?? typed.text.length, typed.spans);
  if (query === null) throw new Error(`no trigger in ${JSON.stringify(typed.text)}`);
  const memberToInsert: MentionMember = { userId: person.id, name: person.name };
  return mentionDraftReducer(typed, { type: "insert", query, member: memberToInsert });
}

/** The composer's form for a draft: the `mentions` field only from outgoingMentionIds. */
function composerForm(state: MentionDraftState): FormData {
  const form = new FormData();
  form.set("mode", state.mode);
  form.set("body", state.text);
  const ids = outgoingMentionIds(state);
  if (state.mode === "internal" && ids.length > 0) form.set("mentions", JSON.stringify(ids));
  return form;
}

describe("a switch to public removes every inserted member name (C7, R2-1, R3-2, V-12)", () => {
  it("the stored PUBLIC body and the customer's email carry no inserted name, class or email", async () => {
    const author = await signedInAuthor();
    const zetaPrime = await member("Zeta Prime", author.orgId);
    const zeta = await member("Zeta", author.orgId);
    const omega = await member("Omega Probe", author.orgId);
    await saveEmailSettings(scopedDb(author.orgId), author.orgId, {
      enabled: true,
      fromAddress: "support@mention-switch.test",
      smtpHost: "fake-smtp.invalid",
      smtpPort: 2525,
      smtpSecure: false,
      smtpUser: "fake",
    });
    const contactEmail = `switch-contact-${randomUUID()}@example.test`;
    const ticket = await seedContactTicket(author.orgId, { contactEmail });

    // The composer's sequence, starting on Internal Note.
    let draft = mentionDraftReducer(initialMentionDraft, { type: "setMode", mode: "internal" });
    draft = typeText(draft, "Hi ");
    draft = pick(draft, zetaPrime);
    expect(draft.text).toBe("Hi @Zeta Prime ");
    draft = backspace(draft); // R3-2: the first Backspace removes only the trailing space
    expect(draft.text).toBe("Hi @Zeta Prime");
    expect(reconcileMentionIds(draft.text, draft.spans)).toEqual([zetaPrime.id]);
    draft = typeText(draft, ", can you check");
    draft = typeText(draft, " and ");
    draft = pick(draft, zeta);
    draft = typeText(draft, "please. Ping @someone ");
    draft = pick(draft, omega);
    draft = backspace(draft); // the space
    expect(reconcileMentionIds(draft.text, draft.spans)).toEqual([zetaPrime.id, zeta.id, omega.id]);
    draft = backspace(draft); // the whole "@Omega Probe" and its id
    expect(draft.text).toBe("Hi @Zeta Prime, can you check and @Zeta please. Ping @someone ");
    expect(outgoingMentionIds(draft)).toEqual([zetaPrime.id, zeta.id]);

    // The switch, through the same action changeMode dispatches.
    draft = mentionDraftReducer(draft, { type: "setMode", mode: "public" });
    expect(draft.mode).toBe("public");
    expect(draft.switchNote).toBe(true);
    expect(draft.text).toBe("Hi , can you check and  please. Ping @someone ");
    expect(outgoingMentionIds(draft)).toEqual([]);

    const form = composerForm(draft);
    expect(form.has("mentions")).toBe(false);
    const response = await messagesPost(
      new Request(`http://localhost/api/tickets/${ticket.id}/messages`, {
        method: "POST",
        body: form,
      }),
      { params: Promise.resolve({ id: ticket.id }) },
    );
    expect(response.status).toBe(200);

    const stored = await prisma.message.findFirstOrThrow({
      where: { ticketId: ticket.id, direction: "OUTBOUND" },
      orderBy: { seq: "desc" },
      select: { id: true, visibility: true, bodyMarkdown: true, bodyHtml: true },
    });

    expect(queue.sent).toHaveLength(1);
    const [job] = queue.sent;
    expect(job.name).toBe("email-outbound-send");
    await emailOutboundSendHandler(job.data as { messageId: string });
    expect(transport.sent).toHaveLength(1);
    const mail = transport.sent[0];

    // Presence first: this is the reply, stored and mailed to the contact.
    expect(stored.visibility).toBe("PUBLIC");
    expect(stored.bodyMarkdown).toContain("can you check");
    expect(stored.bodyMarkdown).toContain("@someone");
    expect(mail.to).toBe(contactEmail);
    expect(mail.text).toContain("can you check");
    expect(mail.text).toContain("@someone");

    // Then absence: no inserted name, no mention class and no member email anywhere.
    const memberEmails = [zetaPrime.email, zeta.email, omega.email];
    for (const part of [stored.bodyMarkdown, stored.bodyHtml, mail.text ?? "", mail.html ?? ""]) {
      expect(part).not.toContain("Zeta");
      expect(part).not.toContain("Omega");
      expect(part).not.toContain("text-primary-emphasis");
      expect(part).not.toContain("font-semibold");
      for (const email of memberEmails) expect(part).not.toContain(email);
    }
    expect(await prisma.messageMention.count({ where: { organizationId: author.orgId } })).toBe(0);
    expect(await prisma.notification.count({ where: { organizationId: author.orgId } })).toBe(0);
  });
});
