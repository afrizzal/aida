// Run decision K55 (review a2-WR-03): the kb-proposal-generate queue has a real backoff. pg-boss
// 12 defaults retryDelay to 0, and its backoff multiplies retryDelay, so without an explicit
// retryDelay every retry ran about 2 s later. The queue options come from one helper that both the
// app's pg-boss client and the worker call; createQueue does nothing for an existing queue, so the
// helper also updates it. No database: pg-boss is replaced by a recording double.
import { afterEach, describe, expect, it, vi } from "vitest";

const recorded = vi.hoisted(() => ({
  calls: [] as { method: string; name: string; options: unknown }[],
}));

vi.mock("pg-boss", () => {
  class FakePgBoss {
    on() {}
    async start() {}
    async createQueue(name: string, options: unknown) {
      recorded.calls.push({ method: "createQueue", name, options });
    }
    async updateQueue(name: string, options: unknown) {
      recorded.calls.push({ method: "updateQueue", name, options });
    }
  }
  return { PgBoss: FakePgBoss };
});

import { KB_PROPOSAL_GENERATE_QUEUE } from "../../src/lib/kb/proposal-contract";
import { ensureKbProposalQueue, KB_PROPOSAL_QUEUE_OPTIONS } from "../../src/lib/kb/proposal-queue";

afterEach(() => {
  recorded.calls.length = 0;
  delete (globalThis as { boss?: unknown }).boss;
});

describe("kb-proposal-generate queue options (run decision K55, review a2-WR-03)", () => {
  it("sets an explicit 30 s retryDelay with backoff capped at 300 s and the retry limit 2", () => {
    expect(KB_PROPOSAL_QUEUE_OPTIONS).toEqual({
      retryLimit: 2,
      retryDelay: 30,
      retryBackoff: true,
      retryDelayMax: 300,
    });
  });

  it("ensureKbProposalQueue creates the queue and then updates an existing one to the options", async () => {
    const boss = {
      createQueue: vi.fn(async () => {}),
      updateQueue: vi.fn(async () => {}),
    };
    await ensureKbProposalQueue(boss);
    expect(boss.createQueue).toHaveBeenCalledWith(KB_PROPOSAL_GENERATE_QUEUE, {
      ...KB_PROPOSAL_QUEUE_OPTIONS,
    });
    expect(boss.updateQueue).toHaveBeenCalledWith(KB_PROPOSAL_GENERATE_QUEUE, {
      ...KB_PROPOSAL_QUEUE_OPTIONS,
    });
    expect(boss.createQueue.mock.invocationCallOrder[0]).toBeLessThan(
      boss.updateQueue.mock.invocationCallOrder[0],
    );
  });

  it("the app's pg-boss client creates and updates the queue with these options", async () => {
    process.env.DATABASE_URL ??= "postgres://unused/unused";
    const { getBoss } = await import("../../src/lib/queue/boss-client");
    await getBoss();
    const forQueue = recorded.calls.filter((call) => call.name === KB_PROPOSAL_GENERATE_QUEUE);
    expect(forQueue).toEqual([
      {
        method: "createQueue",
        name: KB_PROPOSAL_GENERATE_QUEUE,
        options: KB_PROPOSAL_QUEUE_OPTIONS,
      },
      {
        method: "updateQueue",
        name: KB_PROPOSAL_GENERATE_QUEUE,
        options: KB_PROPOSAL_QUEUE_OPTIONS,
      },
    ]);
  });
});
