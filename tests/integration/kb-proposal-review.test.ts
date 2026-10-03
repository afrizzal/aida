// Phase 12.2, plan 12.2-05: the KB proposal review service (AIDA-18, D-01, D-06, D-11, D-13,
// D-15, D-16; reviews C1, C2, C5, C7, R2-2, R2-3, R3-2 and P8; run decisions K50 and K51), on a
// real Postgres through Testcontainers. Real organizations, members, tickets and proposals; only
// the app-side pg-boss client is replaced by a recording double (no job is really queued) and the
// embedding adapter is mocked (deterministic vectors, never a real provider). No LLM is called.
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The recording double. `observe` reads through a separate client inside send, so a send issued
// before the transaction committed would not see the article or the new proposal row.
const bossEnv = vi.hoisted(() => ({
  sends: [] as { queue: string; payload: unknown; seen: unknown }[],
  failSend: false,
  observe: null as null | ((queue: string, payload: unknown) => Promise<unknown>),
}));

vi.mock("@/lib/queue/boss-client", () => ({
  getBoss: async () => ({
    send: async (queue: string, payload: unknown) => {
      const seen = bossEnv.observe ? await bossEnv.observe(queue, payload) : null;
      bossEnv.sends.push({ queue, payload, seen });
      if (bossEnv.failSend) throw new Error("boss send failed (test double)");
      return "job-id";
    },
  }),
}));

import { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { publishProposal } from "@/lib/kb/proposal-review";
import {
  containsSourceMarker,
  containsTicketLink,
  isTicketPageUrl,
  renderedBodyLinksToTicket,
} from "@/lib/kb/proposal-schema";
import { renderMarkdown } from "@/lib/markdown/render";
import {
  seedOrgWithMembers,
  seedProposal,
  seedResolvedTicket,
} from "../support/kb-proposal-fixtures";

let observerPool: pg.Pool;
let observer: PrismaClient;

beforeAll(() => {
  observerPool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  observer = new PrismaClient({ adapter: new PrismaPg(observerPool) });
  bossEnv.observe = async (queue, payload) => {
    if (queue === "kb-embed-article") {
      const articleId = (payload as { articleId?: unknown }).articleId;
      if (typeof articleId !== "string") return null;
      const row = await observer.kbArticle.findUnique({
        where: { id: articleId },
        select: { embeddingStatus: true },
      });
      return row?.embeddingStatus ?? null;
    }
    const proposalId = (payload as { proposalId?: unknown }).proposalId;
    if (typeof proposalId !== "string") return null;
    const row = await observer.kbProposal.findUnique({
      where: { id: proposalId },
      select: { generationEpoch: true },
    });
    return row?.generationEpoch ?? null;
  };
});

afterAll(async () => {
  bossEnv.observe = null;
  await observer.$disconnect();
  await observerPool.end();
});

beforeEach(() => {
  bossEnv.sends = [];
  bossEnv.failSend = false;
});

/** Sends recorded on one queue (ticket creation may enqueue other jobs). */
function sendsOn(queue: string) {
  return bossEnv.sends.filter((s) => s.queue === queue);
}

/** An organization with an owner, an admin and a plain member. */
async function seedOrg() {
  const { orgId, users } = await seedOrgWithMembers(prisma, ["owner", "admin", "member"]);
  return {
    orgId,
    owner: { userId: users[0].id, orgId },
    admin: { userId: users[1].id, orgId },
    member: { userId: users[2].id, orgId },
    users,
  };
}

/** Every href and src value of an HTML string. */
function urlAttributes(html: string): string[] {
  return [...html.matchAll(/\b(?:href|src)="([^"]*)"/g)].map((m) => m[1]);
}

describe("publishProposal: tracer (D-06, D-15, review C1, K51)", () => {
  it("an owner publishes a draft: exactly one article, linked back, embedding enqueued after commit", async () => {
    const { orgId, owner } = await seedOrg();
    const ticket = await seedResolvedTicket(orgId);
    const title = "Reset a forgotten password";
    const bodyMarkdown =
      "## Steps\n\nOpen **Settings** and choose Reset. See [the guide](https://docs.example.com/guide).\n\n![diagram](/images/reset.png)";
    const citedLabel = `CITED-LABEL-${orgId.slice(0, 8)}`;
    const proposal = await seedProposal(orgId, {
      status: "DRAFT",
      ticketIds: [ticket.id],
      title,
      bodyMarkdown,
      version: 2,
      citedSections: [[citedLabel]],
    });
    bossEnv.sends = [];

    const result = await publishProposal(owner, { proposalId: proposal.id, expectedVersion: 2 });

    expect(result).toEqual({ ok: true, articleId: expect.any(String), indexingQueued: true });
    if (!result.ok) throw new Error("unreachable");

    const row = await prisma.kbProposal.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(row.status).toBe("PUBLISHED");
    expect(row.publishedArticleId).toBe(result.articleId);
    expect(row.publishedAt).toBeInstanceOf(Date);
    expect(row.publishedByUserId).toBe(owner.userId);
    expect(row.version).toBe(3);

    const articles = await prisma.kbArticle.findMany({ where: { organizationId: orgId } });
    expect(articles).toHaveLength(1);
    const [article] = articles;
    expect(article.id).toBe(result.articleId);
    expect(article.title).toBe(title);
    expect(article.bodyMarkdown).toBe(bodyMarkdown);
    expect(article.embeddingStatus).toBe("PENDING");
    expect(article.bodyHtml).toBe(renderMarkdown(bodyMarkdown));
    expect(article.slug).toBe("reset-a-forgotten-password");

    // One send, after commit: the separate client already saw the article inside send.
    const embeds = sendsOn("kb-embed-article");
    expect(embeds).toHaveLength(1);
    expect(embeds[0].payload).toEqual({ articleId: result.articleId });
    expect(embeds[0].seen).toBe("PENDING");

    // K51 (review R2-2) and P8: no marker, no ticket link, no ticket URL in the stored HTML.
    expect(containsSourceMarker(article.title)).toBe(false);
    expect(containsSourceMarker(article.bodyMarkdown)).toBe(false);
    expect(containsTicketLink(article.title)).toBe(false);
    expect(containsTicketLink(article.bodyMarkdown)).toBe(false);
    expect(renderedBodyLinksToTicket(article.bodyMarkdown)).toBe(false);
    const urls = urlAttributes(article.bodyHtml);
    expect(urls.length).toBeGreaterThanOrEqual(2); // the href and the img src are checked
    for (const url of urls) {
      expect(isTicketPageUrl(url)).toBe(false);
      expect(new URL(url, "https://aida.invalid/").pathname.startsWith("/tickets/")).toBe(false);
    }

    // Citations are never copied (D-11): no cited label and no source ticket id in the article.
    for (const text of [article.title, article.bodyMarkdown, article.bodyHtml]) {
      expect(text).not.toContain(citedLabel);
      expect(text).not.toContain(ticket.id);
    }
  });
});
