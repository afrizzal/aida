// Worker job: runs AI triage on a ticket (auto-enqueued after createTicket() commits, or
// manually re-enqueued via the rerunTriage Server Action). Registered by src/lib/worker/index.ts
// (this plan's job — mirrors email-outbound-send's split between handler file and registration).
//
// Worker-bundleable (esbuild) — every import below is relative to src/lib/worker/jobs/, exactly
// like heartbeat.ts's `import { prisma } from "../../db"`.
import { prisma } from "../../db";
import { scopedDb } from "../../scoped-db";
import { runTriage } from "../../triage/run-triage";

export async function aiTriageHandler(data: { ticketId: string }): Promise<void> {
  // D-20 kill switch: never call the LLM if AI was turned off after this job was enqueued.
  // Defense in depth alongside the enqueue-time check in create-ticket.ts/actions.ts.
  const ticket = await prisma.ticket.findUnique({
    where: { id: data.ticketId },
    select: { organizationId: true },
  });
  if (!ticket) return;

  const db = scopedDb(ticket.organizationId);
  const aiSetting = await db.setting.findFirst({ where: { key: "aiEnabled" } });
  if (aiSetting?.value !== "true") return; // AI off -> no-op (never blocks the inbox)

  await runTriage(data.ticketId); // sets FAILED + rethrows on error -> pg-boss retries
}
