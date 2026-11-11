// K169 (review c-WR-04, AIDA-46 "a pg-boss job batches unread notifications"): the digest runs
// through pg-boss end to end. A real PgBoss is started, the queue, the worker and the schedule are
// registered by the same function the worker calls (registerNotificationDigest), one job is sent
// (not the cron), and the handler's digest arrives at the loopback fake SMTP; the job ends
// `completed`. pg-boss keeps its own tables in a database of its own on the same server, so the
// shared test database gains no `pgboss` schema; the handler works on the shared database through
// the app's client, as in production.
//
// Overlap by design: the queue is singleton with retryLimit 0 and an expiry of the digest interval
// (at most 23 h), and the handler passes the job's AbortSignal to runDigests, which stops before
// its next claim once pg-boss aborts it (expiry or shutdown). So an expired run is never retried
// and stops after the pair in flight, which the per-pair lock and lease keep apart from the next
// run.
import { randomBytes, randomUUID } from "node:crypto";
import { simpleParser } from "mailparser";
import pg from "pg";
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { saveEmailSettings } from "@/lib/channels/email/settings";
import { prisma } from "@/lib/db";
import { DIGEST_EMAIL_SUBJECT, runDigests } from "@/lib/notifications/digest";
import { NOTIFICATION_DIGEST_QUEUE } from "@/lib/notifications/digest-config";
import { insertNotifications } from "@/lib/notifications/store";
import { TICKET_ENTITY } from "@/lib/notifications/types";
import { scopedDb } from "@/lib/scoped-db";
import {
  digestQueueOptions,
  notificationDigestHandler,
  registerNotificationDigest,
} from "@/lib/worker/jobs/notification-digest";
import { type FakeSmtpServer, startFakeSmtp } from "../support/fake-smtp";
import { seedOrgWithMembers, seedTicket } from "../support/inbox-fixtures";

const BASE_URL = "http://digest-job.example.test:3100";
let savedAuthUrl: string | undefined;
let smtp: FakeSmtpServer;
let bossDbName = "";
let bossUrl = "";
const createdOrgs: string[] = [];

function adminUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (global setup did not run)");
  return url;
}

async function admin<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: adminUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

beforeAll(async () => {
  savedAuthUrl = process.env.BETTER_AUTH_URL;
  process.env.BETTER_AUTH_URL = BASE_URL;
  smtp = await startFakeSmtp();
  bossDbName = `aida_k169_${randomBytes(6).toString("hex")}`;
  await admin((c) => c.query(`CREATE DATABASE ${bossDbName}`));
  const parsed = new URL(adminUrl());
  parsed.pathname = `/${bossDbName}`;
  bossUrl = parsed.toString();
});

afterAll(async () => {
  for (const orgId of createdOrgs.splice(0)) {
    await saveEmailSettings(scopedDb(orgId), orgId, { enabled: false });
    await prisma.notification.updateMany({
      where: { organizationId: orgId, archivedAt: null },
      data: { archivedAt: new Date() },
    });
  }
  await smtp.stop();
  if (bossDbName) await admin((c) => c.query(`DROP DATABASE IF EXISTS ${bossDbName} WITH (FORCE)`));
  if (savedAuthUrl === undefined) delete process.env.BETTER_AUTH_URL;
  else process.env.BETTER_AUTH_URL = savedAuthUrl;
});

/** One owner with a known address, one ticket, one ASSIGNED notification; email at the fake. */
async function ownerWithOneRow() {
  const { orgId, users } = await seedOrgWithMembers(prisma, ["owner"]);
  createdOrgs.push(orgId);
  const owner = users[0];
  if (!owner) throw new Error("no owner");
  const address = `digest-job-${randomUUID()}@example.test`;
  await prisma.user.update({ where: { id: owner.id }, data: { email: address } });
  await saveEmailSettings(scopedDb(orgId), orgId, {
    enabled: true,
    fromAddress: "support@example.test",
    smtpHost: "127.0.0.1",
    smtpPort: smtp.port,
    smtpSecure: false,
    smtpUser: "fake-user",
    smtpPassword: "fake-password",
  });
  const ticket = await seedTicket(orgId);
  const eventKey = `k169:${randomUUID()}`;
  await insertNotifications(prisma, orgId, [
    {
      recipientUserId: owner.id,
      type: "ASSIGNED",
      eventKey,
      entityType: TICKET_ENTITY,
      entityId: ticket.id,
    },
  ]);
  return { orgId, ownerId: owner.id, address, ticket };
}

async function waitForState(boss: PgBoss, id: string, timeoutMs = 45_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = await boss.getJobById(NOTIFICATION_DIGEST_QUEUE, id);
    const state = job?.state ?? "missing";
    if (state === "completed" || state === "failed" || state === "cancelled") return state;
    if (Date.now() > deadline) return state;
    await new Promise((r) => setTimeout(r, 250));
  }
}

