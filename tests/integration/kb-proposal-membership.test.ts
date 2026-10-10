// Phase 12.2, run decision K59 (Codex diff critique round 1, D1): every new 12.2 path reads the
// actor's member rows conservatively, on a real Postgres through Testcontainers. The member table
// (Better Auth's) has no unique key on (organizationId, userId), so one user can hold an admin row
// and a plain member row in the same organization. findConservativeMembership reads every row of
// the user in the organization, ordered by id, and is admin only when every row is owner or
// admin, the rule publish already applies under its FOR SHARE lock (shareLockActiveMembership).
//
// Each case gives one user two rows, inserted in both orders (the admin row first, or the member
// row first), because an unordered single-row read returns whichever row the scan meets first.
// Every path must then refuse: the three loaders, the request, save, reject, restart, retry
// indexing, publish and the generation job's requester check. A role change on one row is seen
// on the next call. Only the app-side pg-boss client (a recording double) and the LLM adapter (a
// double that fails the case if it is ever called) are replaced; no LLM is called.
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const adapter = vi.hoisted(() => ({ calls: 0 }));

vi.mock("@/lib/llm/providers/openai", () => ({
  completeOpenAi: vi.fn(async () => {
    adapter.calls += 1;
    throw new Error("LLM adapter must not be called in the membership cases");
  }),
}));

const bossEnv = vi.hoisted(() => ({ sends: [] as { queue: string; payload: unknown }[] }));

vi.mock("@/lib/queue/boss-client", () => ({
  getBoss: async () => ({
    send: async (queue: string, payload: unknown) => {
      bossEnv.sends.push({ queue, payload });
      return "job-id";
    },
  }),
}));

import { prisma } from "@/lib/db";
import { generateProposal } from "@/lib/kb/generate-proposal";
import { STUCK_AFTER_MS } from "@/lib/kb/proposal-contract";
import {
  loadProposalList,
  loadProposalReview,
  loadStartSelection,
} from "@/lib/kb/proposal-queries";
import { requestProposal } from "@/lib/kb/proposal-request";
import {
  publishProposal,
  rejectProposal,
  restartProposalGeneration,
  retryProposalIndexing,
  saveProposalDraft,
} from "@/lib/kb/proposal-review";
import * as membership from "@/lib/membership";
import { scopedDb } from "@/lib/scoped-db";
import {
  seedOrgWithMembers,
  seedProposal,
  seedResolvedTicket,
} from "../support/kb-proposal-fixtures";

const NOW = new Date("2026-11-09T09:00:00.000Z");

beforeEach(() => {
  adapter.calls = 0;
  bossEnv.sends = [];
});

type Order = "admin row first" | "member row first";
type Placement = "before" | "after";
const ORDERS: readonly Order[] = ["admin row first", "member row first"];

interface Actor {
  userId: string;
  orgId: string;
}

/**
 * An organization (AI on, no LLM provider configured) with an owner and one user who holds TWO
 * member rows: `firstRole` inserted by the fixture, then `secondRole` with an id that sorts
 * before ("0") or after ("z") the fixture's random UUID.
 */
async function seedTwoRows(
  firstRole: "admin" | "member",
  secondRole: "admin" | "member",
  placement: Placement = "after",
) {
  const { orgId, users } = await seedOrgWithMembers(prisma, ["owner", firstRole]);
  const user = users[1];
  const extraId = `${placement === "before" ? "0" : "z"}-k59-${user.memberId}`;
  await prisma.member.create({
    data: {
      id: extraId,
      organizationId: orgId,
      userId: user.id,
      role: secondRole,
      createdAt: new Date(),
    },
  });
  await prisma.setting.create({ data: { organizationId: orgId, key: "aiEnabled", value: "true" } });
  return { orgId, actor: { userId: user.id, orgId } as Actor, firstId: user.memberId, extraId };
}

/** An admin row and a plain member row of one user, inserted in `order`. */
function seedMixed(order: Order, placement: Placement = "after") {
  return order === "admin row first"
    ? seedTwoRows("admin", "member", placement)
    : seedTwoRows("member", "admin", placement);
}

/**
 * One path. `setup` seeds the fresh state it needs in the organization (a ticket or a proposal)
 * and returns its id; `run` then calls the path for the actor, so what `run` writes is counted
 * apart from what `setup` seeded.
 */
interface Probe {
  name: string;
  setup(orgId: string, actor: Actor): Promise<string>;
  run(actor: Actor, id: string): Promise<unknown>;
  refused: unknown;
  /** The shape of a result past the role check (the allowed control). */
  allowed(result: unknown): void;
}

