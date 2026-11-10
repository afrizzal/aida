/**
 * AIDA-45 acceptance in the browser (Phase 10, plan 10-13 Task 3; D-20, D-21, C7, R2-1, R3-2,
 * V-12).
 *
 * One organization of its own: the author (an owner) and five members whose names exercise the
 * token rules: "Mira Member" (the plain mention), "Omega Probe" (the two-step Backspace),
 * "Zeta Prime" and "Zeta" (two names sharing a prefix). Every text change is typed into the real
 * composer textarea; nothing sets the text programmatically. Every absence is asserted after a
 * presence on the same textarea, request, stored message, page or email, so a broken page cannot
 * pass vacuously (T-10-48).
 *
 * The outgoing email of a public reply is produced by the real outbound handler
 * (emailOutboundSendHandler) run in this process against a loopback fake SMTP; the pg-boss worker
 * is not started in E2E. The organization's email settings are written after the reply is stored,
 * so the messages route queues nothing, and they carry no password (V-15). No real email is sent.
 */
import type { Page, Request } from "@playwright/test";
import { simpleParser } from "mailparser";
import { startFakeSmtp } from "../support/fake-smtp";
import { createTicket, prisma } from "./support/db";
import { expect, test } from "./support/fixtures";
import {
  addMember,
  createOrg,
  createUser,
  gotoWarm,
  notificationsFor,
  signedInContext,
  type TeamOrg,
  type TeamUser,
  uniqueEmail,
  writeFakeSmtpSettings,
} from "./support/team";

test.describe.configure({ mode: "serial", timeout: 240_000 });

const SWITCH_NOTE =
  "Mentions only work in internal notes. The mentioned names were removed from this reply.";

let org: TeamOrg;
let author: TeamUser;
let mira: TeamUser;
let omega: TeamUser;
let zetaPrime: TeamUser;
let zeta: TeamUser;
let ticket: { id: string; number: number; subject: string; statusToken: string };

test.beforeAll(async () => {
  org = await createOrg("Mention Workspace", [{ role: "owner", name: "Mention Author" }]);
  [author] = org.users;
  mira = await createUser("Mira Member", uniqueEmail("mira"));
  omega = await createUser("Omega Probe", uniqueEmail("omega"));
  zetaPrime = await createUser("Zeta Prime", uniqueEmail("zeta-prime"));
  zeta = await createUser("Zeta", uniqueEmail("zeta"));
  for (const user of [mira, omega, zetaPrime, zeta]) await addMember(org.orgId, user.id, "member");
  const subject = `Mention ticket ${org.orgId.slice(0, 8)}`;
  const created = await createTicket(org.orgId, {
    subject,
    priority: "NORMAL",
    body: "Customer question about the mention ticket.",
    contact: { email: uniqueEmail("mention-customer") },
    direction: "INBOUND",
  });
  ticket = { id: created.id, number: created.number, subject, statusToken: created.statusToken };
});

const MEMBER_IDS = () => [mira.id, omega.id, zetaPrime.id, zeta.id];

