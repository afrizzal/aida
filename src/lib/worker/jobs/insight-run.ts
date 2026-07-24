// Worker job: runs one InsightRun's compute (auto-enqueued by the /insights "Generate insights"
// Server Action, via src/lib/queue/boss-client.ts). Registered by src/lib/worker/index.ts (mirrors
// kb-embed-article.ts's split between handler file and registration).
//
// Worker-bundleable (esbuild) — every import below is relative to src/lib/worker/jobs/, exactly
// like kb-embed-article.ts's `import { prisma } from "../../db"`.
import { prisma } from "../../db";
import { runInsight } from "../../insight/run-insight";

export async function insightRunHandler(data: { insightRunId: string }): Promise<void> {
  const run = await prisma.insightRun.findUnique({ where: { id: data.insightRunId } });
  if (!run) return;

  await prisma.insightRun.update({ where: { id: run.id }, data: { status: "RUNNING" } });

  try {
    await runInsight(run.id);
    await prisma.insightRun.update({
      where: { id: run.id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
  } catch (err) {
    await prisma.insightRun.update({
      where: { id: run.id },
      data: { status: "FAILED", error: String(err) },
    });
    throw err; // pg-boss retries — mirrors kb-embed-article/ai-triage/email-outbound-send
  }
}
