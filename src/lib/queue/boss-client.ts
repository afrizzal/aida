// App-side pg-boss singleton (NEW — no existing precedent before this plan): Phase 1/2's three
// recurring jobs (heartbeat, sla-flag, rate-limit-cleanup) are all scheduled by the WORKER
// process via boss.schedule(). Outbound email send is different: it must be enqueued on demand,
// from the Next.js app, the moment an agent posts a public reply. This file is bundled by
// Next.js webpack (uses `@/`) and is NEVER imported by the worker (which has its own PgBoss
// instance in src/lib/worker/index.ts).
//
// Mirrors src/lib/db.ts's globalThis-caching singleton pattern, but caches a Promise<PgBoss>
// since PgBoss.start() is async.
import { PgBoss } from "pg-boss";
import { ensureKbProposalQueue } from "../kb/proposal-queue";

const globalForBoss = globalThis as unknown as { boss?: Promise<PgBoss> };

async function createBoss(): Promise<PgBoss> {
  const boss = new PgBoss(process.env.DATABASE_URL as string);
  boss.on("error", (err: Error) => console.error("[app] pg-boss error:", err));
  await boss.start();

  // pg-boss v12+: queues must be explicitly created before work()/send(). retryLimit: 2 gives
  // 3 total attempts (1 initial + 2 retries) — D-21's "~3 attempts". These queues set no
  // retryDelay, and pg-boss 12 defaults it to 0 and multiplies it for the backoff, so their
  // retries run at once (about 2 s later, on the next poll) and retryDelayMax has no effect
  // (review a2-WR-03; left as is and recorded as deferred under run decision K55).
  await boss.createQueue("email-outbound-send", {
    retryLimit: 2,
    retryBackoff: true,
    retryDelayMax: 300,
  });

  // AI triage: on-demand, enqueued after createTicket() commits (and by rerunTriage). Same
  // retry shape as email-outbound-send — mirrors src/lib/worker/index.ts's ai-triage createQueue.
  await boss.createQueue("ai-triage", {
    retryLimit: 2,
    retryBackoff: true,
    retryDelayMax: 300,
  });

  // KB article embedding: on-demand, enqueued after createKbArticle()/updateKbArticle() commit
  // (and by a future re-embed-all admin action). Same retry shape as ai-triage/
  // email-outbound-send — mirrors src/lib/worker/index.ts's kb-embed-article createQueue.
  await boss.createQueue("kb-embed-article", {
    retryLimit: 2,
    retryBackoff: true,
    retryDelayMax: 300,
  });

  // AIDA Insight run: on-demand, enqueued by the /insights "Generate insights" Server Action.
  // Same retry shape as the other on-demand queues — mirrors src/lib/worker/index.ts's insight-run createQueue.
  await boss.createQueue("insight-run", {
    retryLimit: 2,
    retryBackoff: true,
    retryDelayMax: 300,
  });

  // KB proposal generation (Phase 12.2, D-13): on-demand, enqueued by requestProposal after its
  // transaction commits (and by Restart generation). Run decision K55: an explicit 30 s
  // retryDelay with backoff, created and updated by the helper the worker calls too.
  await ensureKbProposalQueue(boss);

  return boss;
}

export function getBoss(): Promise<PgBoss> {
  if (!globalForBoss.boss) globalForBoss.boss = createBoss();
  return globalForBoss.boss;
}
