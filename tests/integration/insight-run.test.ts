import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

// Mock the LLM completion provider boundary (mirrors triage-injection.test.ts): complete()'s real
// redaction + prompt-fencing dispatch still runs, only the OpenAI SDK call is replaced. Branches
// on schemaName so the same mock serves both the cluster-labeling call and the narrative call.
vi.mock("@/lib/llm/providers/openai", () => ({
  completeOpenAi: vi.fn(async (p: { schemaName: string }) => {
    if (p.schemaName === "ClusterLabelsResult") {
      return {
        clusters: [
          { clusterIndex: 0, label: "Login issues", description: "Users can't log in to their account." },
          { clusterIndex: 1, label: "Billing questions", description: "Users ask about invoice charges." },
        ],
      };
    }
    return { summary: "Ticket volume was steady this period with no notable SLA breaches." };
  }),
}));

import { prisma } from "@/lib/db";
import { runInsight } from "@/lib/insight/run-insight";
import type { SlaCsatSummary, StoredCluster, StoredKbGap, VolumeDrivers } from "@/lib/insight/types";
import { saveLlmSettings } from "@/lib/llm/settings";
import { saveEmbeddingSettings } from "@/lib/rag/settings";
import { toVectorLiteral } from "@/lib/rag/vector-literal";
import { scopedDb } from "@/lib/scoped-db";
import { createTicket } from "@/lib/tickets/create-ticket";

const EMBEDDING_MODEL = "openai:text-embedding-3-small";
const DIMS = 768;
const FAKE_SECRET = "sk-proj-ABCDEFGHIJKLMNOPQRSTUVWX";

/** A base direction per group: group A is the constant-1 vector, group B alternates +1/-1 so
 * the two groups' cosine similarity is ~0 (well below the 0.8 clustering threshold), while tiny
 * deterministic per-member noise keeps members of the same group distinct but still near-identical
 * (cosine similarity ~1) so they join the SAME leader cluster. */
function memberVector(group: "A" | "B", seed: number): number[] {
  return Array.from({ length: DIMS }, (_, i) => {
    const base = group === "A" ? 1 : i % 2 === 0 ? 1 : -1;
    return base + Math.sin(seed + i) * 0.0005;
  });
}

async function insertTicketEmbedding(orgId: string, ticketId: string, vector: number[]): Promise<void> {
  const id = randomBytes(16).toString("hex");
  await prisma.$executeRaw`
    INSERT INTO "TicketEmbedding" ("id", "organizationId", "ticketId", "embeddingModel", "embedding", "createdAt")
    VALUES (${id}, ${orgId}, ${ticketId}, ${EMBEDDING_MODEL}, ${toVectorLiteral(vector)}::vector, now())
  `;
}

const STANDARD_PARAMS = {
  clusterSimilarityThreshold: 0.8,
  minClusterSize: 3,
  gapThreshold: 0.5,
  excerptCharLimit: 500,
  embedBatchSize: 100,
  maxClustersRendered: 20,
};

