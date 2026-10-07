// Phase 12.2, plan 12.2-03, reviews R2-1, P6 and R3-1: the kb-embed-article job swaps an
// article's chunks under a lock on the article row, skips a stale text or a changed model, and
// writes FAILED only on a current PENDING article. Real Postgres through Testcontainers; the
// embedding adapter is mocked (deterministic 768-length vectors, never a real provider) and the
// queue is a recording double.
//
// Every race records each job's backend PID from inside that job's own transaction (the
// setKbEmbedArticleObserverForTests hooks) and waits for exactly that PID to be blocked by the
// holder it must queue behind (waitForBlockedBy). Other orderings are forced by awaited
// promises. No timed waits.
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queue = vi.hoisted(() => ({
  sends: [] as { name: string; data: unknown }[],
}));

// The vectors every embed call returns unless a case queues another behaviour.
const embedDefault = vi.hoisted(
  () =>
    async ({ input }: { input: string[] }): Promise<number[][]> =>
      input.map(() => Array(768).fill(0.01)),
);

vi.mock("@/lib/rag/providers/openai-embed", () => ({
  embedOpenAi: vi.fn(embedDefault),
}));

vi.mock("@/lib/queue/boss-client", () => ({
  getBoss: async () => ({
    send: async (name: string, data: unknown) => {
      queue.sends.push({ name, data });
      return "job";
    },
  }),
}));

import { prisma } from "@/lib/db";
import { createKbArticle, enqueueReembed, updateKbArticle } from "@/lib/kb/create-article";
import { chunkMarkdown } from "@/lib/rag/chunk-markdown";
import { embedOpenAi } from "@/lib/rag/providers/openai-embed";
import { saveEmbeddingSettings } from "@/lib/rag/settings";
import { scopedDb } from "@/lib/scoped-db";
import {
  kbEmbedArticleHandler,
  setKbEmbedArticleObserverForTests,
} from "@/lib/worker/jobs/kb-embed-article";
import { backendPid, type Deferred, deferred, waitForBlockedBy } from "../support/lock-wait";

const embedMock = vi.mocked(embedOpenAi);

const SMALL = "text-embedding-3-small";
const LARGE = "text-embedding-3-large";
const SMALL_ID = `openai:${SMALL}`;
const LARGE_ID = `openai:${LARGE}`;

const BODY =
  "## Refunds\nWe refund within 30 days.\n\n## Shipping\nShips in 2 days.\n\n## Returns\nUse the form.";
const V1 =
  "## Setup\nMARKER-V1-ONLY install the agent.\n\n## Usage\nRun the first command.\n\n## Support\nWrite to us.";
const V2 = "## Setup\nInstall the second agent.\n\n## Usage\nRun the second command.";

// Every deferred a case holds a job on; afterEach releases them all so no promise is left open.
const held: Deferred<void>[] = [];
function hold(): Deferred<void> {
  const d = deferred<void>();
  held.push(d);
  return d;
}

beforeEach(() => {
  queue.sends.length = 0;
  embedMock.mockReset();
  embedMock.mockImplementation(embedDefault);
});

afterEach(() => {
  setKbEmbedArticleObserverForTests(null);
  for (const d of held.splice(0)) d.resolve();
  embedMock.mockReset();
  embedMock.mockImplementation(embedDefault);
});

async function seedOrg(options: { configured?: boolean } = {}) {
  const org = await prisma.organization.create({
    data: {
      id: randomUUID(),
      name: "KB Embed Race Org",
      slug: `kb-embed-race-${randomUUID()}`,
      createdAt: new Date(),
    },
  });
  const db = scopedDb(org.id);
  if (options.configured !== false) {
    await saveEmbeddingSettings(db, org.id, {
      provider: "openai",
      model: SMALL,
      apiKey: "sk-test-DUMMYEMBEDKEY0000000000",
    });
  }
  return { orgId: org.id, db };
}

async function seedArticle(orgId: string, bodyMarkdown: string) {
  const { id } = await createKbArticle(orgId, { title: `Article ${randomUUID()}`, bodyMarkdown });
  return id;
}