const LOADER_REFUSED = { kind: "NOT_ALLOWED" };
const SERVICE_REFUSED = { ok: false, code: "NOT_ALLOWED" };

async function ticketIn(orgId: string): Promise<string> {
  return (await seedResolvedTicket(orgId)).id;
}

async function draftIn(orgId: string): Promise<string> {
  const ticket = await seedResolvedTicket(orgId);
  return (await seedProposal(orgId, { status: "DRAFT", ticketIds: [ticket.id], version: 1 })).id;
}

const PROBES: readonly Probe[] = [
  {
    name: "loadProposalList",
    setup: draftIn,
    run: (actor) => loadProposalList(actor),
    refused: LOADER_REFUSED,
    allowed: (r) => expect(r).toMatchObject({ kind: "ok" }),
  },
  {
    name: "loadProposalReview",
    setup: draftIn,
    run: (actor, id) => loadProposalReview(actor, id, { now: NOW }),
    refused: LOADER_REFUSED,
    allowed: (r) => expect(r).toMatchObject({ kind: "ok" }),
  },
  {
    name: "loadStartSelection",
    setup: ticketIn,
    run: (actor, id) => loadStartSelection(actor, [id]),
    refused: LOADER_REFUSED,
    allowed: (r) => expect(r).toMatchObject({ kind: "ok" }),
  },
  {
    name: "requestProposal",
    setup: ticketIn,
    run: (actor, id) => requestProposal(actor, [id], { now: () => NOW }),
    refused: SERVICE_REFUSED,
    allowed: (r) => expect(r).toMatchObject({ ok: true }),
  },
  {
    name: "saveProposalDraft",
    setup: draftIn,
    run: (actor, id) =>
      saveProposalDraft(actor, {
        proposalId: id,
        expectedVersion: 1,
        title: "Clearing a stuck print queue",
        bodyMarkdown: "## Steps\n\nRestart the spooler service.",
      }),
    refused: SERVICE_REFUSED,
    allowed: (r) => expect(r).toMatchObject({ ok: true }),
  },
  {
    name: "rejectProposal",
    setup: draftIn,
    run: (actor, id) => rejectProposal(actor, { proposalId: id, expectedVersion: 1 }),
    refused: SERVICE_REFUSED,
    allowed: (r) => expect(r).toEqual({ ok: true }),
  },
  {
    name: "restartProposalGeneration",
    setup: async (orgId) => {
      const ticket = await seedResolvedTicket(orgId);
      const stuck = await seedProposal(orgId, {
        status: "GENERATING",
        ticketIds: [ticket.id],
        version: 1,
        generationQueuedAt: new Date(NOW.getTime() - STUCK_AFTER_MS - 60_000),
      });
      return stuck.id;
    },
    run: (actor, id) =>
      restartProposalGeneration(actor, { proposalId: id, expectedVersion: 1 }, { now: NOW }),
    refused: SERVICE_REFUSED,
    allowed: (r) => expect(r).toMatchObject({ ok: true }),
  },
  {
    name: "retryProposalIndexing",
    setup: async (orgId) => {
      const ticket = await seedResolvedTicket(orgId);
      return (await seedProposal(orgId, { status: "PUBLISHED", ticketIds: [ticket.id] })).id;
    },
    run: (actor, id) => retryProposalIndexing(actor, { proposalId: id }),
    refused: SERVICE_REFUSED,
    allowed: (r) => expect(r).toMatchObject({ ok: true }),
  },
  {
    name: "publishProposal",
    setup: draftIn,
    run: (actor, id) => publishProposal(actor, { proposalId: id, expectedVersion: 1 }),
    refused: SERVICE_REFUSED,
    allowed: (r) => expect(r).toMatchObject({ ok: true }),
  },
  {
    // The job's requester check (D-01): the proposal's requester is the actor. No provider is
    // configured, so a requester that passes ends FAILED CONFIGURATION, before any provider call.
    name: "generateProposal requester check",
    setup: async (orgId, actor) => {
      const ticket = await seedResolvedTicket(orgId);
      const proposal = await seedProposal(orgId, {
        status: "GENERATING",
        ticketIds: [ticket.id],
        requestedByUserId: actor.userId,
        generationQueuedAt: NOW,
      });
      return proposal.id;
    },
    run: (_actor, id) =>
      generateProposal(id, { epoch: 1, attempt: { retryCount: 0, retryLimit: 2 }, now: NOW }),
    refused: { outcome: "FAILED", code: "REQUESTER_NOT_ALLOWED" },
    allowed: (r) => expect(r).toEqual({ outcome: "FAILED", code: "CONFIGURATION" }),
  },
];