describe("the digest as a pg-boss job (K169, AIDA-46)", () => {
  it("queue options: singleton, no retry, an expiry of the interval below pg-boss's 24 h limit", () => {
    expect(digestQueueOptions({})).toEqual({
      policy: "singleton",
      retryLimit: 0,
      expireInSeconds: 4 * 3600,
    });
    expect(digestQueueOptions({ AIDA_DIGEST_INTERVAL_HOURS: "1" }).expireInSeconds).toBe(3600);
    expect(digestQueueOptions({ AIDA_DIGEST_INTERVAL_HOURS: "24" }).expireInSeconds).toBe(
      23 * 3600,
    );
  });

  it("registered like the worker does, one sent job runs the handler: one digest at the fake SMTP, the job ends completed, the queue and the schedule carry the options", async () => {
    const { orgId, ownerId, address, ticket } = await ownerWithOneRow();
    const boss = new PgBoss(bossUrl);
    const errors: unknown[] = [];
    boss.on("error", (err) => errors.push(err));
    await boss.start();
    try {
      // An install whose queue predates K169 had only policy singleton: the update corrects it.
      await boss.createQueue(NOTIFICATION_DIGEST_QUEUE, { policy: "singleton" });
      await registerNotificationDigest(boss, {});

      const queue = await boss.getQueue(NOTIFICATION_DIGEST_QUEUE);
      expect(queue).toMatchObject({
        policy: "singleton",
        retryLimit: 0,
        expireInSeconds: 4 * 3600,
      });
      const schedules = await boss.getSchedules(NOTIFICATION_DIGEST_QUEUE);
      expect(schedules.map((s) => s.cron)).toEqual(["0 */4 * * *"]);

      const id = await boss.send(NOTIFICATION_DIGEST_QUEUE, {});
      if (!id) throw new Error("pg-boss did not create the job");
      expect(await waitForState(boss, id)).toBe("completed");

      const delivered = smtp.messages.filter((m) => m.recipients.includes(address));
      expect(delivered).toHaveLength(1);
      const mail = await simpleParser(delivered[0]?.raw ?? "");
      expect(mail.subject).toBe(DIGEST_EMAIL_SUBJECT);
      expect(mail.text ?? "").toContain(`${BASE_URL}/tickets/${ticket.id}`);
      const digests = await prisma.notificationDigest.findMany({
        where: { organizationId: orgId, recipientUserId: ownerId },
      });
      expect(digests.map((d) => d.status)).toEqual(["SENT"]);
      const job = await boss.getJobById(NOTIFICATION_DIGEST_QUEUE, id);
      expect(job).toMatchObject({ retryLimit: 0, expireInSeconds: 4 * 3600 });
      // The handler's result (ids) is not stored as the job's output.
      expect(job?.output ?? null).toBeNull();
      expect(errors).toEqual([]);
    } finally {
      await boss.unschedule(NOTIFICATION_DIGEST_QUEUE);
      await boss.stop({ graceful: true, timeout: 10_000 });
    }
  });

  it("an aborted job signal (expiry or shutdown) stops the run before its next claim: nothing is claimed or sent", async () => {
    const { orgId, ownerId, address } = await ownerWithOneRow();
    smtp.reset();
    const aborted = new AbortController();
    aborted.abort();
    const result = await notificationDigestHandler([{ signal: aborted.signal }]);
    expect(result.stopped).toBe(true);
    expect(result.reports).toEqual([]);
    expect(
      await prisma.notificationDigest.count({
        where: { organizationId: orgId, recipientUserId: ownerId },
      }),
    ).toBe(0);
    expect(smtp.messages.filter((m) => m.recipients.includes(address))).toHaveLength(0);

    // Presence: the same pair with a live signal is sent.
    const live = await notificationDigestHandler([{ signal: new AbortController().signal }]);
    expect(live.stopped).toBe(false);
    expect(live.reports.find((r) => r.organizationId === orgId)?.outcome).toBe("sent");
    expect(smtp.messages.filter((m) => m.recipients.includes(address))).toHaveLength(1);
  });

  it("a signal aborted during a pair: that pair finishes (sent), the next pair is not claimed", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["owner", "admin"]);
    createdOrgs.push(orgId);
    const ids = users.map((u) => u.id).sort();
    const addresses = new Map<string, string>();
    for (const id of ids) {
      const address = `digest-job-${randomUUID()}@example.test`;
      addresses.set(id, address);
      await prisma.user.update({ where: { id }, data: { email: address } });
    }
    await saveEmailSettings(scopedDb(orgId), orgId, {
      enabled: true,
      fromAddress: "support@example.test",
      smtpHost: "127.0.0.1",
      smtpPort: smtp.port,
      smtpSecure: false,
      smtpUser: "fake-user",
      smtpPassword: "fake-password",
    });
    const ticket = await seedTicket(orgId);
    for (const id of ids) {
      await insertNotifications(prisma, orgId, [
        {
          recipientUserId: id,
          type: "ASSIGNED",
          eventKey: `k169:${randomUUID()}`,
          entityType: TICKET_ENTITY,
          entityId: ticket.id,
        },
      ]);
    }
    smtp.reset();
    const controller = new AbortController();
    const result = await runDigests({
      signal: controller.signal,
      hooks: {
        beforeSend: (ctx) => {
          if (ctx.organizationId === orgId && ctx.recipientUserId === ids[0]) controller.abort();
        },
      },
    });
    expect(result.stopped).toBe(true);
    const ours = result.reports.filter((r) => r.organizationId === orgId);
    expect(ours.map((r) => [r.recipientUserId, r.outcome])).toEqual([[ids[0], "sent"]]);
    expect(
      smtp.messages.filter((m) => m.recipients.includes(addresses.get(ids[0] ?? "") ?? "")),
    ).toHaveLength(1);
    expect(
      await prisma.notificationDigest.count({
        where: { organizationId: orgId, recipientUserId: ids[1] },
      }),
    ).toBe(0);
  });
});