async function articleRow(articleId: string) {
  return prisma.kbArticle.findUnique({
    where: { id: articleId },
    select: { embeddingStatus: true, embeddingModel: true, bodyMarkdown: true },
  });
}

async function chunkRows(articleId: string) {
  return prisma.kbChunk.findMany({
    where: { articleId },
    orderBy: { position: "asc" },
    select: { id: true, position: true, content: true, embeddingModel: true },
  });
}

/** Exactly one set of chunks for `body`: n rows, positions 0 to n-1 each once, the text's contents. */
async function expectOneChunkSet(articleId: string, body: string, model: string) {
  const expected = chunkMarkdown(body);
  const rows = await chunkRows(articleId);
  expect(expected.length).toBeGreaterThan(1);
  expect(rows).toHaveLength(expected.length);
  expect(rows.map((r) => r.position)).toEqual(expected.map((_, i) => i));
  expect(new Set(rows.map((r) => r.position)).size).toBe(expected.length);
  expect(rows.map((r) => r.content)).toEqual(expected.map((c) => c.content));
  for (const row of rows) expect(row.embeddingModel).toBe(model);
  return rows;
}

/** Waits for every promise to settle and asserts that none ended in a deadlock (40P01). */
async function settleAll(promises: Promise<unknown>[]) {
  const results = await Promise.allSettled(promises);
  for (const result of results) {
    if (result.status === "rejected") {
      const err = result.reason as { code?: unknown; message?: unknown };
      expect(String(err?.code ?? "")).not.toContain("40P01");
      expect(String(err?.message ?? "")).not.toContain("40P01");
    }
  }
  return results;
}

/**
 * Review a2-IN-03: a failed job rethrows only this fixed text (it lands in the pg-boss job row),
 * never the provider's or the database's own error text.
 */
function fixedFailure(articleId: string): RegExp {
  return new RegExp(`^kb-embed-article: ${articleId} embed failed$`);
}

function sentFor(articleId: string) {
  return queue.sends.filter(
    (s) =>
      s.name === "kb-embed-article" && (s.data as { articleId?: string }).articleId === articleId,
  );
}