/** Seeds the probe's state and runs it once for the actor. */
async function runProbe(probe: Probe, actor: Actor): Promise<unknown> {
  return probe.run(actor, await probe.setup(actor.orgId, actor));
}

describe("findConservativeMembership (run decision K59)", () => {
  for (const order of ORDERS) {
    for (const placement of ["before", "after"] as const) {
      it(`an admin row and a member row (${order}, extra id sorting ${placement}): the member row decides`, async () => {
        const { orgId, actor } = await seedMixed(order, placement);
        for (const client of [prisma, scopedDb(orgId)]) {
          const found = await membership.findConservativeMembership(client, actor.userId, orgId);
          expect(found?.role).toBe("member");
          expect(membership.isAdminRole(found?.role)).toBe(false);
        }
        const inTx = await prisma.$transaction((tx) =>
          membership.findConservativeMembership(tx, actor.userId, orgId),
        );
        expect(inTx?.role).toBe("member");
      });
    }
  }

  it("two admin rows: the first row by id, which is admin", async () => {
    const { orgId, actor } = await seedTwoRows("admin", "admin", "before");
    const found = await membership.findConservativeMembership(prisma, actor.userId, orgId);
    // "First by id" is the database's own order of the id column (its collation, which need not
    // match JavaScript's code-unit sort for ids such as "0-k59-…" and "0cf7…").
    const [first] = await prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "member"
      WHERE "userId" = ${actor.userId} AND "organizationId" = ${orgId}
      ORDER BY "id" LIMIT 1
    `;
    expect(found).toEqual({ id: first.id, role: "admin" });
  });

  it("one row gives what findActiveMembership gives; no row, another organization, or an empty id give null", async () => {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["owner", "member"]);
    const other = await seedOrgWithMembers(prisma, ["owner"]);
    for (const user of users) {
      expect(await membership.findConservativeMembership(prisma, user.id, orgId)).toEqual(
        await membership.findActiveMembership(prisma, user.id, orgId),
      );
    }
    expect(
      await membership.findConservativeMembership(prisma, users[0].id, other.orgId),
    ).toBeNull();
    expect(await membership.findConservativeMembership(prisma, randomUUID(), orgId)).toBeNull();
    expect(await membership.findConservativeMembership(prisma, "", orgId)).toBeNull();
    expect(await membership.findConservativeMembership(prisma, users[0].id, "")).toBeNull();
  });

  it("a role change is seen on the next read", async () => {
    const { orgId, actor, extraId } = await seedTwoRows("admin", "admin");
    expect((await membership.findConservativeMembership(prisma, actor.userId, orgId))?.role).toBe(
      "admin",
    );
    await prisma.member.update({ where: { id: extraId }, data: { role: "member" } });
    expect((await membership.findConservativeMembership(prisma, actor.userId, orgId))?.role).toBe(
      "member",
    );
    await prisma.member.update({ where: { id: extraId }, data: { role: "admin" } });
    expect((await membership.findConservativeMembership(prisma, actor.userId, orgId))?.role).toBe(
      "admin",
    );
  });
});

describe("every new 12.2 path refuses a user whose rows are not all owner or admin (run decision K59)", () => {
  for (const probe of PROBES) {
    for (const order of ORDERS) {
      it(`${probe.name}: an admin row and a member row (${order}) is refused`, async () => {
        const { orgId, actor } = await seedMixed(order);
        const id = await probe.setup(orgId, actor);
        const sendsBefore = bossEnv.sends.length;
        const articlesBefore = await prisma.kbArticle.count({ where: { organizationId: orgId } });

        expect(await probe.run(actor, id)).toEqual(probe.refused);

        expect(bossEnv.sends.slice(sendsBefore).filter((s) => s.queue.startsWith("kb-"))).toEqual(
          [],
        );
        expect(await prisma.kbArticle.count({ where: { organizationId: orgId } })).toBe(
          articlesBefore,
        );
        expect(adapter.calls).toBe(0);
      });
    }

    it(`${probe.name}: a role change on one of two admin rows is seen on the next call`, async () => {
      const { actor, extraId } = await seedTwoRows("admin", "admin");
      probe.allowed(await runProbe(probe, actor));

      await prisma.member.update({ where: { id: extraId }, data: { role: "member" } });
      expect(await runProbe(probe, actor)).toEqual(probe.refused);

      await prisma.member.update({ where: { id: extraId }, data: { role: "admin" } });
      probe.allowed(await runProbe(probe, actor));
      expect(adapter.calls).toBe(0);
    });
  }
});