/** Opens the ticket and puts the composer in internal-note mode with the member list loaded. */
async function openInternalComposer(page: Page) {
  await gotoWarm(page, `/tickets/${ticket.id}`);
  const note = page.getByPlaceholder("Write an internal note…");
  await expect(async () => {
    await page.getByRole("button", { name: "Internal Note" }).click();
    await expect(note).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await note.click();
  return note;
}

/** Types "@" and `query`, then picks the option whose label is exactly `name`. */
async function pickMember(page: Page, query: string, name: string) {
  await page.keyboard.type(`@${query}`);
  const option = page.getByRole("option").filter({ has: page.getByText(name, { exact: true }) });
  await expect(option).toBeVisible({ timeout: 15_000 });
  await option.click();
}

/** The next POST to the ticket's messages route, and its multipart body as text. */
function nextMessagePost(page: Page): Promise<Request> {
  return page.waitForRequest(
    (req) => req.method() === "POST" && req.url().endsWith(`/api/tickets/${ticket.id}/messages`),
  );
}

/** The value of one multipart field, or null when the field is absent. */
function multipartField(body: string, name: string): string | null {
  const match = new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)\\r\\n`).exec(body);
  return match ? match[1] : null;
}

/** Sends with the visible button and returns the request and the stored message. */
async function send(page: Page, button: "Save Internal Note" | "Send Reply") {
  const requestPromise = nextMessagePost(page);
  const responsePromise = page.waitForResponse(
    (res) =>
      res.request().method() === "POST" && res.url().endsWith(`/api/tickets/${ticket.id}/messages`),
  );
  await page.getByRole("button", { name: button }).click();
  const request = await requestPromise;
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const message = await prisma.message.findFirstOrThrow({
    where: { ticketId: ticket.id, direction: "OUTBOUND" },
    orderBy: { seq: "desc" },
    include: { mentions: true },
  });
  return { body: request.postData() ?? "", message };
}

function mentionNotificationCount(): Promise<number> {
  return prisma.notification.count({
    where: { organizationId: org.orgId, type: "MENTION", recipientUserId: { in: MEMBER_IDS() } },
  });
}

test.describe("AIDA-45: mentions", () => {
  test("a mention in an internal note shows in the thread and in the mentioned member's bell", async ({
    browser,
  }) => {
    const authored = await signedInContext(browser, author.email);
    const page = authored.page;
    const note = await openInternalComposer(page);
    await page.keyboard.type("Please look, ");
    await pickMember(page, "Mi", "Mira Member");
    await expect(note).toHaveValue("Please look, @Mira Member ");
    await page.keyboard.type("thanks");
    const { body, message } = await send(page, "Save Internal Note");
    expect(multipartField(body, "mentions")).toBe(JSON.stringify([mira.id]));
    expect(message.visibility).toBe("INTERNAL");
    expect(message.mentions.map((m) => m.mentionedUserId)).toEqual([mira.id]);
    // The thread renders the stored mention as a span.
    await expect(
      page.locator(".border-l-warning span.text-primary-emphasis", { hasText: "@Mira Member" }),
    ).toBeVisible({ timeout: 20_000 });

    const miraSession = await signedInContext(browser, mira.email);
    await expect(async () => {
      await gotoWarm(miraSession.page, "/tickets");
      await miraSession.page.getByRole("button", { name: /^Notifications/ }).click();
      await expect(
        miraSession.page.getByRole("button", { name: "Notifications, 1 unread", exact: true }),
      ).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 60_000 });
    await expect(
      miraSession.page
        .getByRole("dialog", { name: "Notifications" })
        .getByText(`${author.name} mentioned you on ticket #${ticket.number}`),
    ).toBeVisible();
    const [row] = await notificationsFor(org.orgId, mira.id);
    expect(row).toMatchObject({ type: "MENTION", entityId: ticket.id, actorUserId: author.id });

    await miraSession.context.close();
    await authored.context.close();
  });

  test("R3-2: one Backspace after 'Omega Probe' removes only the space and the note records Omega; two remove the name and the note records nobody", async ({
    browser,
  }) => {
    const authored = await signedInContext(browser, author.email);
    const page = authored.page;
    let note = await openInternalComposer(page);

    // One Backspace: the trailing space goes, the name stays whole and is recorded.
    await page.keyboard.type("Hi ");
    await pickMember(page, "Om", "Omega Probe");
    await expect(note).toHaveValue("Hi @Omega Probe ");
    await page.keyboard.press("Backspace");
    await expect(note).toHaveValue("Hi @Omega Probe");
    const first = await send(page, "Save Internal Note");
    expect(multipartField(first.body, "mentions")).toBe(JSON.stringify([omega.id]));
    expect(first.message.bodyMarkdown).toBe("Hi @Omega Probe");
    expect(first.message.mentions.map((m) => m.mentionedUserId)).toEqual([omega.id]);

    // Two Backspaces: the second removes the whole name; the note records nobody.
    note = await openInternalComposer(page);
    await expect(note).toHaveValue("");
    await page.keyboard.type("Hi ");
    await pickMember(page, "Om", "Omega Probe");
    await expect(note).toHaveValue("Hi @Omega Probe ");
    await page.keyboard.press("Backspace");
    await expect(note).toHaveValue("Hi @Omega Probe");
    await page.keyboard.press("Backspace");
    await expect(note).toHaveValue("Hi ");
    await page.keyboard.type("x");
    await expect(note).toHaveValue("Hi x");
    const second = await send(page, "Save Internal Note");
    expect(second.body).toContain('name="body"');
    expect(multipartField(second.body, "mentions")).toBeNull();
    expect(second.message.id).not.toBe(first.message.id);
    expect(second.message.bodyMarkdown).toBe("Hi x");
    expect(second.message.mentions).toEqual([]);

    await authored.context.close();
  });

  test("D-21: a direct HTTP public reply carrying mentions is answered 400 and writes nothing", async ({
    browser,
  }) => {
    const authored = await signedInContext(browser, author.email);
    const request = authored.page.request;
    const before = await prisma.message.count({ where: { ticketId: ticket.id } });
    const refused = await request.post(`/api/tickets/${ticket.id}/messages`, {
      multipart: {
        mode: "public",
        body: "Public reply with a smuggled mention",
        mentions: JSON.stringify([mira.id]),
      },
    });
    expect(refused.status()).toBe(400);
    await expect(refused.json()).resolves.toEqual({ error: "mentions_not_allowed" });
    expect(await prisma.message.count({ where: { ticketId: ticket.id } })).toBe(before);
    expect(
      await prisma.message.count({
        where: { ticketId: ticket.id, bodyMarkdown: { contains: "smuggled" } },
      }),
    ).toBe(0);
    // The same internal note with the field is accepted, so the 400 above is the public mode.
    const accepted = await request.post(`/api/tickets/${ticket.id}/messages`, {
      multipart: {
        mode: "internal",
        body: "Internal with a mention",
        mentions: JSON.stringify([mira.id]),
      },
    });
    expect(accepted.status()).toBe(200);
    await authored.context.close();
  });

  let publicMessageId: string;

  test("C7, R2-1: the toggle to public removes every inserted name from the textarea and the stored PUBLIC body; no mention and no notification", async ({
    browser,
  }) => {
    const authored = await signedInContext(browser, author.email);
    const page = authored.page;
    const notificationsBefore = await mentionNotificationCount();
    const note = await openInternalComposer(page);

    // A name followed by a comma, two names that share a prefix, and a partial deletion.
    await page.keyboard.type("Hi ");
    await pickMember(page, "Zeta P", "Zeta Prime");
    await page.keyboard.press("Backspace");
    await page.keyboard.type(", can you check and ");
    await pickMember(page, "Zeta", "Zeta");
    await page.keyboard.type("please. Ping @someone ");
    await pickMember(page, "Om", "Omega Probe");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await expect(note).toHaveValue(
      "Hi @Zeta Prime, can you check and @Zeta please. Ping @someone ",
    );

    // Switch with the toggle.
    await page.getByRole("button", { name: "Public Reply" }).click();
    const reply = page.getByPlaceholder("Write a reply…");
    await expect(reply).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: SWITCH_NOTE })).toBeVisible();
    const text = await reply.inputValue();
    expect(text).toContain("can you check");
    expect(text).toContain("@someone");
    expect(text).not.toContain("Zeta");
    expect(text).not.toContain("Omega");

    const { body, message } = await send(page, "Send Reply");
    expect(multipartField(body, "mode")).toBe("public");
    expect(multipartField(body, "mentions")).toBeNull();
    expect(message.visibility).toBe("PUBLIC");
    expect(message.bodyMarkdown).toContain("can you check");
    expect(message.bodyMarkdown).not.toContain("Zeta");
    expect(message.bodyMarkdown).not.toContain("Omega");
    expect(message.bodyHtml).toContain("can you check");
    expect(message.bodyHtml).not.toContain("text-primary-emphasis");
    expect(message.mentions).toEqual([]);
    expect(await mentionNotificationCount()).toBe(notificationsBefore);
    publicMessageId = message.id;
    await authored.context.close();
  });

  test("V-12: the r key switches a note holding 'Zeta Prime' to public and removes the name", async ({
    browser,
  }) => {
    const authored = await signedInContext(browser, author.email);
    const page = authored.page;
    const note = await openInternalComposer(page);
    await page.keyboard.type("Hello ");
    await pickMember(page, "Zeta P", "Zeta Prime");
    await expect(note).toHaveValue("Hello @Zeta Prime ");
    // Escape keeps focus in the textarea (the composer's own keys win in an editable target), so
    // focus leaves it the way keyboard.spec.ts does, as a click on empty page space would.
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.blur();
    });
    await page.keyboard.press("r");
    const reply = page.getByPlaceholder("Write a reply…");
    await expect(reply).toBeFocused();
    await expect(page.getByRole("status").filter({ hasText: SWITCH_NOTE })).toBeVisible();
    const text = await reply.inputValue();
    expect(text).toContain("Hello");
    expect(text).not.toContain("Zeta");
    expect(text).not.toContain("r");
    await authored.context.close();
  });

  test("the status page shows the public reply and never an internal note, a member name or a mention span", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await gotoWarm(page, `/status/${ticket.statusToken}`);
    await expect(page.getByText(/can you check/).first()).toBeVisible();
    await expect(page.getByText("Customer question about the mention ticket.")).toBeVisible();
    const html = await page.content();
    for (const hidden of [
      "Please look,",
      "Hi @Omega Probe",
      "Internal with a mention",
      "Mira Member",
      "Omega",
      "Zeta",
      mira.email,
      omega.email,
    ]) {
      expect(html, hidden).not.toContain(hidden);
    }
    await expect(page.locator("span.text-primary-emphasis").filter({ hasText: /^@/ })).toHaveCount(
      0,
    );
    await context.close();
  });

  test("the outgoing SMTP message of the public reply carries the text and no member name, mention class or member email", async () => {
    expect(publicMessageId).toBeTruthy();
    const smtp = await startFakeSmtp({ advertiseAuth: false });
    try {
      await writeFakeSmtpSettings(org.orgId, smtp.port);
      const { emailOutboundSendHandler } = await import(
        "../../src/lib/worker/jobs/email-outbound-send"
      );
      await emailOutboundSendHandler({ messageId: publicMessageId });
      expect(smtp.messages).toHaveLength(1);
      const [message] = smtp.messages;
      const mail = await simpleParser(message.raw);
      const text = mail.text ?? "";
      const html = typeof mail.html === "string" ? mail.html : "";
      // Presence first.
      expect(text).toContain("can you check");
      expect(text).toContain("@someone");
      expect(html).toContain("can you check");
      // Absence in every part of what was sent.
      for (const part of [message.raw, text, html]) {
        expect(part).not.toContain("Zeta");
        expect(part).not.toContain("Omega");
        expect(part).not.toContain("text-primary-emphasis");
        for (const user of [mira, omega, zetaPrime, zeta]) expect(part).not.toContain(user.email);
      }
      const stored = await prisma.message.findUniqueOrThrow({ where: { id: publicMessageId } });
      expect(stored.deliveryStatus).toBe("SENT");
    } finally {
      await smtp.stop();
    }
  });
});
