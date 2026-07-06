// Recurring inbound poll (D-01..D-06): fetch UNSEEN per org, ingest-or-fail, mark
// \Seen only after success, skip poisoned messages after a failure threshold, persist
// poll health. Worker-bundleable (esbuild) — every project import below is RELATIVE.
import { simpleParser } from "mailparser";
import { prisma } from "../../db";
import { scopedDb } from "../../scoped-db";
import { createImapClient } from "./imap-client";
import { deriveEmailMessageId, ingestMessage } from "./ingest-message";
import { getEmailSettings, updateEmailHealth } from "./settings";

// Tunable without a migration (03-RESEARCH.md Open Question 2).
const POISON_THRESHOLD = 5;

export async function pollInbox(): Promise<void> {
  // Cross-org enumeration — BARE prisma, never scopedDb (no single org context yet).
  const enabled = await prisma.setting.findMany({
    where: { key: "email:enabled", value: "true" },
    select: { organizationId: true },
  });

  for (const { organizationId } of enabled) {
    const db = scopedDb(organizationId);

    try {
      const settings = await getEmailSettings(db);
      const client = createImapClient(settings);
      await client.connect();
      const lock = await client.getMailboxLock("INBOX");

      try {
        const uids = (await client.search({ seen: false }, { uid: true })) || [];

        for (const uid of uids) {
          const msg = await client.fetchOne(uid, { source: true, uid: true }, { uid: true });
          if (!msg || !msg.source) continue;

          // Derived ONCE, deterministically, per physical email — this same value is
          // used for the dedupe check inside ingestMessage AND the poison-guard lookup
          // here, so a retried ingest of the same email always maps to the same key.
          const parsedForId = await simpleParser(msg.source);
          const emailMessageId = deriveEmailMessageId(msg.source, parsedForId.messageId);

          const fail = await db.emailIngestFailure.findFirst({ where: { emailMessageId } });
          if (fail && fail.failureCount >= POISON_THRESHOLD) {
            await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
            console.error("[poll] poisoned message skipped", { emailMessageId });
            continue;
          }

          try {
            await ingestMessage(organizationId, msg.source, settings.fromAddress, emailMessageId);
            await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
          } catch (err) {
            const lastError = String(err).slice(0, 500);
            const existingFailure = await db.emailIngestFailure.findFirst({
              where: { emailMessageId },
            });
            if (existingFailure) {
              await db.emailIngestFailure.update({
                where: { id: existingFailure.id },
                data: { failureCount: { increment: 1 }, lastError },
              });
            } else {
              await db.emailIngestFailure.create({
                data: { organizationId, emailMessageId, failureCount: 1, lastError },
              });
            }
            // Do NOT mark \Seen — leave unread so the next poll retries, until threshold.
          }
        }
      } finally {
        lock.release();
        await client.logout();
      }

      await updateEmailHealth(db, organizationId, {
        lastPollAt: new Date().toISOString(),
        lastPollError: "",
      });
    } catch (err) {
      // Never log settings.imapPassword or raw email bodies (SECURITY.md).
      await updateEmailHealth(db, organizationId, {
        lastPollError: String(err).slice(0, 500),
      });
    }
  }
}
