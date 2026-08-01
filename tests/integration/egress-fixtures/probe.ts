// Runs INSIDE the `runner` service of docker-compose.egress-test.yml, attached ONLY to the
// `internal: true` egress-isolation network (no route to the public internet — see that file's
// header comment). Exercises the five AI/email flows named in 07-09.1 Task 1 by calling the SAME
// library functions the app's Server Actions / worker jobs call, directly — exactly the technique
// tests/integration/*.test.ts already uses (these lib functions take `orgId` as a plain
// parameter; they never depend on Next.js request context via next/headers, so they run fine
// from a bare script). This is the one honestly-documented simplification versus driving through
// the real browser/HTTP surface: "Test Connection" and "generate draft" are invoked as direct
// function calls in THIS container rather than via the app's Server Action wrapper — the
// underlying network call to stub-llm is identical either way, and this container is exactly as
// cut off from the internet as the `app` container is (same network, same lack of a route).
//
// Writes ONE line to stdout prefixed `PROBE_RESULT:` with a JSON summary the host-side vitest
// test parses; exits 0 iff every flow succeeded.
import { randomUUID } from "node:crypto";
import { PgBoss } from "pg-boss";
import { getEmailSettings, saveEmailSettings } from "@/lib/channels/email/settings";
import { prisma } from "@/lib/db";
import { createKbArticle } from "@/lib/kb/create-article";
import { saveLlmSettings } from "@/lib/llm/settings";
import { testProviderConnection } from "@/lib/llm/test-connection";
import { generateDraftReply } from "@/lib/rag/generate-draft";
import { saveEmbeddingSettings } from "@/lib/rag/settings";
import { scopedDb } from "@/lib/scoped-db";
import { createTicket } from "@/lib/tickets/create-ticket";

const STUB_LLM_URL = process.env.STUB_LLM_URL ?? "http://stub-llm:11434";
const SMTP_HOST = process.env.STUB_SMTP_HOST ?? "stub-smtp";
const SMTP_PORT = Number(process.env.STUB_SMTP_PORT ?? "3025");

interface FlowResult {
  name: string;
  ok: boolean;
  detail?: string;
}
const results: FlowResult[] = [];

async function run<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    const value = await fn();
    results.push({ name, ok: true });
    return value;
  } catch (err) {
    results.push({ name, ok: false, detail: err instanceof Error ? err.message : String(err) });
    return undefined;
  }
}

