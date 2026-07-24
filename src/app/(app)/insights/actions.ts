"use server";

// The ONE trigger path for the "Generate insights" action (agents AND admins — no
// requireOrgAdmin gate, unlike Settings mutations). Mirrors rerunTriage/reembedAllKb's
// enqueue-then-revalidate shape (06-RESEARCH.md lines 665-721, adopted verbatim).
import { revalidatePath } from "next/cache";
import { getBoss } from "@/lib/queue/boss-client";
import { getScopedDb } from "@/lib/session";

export async function generateInsightRun(
  periodDays: 7 | 30 | 90,
): Promise<{ ok: boolean; alreadyRunning?: boolean }> {
  const { db, orgId } = await getScopedDb();

  // App-side guard (LOCKED): an existing PENDING/RUNNING run for this periodDays is returned
  // instead of enqueuing a duplicate. findFirst IS auto-scoped by scopedDb.
  const existing = await db.insightRun.findFirst({
    where: { periodDays, status: { in: ["PENDING", "RUNNING"] } },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return { ok: true, alreadyRunning: true };

  const now = new Date();
  const periodStart = new Date(now.getTime() - periodDays * 24 * 60 * 60 * 1000);

  const run = await db.insightRun.create({
    data: {
      // scopedDb auto-injects organizationId at runtime, but Prisma's generated CreateInput
      // still requires it at the type level (mirrors every other db.<model>.create call site
      // in this codebase — e.g. src/lib/rag/settings.ts, tickets/[id]/actions.ts).
      organizationId: orgId,
      status: "PENDING",
      periodDays,
      periodStart,
      periodEnd: now,
      params: {
        clusterSimilarityThreshold: 0.8,
        minClusterSize: 3,
        gapThreshold: 0.5,
        excerptCharLimit: 500,
        embedBatchSize: 100,
        maxClustersRendered: 20,
      },
    },
  });

  try {
    const boss = await getBoss();
    await boss.send("insight-run", { insightRunId: run.id });
  } catch {
    await db.insightRun.update({
      where: { id: run.id },
      data: { status: "FAILED", error: "enqueue failed" },
    });
    return { ok: false };
  }

  revalidatePath("/insights");
  return { ok: true };
}