describe("kb-embed-article: locked chunk swap (review R2-1)", () => {
  it("two jobs for one article: the second's row lock waits behind the first; one set of chunks, COMPLETED", async () => {
    const { orgId } = await seedOrg();
    const articleId = await seedArticle(orgId, BODY);

    const aPid = deferred<number>();
    const bPid = deferred<number>();
    const releaseA = hold();
    let swapStarts = 0;
    let locks = 0;
    setKbEmbedArticleObserverForTests({
      onSwapStart: async (tx) => {
        swapStarts += 1;
        if (swapStarts === 2) bPid.resolve(await backendPid(tx));
      },
      afterArticleLock: async (tx) => {
        locks += 1;
        if (locks !== 1) return;
        aPid.resolve(await backendPid(tx));
        await releaseA.promise;
      },
    });

    const jobA = kbEmbedArticleHandler({ articleId });
    const holder = await aPid.promise;
    const jobB = kbEmbedArticleHandler({ articleId });
    await waitForBlockedBy(prisma, holder, [await bPid.promise]);
    releaseA.resolve();

    const results = await settleAll([jobA, jobB]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    await expectOneChunkSet(articleId, BODY, SMALL_ID);
    const row = await articleRow(articleId);
    expect(row?.embeddingStatus).toBe("COMPLETED");
    expect(row?.embeddingModel).toBe(SMALL_ID);
    expect(embedMock).toHaveBeenCalledTimes(2);
  });

  it("a stale job after a newer job completed: it writes nothing; the newer text's chunks stay", async () => {
    const { orgId } = await seedOrg();
    const articleId = await seedArticle(orgId, V1);

    const aHeld = deferred<void>();
    const releaseA = hold();
    let embeds = 0;
    setKbEmbedArticleObserverForTests({
      afterEmbed: async () => {
        embeds += 1;
        if (embeds !== 1) return;
        aHeld.resolve();
        await releaseA.promise;
      },
    });

    const jobA = kbEmbedArticleHandler({ articleId });
    await aHeld.promise;
    await updateKbArticle(orgId, articleId, { title: "Edited", bodyMarkdown: V2 });
    expect(sentFor(articleId)).toHaveLength(2); // create + edit
    await kbEmbedArticleHandler({ articleId }); // job B, for V2
    releaseA.resolve();

    const results = await settleAll([jobA]);
    expect(results[0]?.status).toBe("fulfilled");
    const rows = await expectOneChunkSet(articleId, V2, SMALL_ID);
    for (const r of rows) expect(r.content).not.toContain("MARKER-V1-ONLY");
    const row = await articleRow(articleId);
    expect(row?.embeddingStatus).toBe("COMPLETED");
    expect(row?.embeddingModel).toBe(SMALL_ID);
  });

  it("a stale job that reaches its swap first: it writes nothing; PENDING with the earlier chunks, then the newer job stores V2", async () => {
    const { orgId } = await seedOrg();
    const articleId = await seedArticle(orgId, V1);
    await kbEmbedArticleHandler({ articleId }); // V1 stored, COMPLETED
    const before = await expectOneChunkSet(articleId, V1, SMALL_ID);

    const aHeld = deferred<void>();
    const releaseA = hold();
    let armed = true;
    setKbEmbedArticleObserverForTests({
      afterEmbed: async () => {
        if (!armed) return;
        armed = false;
        aHeld.resolve();
        await releaseA.promise;
      },
    });

    const jobA = kbEmbedArticleHandler({ articleId });
    await aHeld.promise;
    await updateKbArticle(orgId, articleId, { title: "Edited", bodyMarkdown: V2 });
    releaseA.resolve();
    const results = await settleAll([jobA]);
    expect(results[0]?.status).toBe("fulfilled");

    const afterA = await articleRow(articleId);
    expect(afterA?.embeddingStatus).toBe("PENDING");
    expect((await chunkRows(articleId)).map((r) => r.id)).toEqual(before.map((r) => r.id));

    await kbEmbedArticleHandler({ articleId }); // job B, for V2
    await expectOneChunkSet(articleId, V2, SMALL_ID);
    expect((await articleRow(articleId))?.embeddingStatus).toBe("COMPLETED");
  });

  it("a deleted row after the embed ends the job without an error and without chunks", async () => {
    const { orgId } = await seedOrg();
    const articleId = await seedArticle(orgId, BODY);
    setKbEmbedArticleObserverForTests({
      afterEmbed: async () => {
        await prisma.kbArticle.delete({ where: { id: articleId } });
      },
    });

    await expect(kbEmbedArticleHandler({ articleId })).resolves.toBeUndefined();
    expect(await articleRow(articleId)).toBeNull();
    expect(await prisma.kbChunk.count({ where: { articleId } })).toBe(0);
  });

  it("the zero-chunk path takes the locked swap: COMPLETED with the configured model, no chunks", async () => {
    const { orgId } = await seedOrg();
    const articleId = await seedArticle(orgId, "");
    expect(chunkMarkdown("")).toHaveLength(0);
    let locks = 0;
    setKbEmbedArticleObserverForTests({
      afterArticleLock: () => {
        locks += 1;
      },
    });

    await kbEmbedArticleHandler({ articleId });
    expect(locks).toBe(1);
    expect(embedMock).not.toHaveBeenCalled();
    expect(await prisma.kbChunk.count({ where: { articleId } })).toBe(0);
    const row = await articleRow(articleId);
    expect(row?.embeddingStatus).toBe("COMPLETED");
    expect(row?.embeddingModel).toBe(SMALL_ID);
  });
});

describe("kb-embed-article: FAILED only on a current PENDING article (reviews R2-1, R3-1)", () => {
  it("catch path, stale: an edit commits during the failing embed; the job rejects and the article stays PENDING", async () => {
    const { orgId } = await seedOrg();
    const articleId = await seedArticle(orgId, V1);
    embedMock.mockImplementationOnce(async () => {
      await updateKbArticle(orgId, articleId, { title: "Edited", bodyMarkdown: V2 });
      throw new Error("embed failed after edit");
    });

    await expect(kbEmbedArticleHandler({ articleId })).rejects.toThrow(fixedFailure(articleId));
    const row = await articleRow(articleId);
    expect(row?.bodyMarkdown).toBe(V2);
    expect(row?.embeddingStatus).toBe("PENDING");
  });

  it("catch path, text unchanged: the job rejects and the article is FAILED (existing behaviour)", async () => {
    const { orgId } = await seedOrg();
    const articleId = await seedArticle(orgId, BODY);
    embedMock.mockImplementationOnce(async () => {
      throw new Error("embed failed");
    });

    await expect(kbEmbedArticleHandler({ articleId })).rejects.toThrow(fixedFailure(articleId));
    expect((await articleRow(articleId))?.embeddingStatus).toBe("FAILED");
  });

  it("configuration gate: an organization without embedding settings gets FAILED without a throw", async () => {
    const { orgId } = await seedOrg({ configured: false });
    const articleId = await seedArticle(orgId, BODY);

    await expect(kbEmbedArticleHandler({ articleId })).resolves.toBeUndefined();
    expect((await articleRow(articleId))?.embeddingStatus).toBe("FAILED");
    expect(embedMock).not.toHaveBeenCalled();
  });

  it("R3-1, promise-ordered: a job failing after another job completed the text leaves COMPLETED", async () => {
    const { orgId } = await seedOrg();
    const articleId = await seedArticle(orgId, BODY);

    const aCalled = deferred<void>();
    const releaseA = hold();
    embedMock.mockImplementationOnce(async () => {
      aCalled.resolve();
      await releaseA.promise;
      throw new Error("job A embed failed");
    });

    const jobA = kbEmbedArticleHandler({ articleId });
    await aCalled.promise;
    await kbEmbedArticleHandler({ articleId }); // job B, second adapter call returns vectors
    expect((await articleRow(articleId))?.embeddingStatus).toBe("COMPLETED");
    const bChunks = await expectOneChunkSet(articleId, BODY, SMALL_ID);

    releaseA.resolve();
    await expect(jobA).rejects.toThrow(fixedFailure(articleId));
    const row = await articleRow(articleId);
    expect(row?.embeddingStatus).toBe("COMPLETED");
    expect(row?.embeddingModel).toBe(SMALL_ID);
    expect((await chunkRows(articleId)).map((r) => r.id)).toEqual(bChunks.map((r) => r.id));
  });

  it("R3-1, PID-bound: a failing job's FAILED transaction waits behind a completing job's row lock, then writes nothing", async () => {
    const { orgId } = await seedOrg();
    const articleId = await seedArticle(orgId, BODY);

    const bPid = deferred<number>();
    const aPid = deferred<number>();
    const releaseB = hold();
    let locks = 0;
    setKbEmbedArticleObserverForTests({
      afterArticleLock: async (tx) => {
        locks += 1;
        if (locks !== 1) return;
        bPid.resolve(await backendPid(tx));
        await releaseB.promise;
      },
      onFailStart: async (tx) => {
        aPid.resolve(await backendPid(tx));
      },
    });

    const jobB = kbEmbedArticleHandler({ articleId });
    const holder = await bPid.promise;
    embedMock.mockImplementationOnce(async () => {
      throw new Error("job A embed failed at once");
    });
    const jobA = kbEmbedArticleHandler({ articleId });
    await waitForBlockedBy(prisma, holder, [await aPid.promise]);
    releaseB.resolve();

    const results = await settleAll([jobB, jobA]);
    expect(results[0]?.status).toBe("fulfilled");
    expect(results[1]?.status).toBe("rejected");
    expect(((results[1] as PromiseRejectedResult).reason as Error).message).toMatch(
      fixedFailure(articleId),
    );
    const row = await articleRow(articleId);
    expect(row?.embeddingStatus).toBe("COMPLETED");
    await expectOneChunkSet(articleId, BODY, SMALL_ID);
  });
});

describe("kb-embed-article: model freshness (review P6)", () => {
  it("an old-model job blocked behind the new-model job stores nothing; every chunk carries the new model", async () => {
    const { orgId, db } = await seedOrg();
    const articleId = await seedArticle(orgId, BODY);

    const aHeld = deferred<void>();
    const releaseA = hold();
    const bPid = deferred<number>();
    const aPid = deferred<number>();
    const releaseB = hold();
    let embeds = 0;
    let swapStarts = 0;
    let locks = 0;
    setKbEmbedArticleObserverForTests({
      afterEmbed: async () => {
        embeds += 1;
        if (embeds !== 1) return; // job A
        aHeld.resolve();
        await releaseA.promise;
      },
      onSwapStart: async (tx) => {
        swapStarts += 1;
        if (swapStarts === 2) aPid.resolve(await backendPid(tx)); // job A (B swapped first)
      },
      afterArticleLock: async (tx) => {
        locks += 1;
        if (locks !== 1) return; // job B
        bPid.resolve(await backendPid(tx));
        await releaseB.promise;
      },
    });

    const jobA = kbEmbedArticleHandler({ articleId }); // embeds with text-embedding-3-small
    await aHeld.promise;
    await saveEmbeddingSettings(db, orgId, { model: LARGE });
    await enqueueReembed(orgId, articleId);
    expect(sentFor(articleId)).toHaveLength(2); // create + re-embed
    expect((await articleRow(articleId))?.embeddingStatus).toBe("PENDING");

    const jobB = kbEmbedArticleHandler({ articleId }); // embeds with text-embedding-3-large
    const holder = await bPid.promise;
    releaseA.resolve();
    await waitForBlockedBy(prisma, holder, [await aPid.promise]);
    releaseB.resolve();

    const results = await settleAll([jobA, jobB]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    await expectOneChunkSet(articleId, BODY, LARGE_ID);
    const row = await articleRow(articleId);
    expect(row?.embeddingStatus).toBe("COMPLETED");
    expect(row?.embeddingModel).toBe(LARGE_ID);
    expect(embedMock.mock.calls.map((c) => c[0].model)).toEqual([SMALL, LARGE]);
  });

  it("an old-model job released after the model change and before the new job stores nothing; the new job stores the new model", async () => {
    const { orgId, db } = await seedOrg();
    const articleId = await seedArticle(orgId, BODY);

    const aHeld = deferred<void>();
    const releaseA = hold();
    let armed = true;
    setKbEmbedArticleObserverForTests({
      afterEmbed: async () => {
        if (!armed) return;
        armed = false;
        aHeld.resolve();
        await releaseA.promise;
      },
    });

    const jobA = kbEmbedArticleHandler({ articleId });
    await aHeld.promise;
    await saveEmbeddingSettings(db, orgId, { model: LARGE });
    await enqueueReembed(orgId, articleId);
    releaseA.resolve();
    const results = await settleAll([jobA]);
    expect(results[0]?.status).toBe("fulfilled");
    expect((await articleRow(articleId))?.embeddingStatus).toBe("PENDING");
    expect(await prisma.kbChunk.count({ where: { articleId } })).toBe(0);

    await kbEmbedArticleHandler({ articleId }); // job B, new model
    await expectOneChunkSet(articleId, BODY, LARGE_ID);
    const row = await articleRow(articleId);
    expect(row?.embeddingStatus).toBe("COMPLETED");
    expect(row?.embeddingModel).toBe(LARGE_ID);
  });

  it("catch path after a model change: the job rejects and the article stays PENDING, never FAILED", async () => {
    const { orgId, db } = await seedOrg();
    const articleId = await seedArticle(orgId, BODY);
    embedMock.mockImplementationOnce(async () => {
      await saveEmbeddingSettings(db, orgId, { model: LARGE });
      throw new Error("embed failed after model change");
    });

    await expect(kbEmbedArticleHandler({ articleId })).rejects.toThrow(fixedFailure(articleId));
    expect((await articleRow(articleId))?.embeddingStatus).toBe("PENDING");
  });

  it("configuration gate: settings saved before the FAILED transaction locks the row leave PENDING", async () => {
    const { orgId, db } = await seedOrg({ configured: false });
    const articleId = await seedArticle(orgId, BODY);
    let failStarts = 0;
    setKbEmbedArticleObserverForTests({
      onFailStart: async () => {
        failStarts += 1;
        // Committed on its own connection, outside the job's transaction.
        await saveEmbeddingSettings(db, orgId, {
          provider: "openai",
          model: SMALL,
          apiKey: "sk-test-DUMMYEMBEDKEY0000000000",
        });
      },
    });

    await expect(kbEmbedArticleHandler({ articleId })).resolves.toBeUndefined();
    expect(failStarts).toBe(1);
    expect((await articleRow(articleId))?.embeddingStatus).toBe("PENDING");
    expect(embedMock).not.toHaveBeenCalled();
  });
});

describe("kb-embed-article: a settings read error is never a silent skip (review a2-WR-07)", () => {
  /** Makes the stored embedding key undecryptable: the next settings read throws. */
  async function breakEmbeddingKey(orgId: string): Promise<void> {
    const updated = await prisma.setting.updateMany({
      where: { organizationId: orgId, key: "llm:embeddingApiKeyEnc" },
      data: { value: "not-a-ciphertext" },
    });
    expect(updated.count).toBe(1);
  }

  it("a read error inside the swap transaction: the job rejects for a retry, PENDING, no chunks", async () => {
    const { orgId } = await seedOrg();
    const articleId = await seedArticle(orgId, BODY);
    await prisma.kbChunk.deleteMany({ where: { articleId } });
    await prisma.kbArticle.update({
      where: { id: articleId },
      data: { embeddingStatus: "PENDING" },
    });
    setKbEmbedArticleObserverForTests({
      // Committed on its own connection while the job holds the article row lock.
      afterArticleLock: async () => breakEmbeddingKey(orgId),
    });

    await expect(kbEmbedArticleHandler({ articleId })).rejects.toThrow();
    expect(embedMock).toHaveBeenCalledTimes(1);
    expect((await articleRow(articleId))?.embeddingStatus).toBe("PENDING");
    expect(await chunkRows(articleId)).toEqual([]);
  });

  it("a read error at the configuration gate: the job rejects for a retry, never FAILED as unconfigured", async () => {
    const { orgId } = await seedOrg();
    const articleId = await seedArticle(orgId, BODY);
    await prisma.kbArticle.update({
      where: { id: articleId },
      data: { embeddingStatus: "PENDING" },
    });
    await breakEmbeddingKey(orgId);

    await expect(kbEmbedArticleHandler({ articleId })).rejects.toThrow();
    expect(embedMock).not.toHaveBeenCalled();
    expect((await articleRow(articleId))?.embeddingStatus).toBe("PENDING");
  });
});

describe("kb-embed-article: fixed-text failure (review a2-IN-03)", () => {
  it("a provider error carrying server text reaches pg-boss only as the fixed line", async () => {
    const { orgId } = await seedOrg();
    const articleId = await seedArticle(orgId, BODY);
    const providerText = "PROVIDER-SERVER-TEXT-9c1e model not pulled";
    embedMock.mockImplementationOnce(async () => {
      throw new Error(providerText);
    });

    const error = await kbEmbedArticleHandler({ articleId }).then(
      () => null,
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(`kb-embed-article: ${articleId} embed failed`);
    expect(JSON.stringify(error)).not.toContain("PROVIDER-SERVER-TEXT");
    expect(String((error as Error).stack)).not.toContain("PROVIDER-SERVER-TEXT");
    expect((error as { cause?: unknown }).cause).toBeUndefined();
    expect((await articleRow(articleId))?.embeddingStatus).toBe("FAILED");
  });
});