async function poll<T>(
  label: string,
  fn: () => Promise<T | null | undefined>,
  timeoutMs = 30_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = await fn();
    if (v) return v;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function main() {
  const org = await prisma.organization.upsert({
    where: { slug: "egress-probe" },
    create: { id: randomUUID(), name: "Egress Probe", slug: "egress-probe", createdAt: new Date() },
    update: {},
  });
  const orgId = org.id;
  const db = scopedDb(orgId);

  await saveLlmSettings(db, orgId, {
    provider: "ollama",
    model: "llama3.1",
    ollamaBaseUrl: STUB_LLM_URL,
  });
  await saveEmbeddingSettings(db, orgId, {
    provider: "ollama",
    model: "nomic-embed-text",
    ollamaBaseUrl: STUB_LLM_URL,
  });
  await saveEmailSettings(db, orgId, {
    enabled: true,
    fromAddress: "support@egress-test.local",
    smtpHost: SMTP_HOST,
    smtpPort: SMTP_PORT,
    smtpSecure: false,
    smtpUser: "probe",
    smtpPassword: "probe",
  });
  const existingAi = await db.setting.findFirst({ where: { key: "aiEnabled" } });
  if (!existingAi) {
    await db.setting.create({ data: { organizationId: orgId, key: "aiEnabled", value: "true" } });
  }

  const boss = new PgBoss(process.env.DATABASE_URL as string);
  boss.on("error", (err: Error) => console.error("[probe] pg-boss error:", err));
  await boss.start();
  await boss.createQueue("insight-run", { retryLimit: 2, retryBackoff: true, retryDelayMax: 300 });
  await boss.createQueue("email-outbound-send", {
    retryLimit: 2,
    retryBackoff: true,
    retryDelayMax: 300,
  });

  // --- FLOW 1: provider Test Connection ---
  await run("provider-test-connection", () =>
    testProviderConnection({
      provider: "ollama",
      model: "llama3.1",
      apiKey: "",
      ollamaBaseUrl: STUB_LLM_URL,
    }),
  );

  // --- FLOW 2: create a ticket, let auto-triage complete ---
  const ticket = await run("create-ticket", () =>
    createTicket(orgId, {
      subject: "Egress isolation probe ticket",
      priority: "NORMAL",
      body: "Does this flow work without a route to the public internet?",
      contact: { email: "egress-probe@example.com" },
      direction: "INBOUND",
    }),
  );
  if (ticket) {
    await run("auto-triage-completes", () =>
      poll("Ticket.triageStatus COMPLETED", async () => {
        const t = await prisma.ticket.findUnique({ where: { id: ticket.id } });
        if (t?.triageStatus === "FAILED") throw new Error("triage FAILED");
        return t?.triageStatus === "COMPLETED" ? t : null;
      }),
    );
  }

  // --- FLOW 3: embed a KB article, generate a draft ---
  const article = await run("create-kb-article", () =>
    createKbArticle(orgId, {
      title: "Egress probe article",
      bodyMarkdown:
        "# Egress probe article\n\nThis knowledge-base content proves retrieval works with no route to the public internet.",
    }),
  );
  if (article) {
    await run("kb-article-embeds", () =>
      poll("KbArticle.embeddingStatus COMPLETED", async () => {
        const a = await prisma.kbArticle.findUnique({ where: { id: article.id } });
        if (a?.embeddingStatus === "FAILED") throw new Error("embedding FAILED");
        return a?.embeddingStatus === "COMPLETED" ? a : null;
      }),
    );
  }
  if (ticket && article) {
    await run("generate-draft", async () => {
      const draft = await generateDraftReply(orgId, ticket.id);
      if (!draft.draftMarkdown) throw new Error("empty draft returned");
      return draft;
    });
  }

  // --- FLOW 4: run an Insight run (worker-processed) ---
  const insightRun = await run("create-insight-run", () =>
    prisma.insightRun.create({
      data: {
        organizationId: orgId,
        status: "PENDING",
        periodDays: 7,
        periodStart: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        periodEnd: new Date(),
        params: {
          clusterSimilarityThreshold: 0.8,
          minClusterSize: 3,
          gapThreshold: 0.5,
          excerptCharLimit: 500,
          embedBatchSize: 100,
          maxClustersRendered: 20,
        },
      },
    }),
  );

  if (insightRun) {
    await boss.send("insight-run", { insightRunId: insightRun.id });
    await run("insight-run-completes", () =>
      poll(
        "InsightRun.status COMPLETED",
        async () => {
          const r = await prisma.insightRun.findUnique({ where: { id: insightRun.id } });
          if (r?.status === "FAILED") throw new Error(`insight run FAILED: ${r.error}`);
          return r?.status === "COMPLETED" ? r : null;
        },
        60_000,
      ),
    );
  }

  // --- FLOW 5: send an outbound email (worker-processed, via stub SMTP) ---
  if (ticket) {
    const emailSettings = await getEmailSettings(db);
    const outboundMessage = await run("create-outbound-message", () =>
      prisma.message.create({
        data: {
          organizationId: orgId,
          ticketId: ticket.id,
          direction: "OUTBOUND",
          visibility: "PUBLIC",
          bodyMarkdown: "Thanks for your patience — this is a probe reply.",
          bodyHtml: "<p>Thanks for your patience — this is a probe reply.</p>",
          deliveryStatus: emailSettings.enabled ? "QUEUED" : undefined,
        },
      }),
    );
    if (outboundMessage) {
      await boss.send("email-outbound-send", { messageId: outboundMessage.id });
      await run("outbound-email-sent", () =>
        poll(
          "Message.deliveryStatus SENT",
          async () => {
            const m = await prisma.message.findUnique({ where: { id: outboundMessage.id } });
            if (m?.deliveryStatus === "FAILED") throw new Error("email send FAILED");
            return m?.deliveryStatus === "SENT" ? m : null;
          },
          30_000,
        ),
      );
    }
  }

  await boss.stop({ graceful: false, timeout: 1000 }).catch(() => {});

  const allOk = results.every((r) => r.ok);
  console.log(`PROBE_RESULT:${JSON.stringify({ orgId, results })}`);
  process.exit(allOk ? 0 : 1);
}

main().catch((err: unknown) => {
  console.log(
    `PROBE_RESULT:${JSON.stringify({ results, fatal: err instanceof Error ? err.message : String(err) })}`,
  );
  process.exit(1);
});