describe("insight-run orchestrator: end-to-end + reproducibility + AI-off (AIDA-17)", () => {
  it("computes labeled+cited clusters, KB gaps, volume drivers, SLA/CSAT, reproducibly, and degrades cleanly with AI off", async () => {
    const org = await prisma.organization.create({
      data: {
        id: randomUUID(),
        name: "Insight Org",
        slug: `insight-${randomUUID()}`,
        createdAt: new Date(),
      },
    });
    const db = scopedDb(org.id);

    // ---- Seed two groups of 3 tickets, each with a first PUBLIC INBOUND message, and directly
    // seed hand-crafted TicketEmbedding vectors (fully deterministic clustering input). ----
    const groupATicketIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const created = await createTicket(org.id, {
        subject: `Can't log in to my account (${i})`,
        priority: "NORMAL",
        body:
          i === 0
            ? `I can't log in no matter what I try. Here's a secret key: ${FAKE_SECRET}`
            : "I can't log in no matter what I try, please help.",
        contact: { email: `login-user-${i}@example.com`, company: "Acme Co" },
        direction: "INBOUND",
      });
      groupATicketIds.push(created.id);
      await insertTicketEmbedding(org.id, created.id, memberVector("A", i));
    }

    const groupBTicketIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const created = await createTicket(org.id, {
        subject: `Question about my invoice (${i})`,
        priority: "NORMAL",
        body: "I have a question about a charge on my latest invoice.",
        contact: { email: `billing-user-${i}@example.com`, company: "Globex Inc" },
        direction: "INBOUND",
      });
      groupBTicketIds.push(created.id);
      await insertTicketEmbedding(org.id, created.id, memberVector("B", i));
    }

    // ---- CSAT: two responses on in-period tickets, scores 4 and 5 ----
    await prisma.csatResponse.create({
      data: { organizationId: org.id, ticketId: groupATicketIds[0], score: 4 },
    });
    await prisma.csatResponse.create({
      data: { organizationId: org.id, ticketId: groupBTicketIds[0], score: 5 },
    });

    // ---- LLM + embedding settings, AI on. No KbChunk seeded => zero-KB shortcut. ----
    await saveLlmSettings(db, org.id, {
      provider: "openai",
      model: "gpt-5.4-mini",
      apiKey: "sk-test-DUMMYKEY0000000000000000",
    });
    await saveEmbeddingSettings(db, org.id, {
      provider: "openai",
      model: "text-embedding-3-small",
      apiKey: "sk-test-DUMMYEMBEDKEY0000000000",
    });
    await db.setting.create({ data: { organizationId: org.id, key: "aiEnabled", value: "true" } });

    // ---- Period bracketing the seeded tickets ----
    const periodDays = 30;
    const periodEnd = new Date(Date.now() + 60_000);
    const periodStart = new Date(periodEnd.getTime() - periodDays * 24 * 60 * 60 * 1000);

    // ---- Run 1: end-to-end ----
    const run1 = await prisma.insightRun.create({
      data: {
        organizationId: org.id,
        status: "PENDING",
        periodDays,
        periodStart,
        periodEnd,
        params: STANDARD_PARAMS,
      },
    });
    await runInsight(run1.id);
    const updated1 = await prisma.insightRun.findUniqueOrThrow({ where: { id: run1.id } });

    const clusters1 = updated1.clusters as unknown as StoredCluster[] | null;
    if (!clusters1) throw new Error("expected clusters1 to be populated");
    expect(clusters1.length).toBeGreaterThan(0);

    const bigCluster1 = clusters1.find((c) => c.size >= 3);
    expect(bigCluster1).toBeDefined();
    expect(bigCluster1?.citations.length).toBeGreaterThan(0);
    for (const citation of bigCluster1?.citations ?? []) {
      expect(citation).toHaveProperty("ticketId");
      expect(citation).toHaveProperty("number");
      expect(citation).toHaveProperty("subject");
    }
    const labels1 = clusters1.map((c) => c.label);
    expect(labels1).toContain("Login issues");
    expect(labels1).toContain("Billing questions");

    const volumeDrivers1 = updated1.volumeDrivers as unknown as VolumeDrivers | null;
    if (!volumeDrivers1) throw new Error("expected volumeDrivers1 to be populated");
    expect(volumeDrivers1).toHaveProperty("byCategory");
    expect(volumeDrivers1).toHaveProperty("byTag");
    expect(volumeDrivers1).toHaveProperty("byCompany");

    const slaCsat1 = updated1.slaCsat as unknown as SlaCsatSummary | null;
    if (!slaCsat1) throw new Error("expected slaCsat1 to be populated");
    expect(slaCsat1.csat.responseCount).toBe(2);
    expect(slaCsat1.csat.averageScore).toBe(4.5);
    expect(slaCsat1.csat.distribution.length).toBe(5);

    const kbGaps1 = updated1.kbGaps as unknown as StoredKbGap[] | null;
    if (!kbGaps1) throw new Error("expected kbGaps1 to be populated");
    expect(kbGaps1.length).toBeGreaterThan(0);
    for (const gap of kbGaps1) {
      expect(gap.coverage).toBeNull();
    }

    const events = await prisma.auditEvent.findMany({ where: { organizationId: org.id } });
    expect(events.length).toBe(2);
    expect(events.map((e) => e.actionType).sort()).toEqual(["INSIGHT_CLUSTER_LABELS", "INSIGHT_SUMMARY"]);
    for (const e of events) {
      expect(e.input).not.toContain(FAKE_SECRET);
    }
    const labelEvent = events.find((e) => e.actionType === "INSIGHT_CLUSTER_LABELS");
    expect(labelEvent?.input).toContain("[redacted]");

    // ---- Run 2: reproducibility (same tickets, same params/period => identical membership) ----
    const run2 = await prisma.insightRun.create({
      data: {
        organizationId: org.id,
        status: "PENDING",
        periodDays,
        periodStart,
        periodEnd,
        params: STANDARD_PARAMS,
      },
    });
    await runInsight(run2.id);
    const updated2 = await prisma.insightRun.findUniqueOrThrow({ where: { id: run2.id } });
    const clusters2 = updated2.clusters as unknown as StoredCluster[] | null;
    if (!clusters2) throw new Error("expected clusters2 to be populated");

    const membershipOf = (clusters: StoredCluster[]) =>
      clusters
        .map((c) => ({ index: c.index, ticketIds: c.citations.map((t) => t.ticketId).sort() }))
        .sort((a, b) => a.index - b.index);
    expect(membershipOf(clusters2)).toEqual(membershipOf(clusters1));

    // ---- Run 3: AI off (AIDA-13 LOCKED) — SQL sections still populate, AI sections null ----
    const aiSetting = await db.setting.findFirst({ where: { key: "aiEnabled" } });
    if (!aiSetting) throw new Error("expected aiEnabled Setting row to exist");
    await db.setting.update({ where: { id: aiSetting.id }, data: { value: "false" } });

    const run3 = await prisma.insightRun.create({
      data: {
        organizationId: org.id,
        status: "PENDING",
        periodDays,
        periodStart,
        periodEnd,
        params: STANDARD_PARAMS,
      },
    });
    await runInsight(run3.id);
    const updated3 = await prisma.insightRun.findUniqueOrThrow({ where: { id: run3.id } });

    expect(updated3.clusters).toBeNull();
    expect(updated3.kbGaps).toBeNull();
    expect(updated3.narrative).toBeNull();
    expect(updated3.volumeDrivers).not.toBeNull();
    expect(updated3.slaCsat).not.toBeNull();
  });
});
