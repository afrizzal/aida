import type { Job } from "pg-boss";
import { PgBoss } from "pg-boss";
import { aiTriageHandler } from "./jobs/ai-triage";
import { emailInboundPollHandler } from "./jobs/email-inbound-poll";
import { emailOutboundSendHandler } from "./jobs/email-outbound-send";
import { heartbeatHandler } from "./jobs/heartbeat";
import { insightRunHandler } from "./jobs/insight-run";
import { kbEmbedArticleHandler } from "./jobs/kb-embed-article";
import { rateLimitCleanupHandler } from "./jobs/rate-limit-cleanup";
import { slaFlagHandler } from "./jobs/sla-flag";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required for the worker");

  const boss = new PgBoss(connectionString);
  boss.on("error", (err: Error) => console.error("[worker] pg-boss error:", err));
  await boss.start();

  // pg-boss v12+: queues must be explicitly created before work() or schedule().
  // createQueue() is idempotent (safe to call on every restart).
  await boss.createQueue("heartbeat");

  // v10+ pattern: work handler receives an array — destructure the first element
  await boss.work("heartbeat", async ([job]: Job[]) => {
    await heartbeatHandler(job.data);
  });

  // idempotent upsert via schedule(); runs every minute
  await boss.schedule("heartbeat", "* * * * *", {});

  await boss.createQueue("sla-flag");
  await boss.work("sla-flag", async ([job]: Job[]) => {
    await slaFlagHandler(job.data);
  });
  await boss.schedule("sla-flag", "*/5 * * * *", {});

  await boss.createQueue("rate-limit-cleanup");
  await boss.work("rate-limit-cleanup", async (_jobs: Job[]) => {
    await rateLimitCleanupHandler();
  });
  await boss.schedule("rate-limit-cleanup", "0 3 * * *", {}); // daily 03:00

  // Inbound poll: singleton policy so a slow/overrunning IMAP session never overlaps
  // the next minute's scheduled run (unlike the idempotent set-based SQL jobs above).
  await boss.createQueue("email-inbound-poll", { policy: "singleton" });
  await boss.work("email-inbound-poll", async ([job]: Job[]) => {
    await emailInboundPollHandler(job.data);
  });
  await boss.schedule("email-inbound-poll", "* * * * *", {});

  // Outbound send: on-demand queue enqueued by the app (messages Route Handler via
  // src/lib/queue/boss-client.ts) — no schedule(). Options mirror boss-client.ts's
  // createQueue call exactly so this createQueue is a no-op if the app made it first.
  await boss.createQueue("email-outbound-send", {
    retryLimit: 2,
    retryBackoff: true,
    retryDelayMax: 300,
  });
  await boss.work("email-outbound-send", async ([job]: Job<{ messageId: string }>[]) => {
    await emailOutboundSendHandler(job.data);
  });

  // AI triage: on-demand queue enqueued by the app after createTicket() commits (and by the
  // rerunTriage Server Action) — no schedule(). Options mirror boss-client.ts's createQueue
  // call exactly so this createQueue is a no-op if the app made it first.
  await boss.createQueue("ai-triage", {
    retryLimit: 2,
    retryBackoff: true,
    retryDelayMax: 300,
  });
  await boss.work("ai-triage", async ([job]: Job<{ ticketId: string }>[]) => {
    await aiTriageHandler(job.data);
  });

  // KB article embedding: on-demand queue enqueued by the app after createKbArticle()/
  // updateKbArticle() commit (and by a future re-embed-all admin action) — no schedule().
  // Options mirror boss-client.ts's createQueue call exactly so this createQueue is a no-op if
  // the app made it first.
  await boss.createQueue("kb-embed-article", {
    retryLimit: 2,
    retryBackoff: true,
    retryDelayMax: 300,
  });
  await boss.work("kb-embed-article", async ([job]: Job<{ articleId: string }>[]) => {
    await kbEmbedArticleHandler(job.data);
  });

  // AIDA Insight run: on-demand queue enqueued by the app's /insights Server Action — no schedule().
  // Options mirror boss-client.ts's createQueue exactly so this createQueue is a no-op if the app made it first.
  await boss.createQueue("insight-run", {
    retryLimit: 2,
    retryBackoff: true,
    retryDelayMax: 300,
  });
  await boss.work("insight-run", async ([job]: Job<{ insightRunId: string }>[]) => {
    await insightRunHandler(job.data);
  });

  console.log("[worker] started");

  const shutdown = async () => {
    await boss.stop();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err: unknown) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
