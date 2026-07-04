import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { createTicket, orgId, prisma } from "./support/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_ATTACHMENT = path.resolve(__dirname, "fixtures/sample.png");

test.use({ storageState: path.resolve(__dirname, ".auth/admin.json") });

test("authenticated download works; public route only ever serves public-message attachments", async ({
  page,
  context,
  request,
}) => {
  // Two sequential message submissions + an explicit networkidle settle between them push
  // this past the default 30s test timeout, independent of the per-assertion timeouts below.
  test.setTimeout(60_000);
  const ts = Date.now();
  const ticket = await createTicket(orgId, {
    subject: `E2E Attachments ${ts}`,
    priority: "NORMAL",
    body: "Initial message, no attachment.",
    contact: { email: `attachments-${ts}@example.com` },
    direction: "INBOUND",
  });

  await page.goto(`/tickets/${ticket.id}`);
  const messagesPostUrl = `/api/tickets/${ticket.id}/messages`;

  await page.getByRole("button", { name: "Public Reply" }).click();
  await page.getByPlaceholder("Write a reply…").fill("Public reply with an attachment.");
  await page.locator('input[type="file"]').setInputFiles(SAMPLE_ATTACHMENT);
  // Sync on the actual server round-trip rather than a text/filename visibility check —
  // both the sent thread AND the not-yet-sent composer draft render "sample.png" text (the
  // draft shows it as a removable staged-file chip), so a plain getByText can pass against
  // the draft while the real POST is still in flight, racing ahead of the DB write.
  const [publicPostRes] = await Promise.all([
    page.waitForResponse((res) => res.url().includes(messagesPostUrl) && res.request().method() === "POST"),
    page.getByRole("button", { name: "Send Reply" }).click(),
  ]);
  expect(publicPostRes.status()).toBe(200);
  await expect(page.getByRole("link", { name: /sample\.png/ })).toBeVisible();

  // Posting a second message back-to-back on the same live page (no reload) reproducibly
  // dropped the second submit client-side — no second request ever reached the server, even
  // after the first one's content was visible and networkidle settled. Root cause wasn't
  // conclusively isolated (see final report); reloading for a clean Composer mount sidesteps
  // it, since this scenario only requires a public+an internal attachment to exist, not that
  // they're posted from the same live render.
  await page.reload();

  await page.getByRole("button", { name: "Internal Note" }).click();
  await page
    .getByPlaceholder("Write an internal note…")
    .fill("Internal note with an attachment.");
  await page.locator('input[type="file"]').setInputFiles(SAMPLE_ATTACHMENT);
  const [internalPostRes] = await Promise.all([
    page.waitForResponse((res) => res.url().includes(messagesPostUrl) && res.request().method() === "POST"),
    page.getByRole("button", { name: "Save Internal Note" }).click(),
  ]);
  expect(internalPostRes.status()).toBe(200);

  const messages = await prisma.message.findMany({
    where: { ticketId: ticket.id },
    include: { attachments: true },
    orderBy: { createdAt: "asc" },
  });
  const publicAttachment = messages.find(
    (m) => m.visibility === "PUBLIC" && m.attachments.length > 0,
  )?.attachments[0];
  const internalAttachment = messages.find(
    (m) => m.visibility === "INTERNAL" && m.attachments.length > 0,
  )?.attachments[0];
  if (!publicAttachment || !internalAttachment) {
    throw new Error("Expected both a public and an internal attachment to have been created");
  }

  const authedRes = await page.request.get(`/api/attachments/${publicAttachment.id}`);
  expect(authedRes.status()).toBe(200);

  const anonContext = await context.browser()!.newContext();
  const anonRes = await anonContext.request.get(`/api/attachments/${publicAttachment.id}`);
  expect(anonRes.status()).toBe(401);
  await anonContext.close();

  const publicTokenRes = await request.get(
    `/api/public/status/${ticket.statusToken}/attachments/${publicAttachment.id}`,
  );
  expect(publicTokenRes.status()).toBe(200);

  const internalViaPublicRes = await request.get(
    `/api/public/status/${ticket.statusToken}/attachments/${internalAttachment.id}`,
  );
  expect(internalViaPublicRes.status()).toBe(404);
});
