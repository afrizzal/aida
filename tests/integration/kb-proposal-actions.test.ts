// Phase 12.2, plan 12.2-08: the KB proposal server actions and loaders (AIDA-18, D-01; reviews
// C2, C5, C6, P1 and P3), on a real Postgres through Testcontainers. The session and next/cache
// are test doubles (the ticket-state-actions pattern); the services, the loaders and Postgres
// are real. The app-side pg-boss client is a recording double, so no job is really queued and no
// LLM or embedding provider is called. The request service is wrapped by a partial mock that
// delegates to the real requestProposal unless a case arms a one-time throw.
import { randomUUID } from "node:crypto";
import { notFound, redirect } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  actor: null as null | { userId: string; orgId: string },
  /** Review b-WR-01: an error the session read throws instead (a Next redirect or not-found). */
  sessionThrows: null as unknown,
}));

vi.mock("@/lib/session", () => ({
  getSessionActor: async () => {
    if (env.sessionThrows) throw env.sessionThrows;
    if (!env.actor) throw new Error("no session");
    return env.actor;
  },
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}));

const bossEnv = vi.hoisted(() => ({
  sends: [] as { queue: string; payload: unknown }[],
}));

vi.mock("@/lib/queue/boss-client", () => ({
  getBoss: async () => ({
    send: async (queue: string, payload: unknown) => {
      bossEnv.sends.push({ queue, payload });
      return "job-id";
    },
  }),
}));

const requestEnv = vi.hoisted(() => ({ throwOnce: null as null | Error }));

vi.mock("@/lib/kb/proposal-request", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/kb/proposal-request")>();
  return {
    ...actual,
    requestProposal: async (...args: Parameters<typeof actual.requestProposal>) => {
      const armed = requestEnv.throwOnce;
      if (armed) {
        requestEnv.throwOnce = null;
        throw armed;
      }
      return actual.requestProposal(...args);
    },
  };
});

const {
  loadStartSelectionAction,
  publishProposalAction,
  rejectProposalAction,
  requestProposalAction,
  restartGenerationAction,
  retryIndexingAction,
  saveProposalAction,
} = await import("@/app/(app)/kb/proposals/actions");

import { prisma } from "@/lib/db";
import { KB_PROPOSAL_GENERATE_QUEUE } from "@/lib/kb/proposal-contract";
import {
  loadProposalList,
  loadProposalReview,
  loadStartSelection,
} from "@/lib/kb/proposal-queries";
import {
  seedOrgWithMembers,
  seedProposal,
  seedResolvedTicket,
} from "../support/kb-proposal-fixtures";

/** Above 2^53: a Number() conversion anywhere on the path would change it (review P3). */
const SNAPSHOT_ABOVE_2_53 = 9007199254740993n;

beforeEach(() => {
  revalidatePath.mockReset();
  bossEnv.sends = [];
  requestEnv.throwOnce = null;
  env.actor = null;
  env.sessionThrows = null;
});

/** An organization with AI on, an owner, a plain member and a member whose row was deleted. */
async function seedOrg() {
  const { orgId, users } = await seedOrgWithMembers(prisma, ["owner", "member", "admin"]);
  await prisma.member.delete({ where: { id: users[2].memberId } });
  await prisma.setting.create({ data: { organizationId: orgId, key: "aiEnabled", value: "true" } });
  return {
    orgId,
    owner: { userId: users[0].id, orgId },
    member: { userId: users[1].id, orgId },
    removed: { userId: users[2].id, orgId },
  };
}

/** The error a next/navigation control-flow function throws (redirect, notFound). */
function thrownBy(control: () => never): unknown {
  try {
    control();
  } catch (error) {
    return error;
  }
  throw new Error("the control-flow function did not throw");
}

function sendsOn(queue: string) {
  return bossEnv.sends.filter((send) => send.queue === queue);
}

/** Sends on the two proposal queues (ticket creation enqueues triage on its own). */
function proposalSends() {
  return bossEnv.sends.filter(
    (send) => send.queue === KB_PROPOSAL_GENERATE_QUEUE || send.queue === "kb-embed-article",
  );
}

/**
 * Every path to a key named snapshotSeq and every path to a bigint value, at any depth of
 * objects, arrays, Map keys and values and Set values. A Date is a leaf.
 */
function findForbidden(value: unknown, path = "$", found: string[] = []): string[] {
  if (typeof value === "bigint") {
    found.push(`${path}: bigint`);
    return found;
  }
  if (value === null || typeof value !== "object" || value instanceof Date) return found;
  if (value instanceof Map) {
    for (const [key, entry] of value) {
      findForbidden(key, `${path}<key>`, found);
      if (key === "snapshotSeq") found.push(`${path}<key snapshotSeq>`);
      findForbidden(entry, `${path}<${String(key)}>`, found);
    }
    return found;
  }
  if (value instanceof Set) {
    let index = 0;
    for (const entry of value) findForbidden(entry, `${path}{${index++}}`, found);
    return found;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      findForbidden(entry, `${path}[${index}]`, found);
    });
    return found;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (key === "snapshotSeq") found.push(`${path}.${key}`);
    findForbidden(entry, `${path}.${key}`, found);
  }
  return found;
}

describe("KB proposal actions and loaders: tracer (D-01)", () => {
  it("an owner requests a proposal from one RESOLVED ticket and the list shows it", async () => {
    const { orgId, owner } = await seedOrg();
    const ticket = await seedResolvedTicket(orgId);
    env.actor = owner;

    const result = await requestProposalAction([ticket.id]);

    expect(result).toEqual({ ok: true, proposalId: expect.any(String) });
    if (!result.ok) throw new Error("unreachable");
    expect(sendsOn(KB_PROPOSAL_GENERATE_QUEUE)).toHaveLength(1);
    expect(revalidatePath).toHaveBeenCalledWith("/kb/proposals");
    expect(revalidatePath).toHaveBeenCalledWith(`/kb/proposals/${result.proposalId}`);

    const list = await loadProposalList(owner);
    expect(list.kind).toBe("ok");
    if (list.kind !== "ok") throw new Error("unreachable");
    expect(list.aiEnabled).toBe(true);
    expect(list.rows).toEqual([
      {
        id: result.proposalId,
        status: "GENERATING",
        title: null,
        failureCode: null,
        sourceCount: 1,
        createdAt: expect.any(Date),
      },
    ]);
  });

  it("the list is newest first and shows every status with its source count", async () => {
    const { orgId, owner } = await seedOrg();
    const a = await seedResolvedTicket(orgId);
    const b = await seedResolvedTicket(orgId);
    const base = Date.now();
    const older = await seedProposal(orgId, {
      status: "FAILED",
      ticketIds: [a.id],
      failureCode: "PROVIDER",
      createdAt: new Date(base - 60_000),
    });
    const newer = await seedProposal(orgId, {
      status: "DRAFT",
      ticketIds: [a.id, b.id],
      createdAt: new Date(base),
    });

    const list = await loadProposalList(owner);

    if (list.kind !== "ok") throw new Error(`expected ok, got ${list.kind}`);
    expect(list.rows.map((row) => row.id)).toEqual([newer.id, older.id]);
    expect(list.rows[0]).toMatchObject({ status: "DRAFT", sourceCount: 2 });
    expect(list.rows[1]).toMatchObject({
      status: "FAILED",
      failureCode: "PROVIDER",
      sourceCount: 1,
    });
  });

  it("a plain member is refused by every action and loader, with no data", async () => {
    const { orgId, owner, member } = await seedOrg();
    const ticket = await seedResolvedTicket(orgId);
    const draft = await seedProposal(orgId, { status: "DRAFT", ticketIds: [ticket.id] });
    const published = await seedProposal(orgId, { status: "PUBLISHED", ticketIds: [ticket.id] });
    const generating = await seedProposal(orgId, {
      status: "GENERATING",
      ticketIds: [ticket.id],
      generationQueuedAt: new Date(Date.now() - 3_600_000),
    });
    env.actor = member;

    expect(await requestProposalAction([ticket.id])).toEqual({ ok: false, code: "NOT_ALLOWED" });
    expect(await loadStartSelectionAction([ticket.id])).toEqual({ kind: "NOT_ALLOWED" });
    expect(
      await saveProposalAction({
        proposalId: draft.id,
        expectedVersion: 0,
        title: "A valid title",
        bodyMarkdown: "A valid body",
      }),
    ).toEqual({ ok: false, code: "NOT_ALLOWED" });
    expect(await rejectProposalAction({ proposalId: draft.id, expectedVersion: 0 })).toEqual({
      ok: false,
      code: "NOT_ALLOWED",
    });
    expect(await publishProposalAction({ proposalId: draft.id, expectedVersion: 0 })).toEqual({
      ok: false,
      code: "NOT_ALLOWED",
    });
    expect(
      await restartGenerationAction({ proposalId: generating.id, expectedVersion: 0 }),
    ).toEqual({ ok: false, code: "NOT_ALLOWED" });
    expect(await retryIndexingAction({ proposalId: published.id })).toEqual({
      ok: false,
      code: "NOT_ALLOWED",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(proposalSends()).toHaveLength(0);

    expect(await loadProposalList(member)).toEqual({ kind: "NOT_ALLOWED" });
    expect(await loadProposalReview(member, draft.id)).toEqual({ kind: "NOT_ALLOWED" });
    expect(await loadStartSelection(member, [ticket.id])).toEqual({ kind: "NOT_ALLOWED" });

    // Nothing changed: the draft is still a draft at version 0, no proposal was added.
    const stored = await prisma.kbProposal.findUnique({
      where: { id: draft.id },
      select: { status: true, version: true },
    });
    expect(stored).toEqual({ status: "DRAFT", version: 0 });
    expect(await prisma.kbProposal.count({ where: { organizationId: orgId } })).toBe(3);
    const ownerList = await loadProposalList(owner);
    expect(ownerList.kind).toBe("ok");
  });

  it("a member whose row was deleted gets MEMBERSHIP_ENDED from every action and loader", async () => {
    const { orgId, removed } = await seedOrg();
    const ticket = await seedResolvedTicket(orgId);
    const draft = await seedProposal(orgId, { status: "DRAFT", ticketIds: [ticket.id] });
    const published = await seedProposal(orgId, { status: "PUBLISHED", ticketIds: [ticket.id] });
    env.actor = removed;

    const ended = { ok: false, code: "MEMBERSHIP_ENDED" };
    expect(await requestProposalAction([ticket.id])).toEqual(ended);
    expect(await loadStartSelectionAction([ticket.id])).toEqual({ kind: "MEMBERSHIP_ENDED" });
    expect(
      await saveProposalAction({
        proposalId: draft.id,
        expectedVersion: 0,
        title: "A valid title",
        bodyMarkdown: "A valid body",
      }),
    ).toEqual(ended);
    expect(await rejectProposalAction({ proposalId: draft.id, expectedVersion: 0 })).toEqual(ended);
    expect(await publishProposalAction({ proposalId: draft.id, expectedVersion: 0 })).toEqual(
      ended,
    );
    expect(await restartGenerationAction({ proposalId: draft.id, expectedVersion: 0 })).toEqual(
      ended,
    );
    expect(await retryIndexingAction({ proposalId: published.id })).toEqual(ended);
    expect(revalidatePath).not.toHaveBeenCalled();

    expect(await loadProposalList(removed)).toEqual({ kind: "MEMBERSHIP_ENDED" });
    expect(await loadProposalReview(removed, draft.id)).toEqual({ kind: "MEMBERSHIP_ENDED" });
    expect(await loadStartSelection(removed, [ticket.id])).toEqual({ kind: "MEMBERSHIP_ENDED" });
  });

  it("loadProposalReview gives NOT_FOUND for another organization's id and for an unknown id", async () => {
    const mine = await seedOrg();
    const other = await seedOrg();
    const otherTicket = await seedResolvedTicket(other.orgId);
    const foreign = await seedProposal(other.orgId, {
      status: "DRAFT",
      ticketIds: [otherTicket.id],
    });

    expect(await loadProposalReview(mine.owner, foreign.id)).toEqual({ kind: "NOT_FOUND" });
    expect(await loadProposalReview(mine.owner, `missing-${randomUUID()}`)).toEqual({
      kind: "NOT_FOUND",
    });
    expect(await loadProposalReview(mine.owner, "")).toEqual({ kind: "NOT_FOUND" });
    // The foreign proposal is readable by its own organization.
    expect((await loadProposalReview(other.owner, foreign.id)).kind).toBe("ok");
  });

  it("loadStartSelection lists the organization's tickets in the given order and omits another organization's", async () => {
    const mine = await seedOrg();
    const other = await seedOrg();
    const first = await seedResolvedTicket(mine.orgId);
    const second = await seedResolvedTicket(mine.orgId, { status: "OPEN" });
    const foreign = await seedResolvedTicket(other.orgId);

    const result = await loadStartSelection(mine.owner, [second.id, foreign.id, first.id]);

    if (result.kind !== "ok") throw new Error(`expected ok, got ${result.kind}`);
    expect(result.tickets.map((ticket) => ticket.id)).toEqual([second.id, first.id]);
    expect(result.tickets[0]).toEqual({
      id: second.id,
      number: second.number,
      subject: expect.any(String),
      stateName: expect.any(String),
      colorToken: expect.any(String),
      mergedInto: null,
    });

    env.actor = mine.owner;
    const viaAction = await loadStartSelectionAction([foreign.id]);
    expect(viaAction).toEqual({ kind: "ok", tickets: [] });
  });
});

describe("review C6: revalidation never changes a committed result; a thrown service error is UNKNOWN", () => {
  it("a revalidation error after a committed request still returns ok with the proposal id", async () => {
    const { orgId, owner } = await seedOrg();
    const ticket = await seedResolvedTicket(orgId);
    env.actor = owner;
    revalidatePath.mockImplementationOnce(() => {
      throw new Error("revalidation exploded (test double)");
    });

    const result = await requestProposalAction([ticket.id]);

    expect(result).toEqual({ ok: true, proposalId: expect.any(String) });
    if (!result.ok) throw new Error("unreachable");
    const stored = await prisma.kbProposal.findUnique({
      where: { id: result.proposalId },
      select: { status: true, organizationId: true },
    });
    expect(stored).toEqual({ status: "GENERATING", organizationId: orgId });
    expect(sendsOn(KB_PROPOSAL_GENERATE_QUEUE)).toHaveLength(1);
    // The failing path did not stop the second one.
    expect(revalidatePath).toHaveBeenCalledTimes(2);
  });

  it("a revalidation error after a publish still returns ok with exactly one article", async () => {
    const { orgId, owner } = await seedOrg();
    const ticket = await seedResolvedTicket(orgId);
    const draft = await seedProposal(orgId, { status: "DRAFT", ticketIds: [ticket.id] });
    env.actor = owner;
    revalidatePath.mockImplementationOnce(() => {
      throw new Error("revalidation exploded (test double)");
    });

    const result = await publishProposalAction({ proposalId: draft.id, expectedVersion: 0 });

    expect(result).toEqual({ ok: true, articleId: expect.any(String), indexingQueued: true });
    if (!result.ok) throw new Error("unreachable");
    const stored = await prisma.kbProposal.findUnique({
      where: { id: draft.id },
      select: { status: true, publishedArticleId: true },
    });
    expect(stored).toEqual({ status: "PUBLISHED", publishedArticleId: result.articleId });
    expect(await prisma.kbArticle.count({ where: { organizationId: orgId } })).toBe(1);
    expect(sendsOn("kb-embed-article")).toHaveLength(1);
  });

  it("a request service that throws gives { ok: false, code: 'UNKNOWN' } without the error's message", async () => {
    const { orgId, owner } = await seedOrg();
    const ticket = await seedResolvedTicket(orgId);
    env.actor = owner;
    const marker = `SECRET-MARKER-${randomUUID()}`;
    requestEnv.throwOnce = new Error(`database said ${marker}`);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const result = await requestProposalAction([ticket.id]);

      expect(result).toEqual({ ok: false, code: "UNKNOWN" });
      expect(JSON.stringify(result)).not.toContain(marker);
      expect(JSON.stringify(errors.mock.calls)).not.toContain(marker);
    } finally {
      errors.mockRestore();
    }
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(proposalSends()).toHaveLength(0);
    expect(await prisma.kbProposal.count({ where: { organizationId: orgId } })).toBe(0);
  });

  it("a session read that throws gives UNKNOWN from every action", async () => {
    env.actor = null;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const unknown = { ok: false, code: "UNKNOWN" };
      expect(await requestProposalAction(["x"])).toEqual(unknown);
      expect(await loadStartSelectionAction(["x"])).toEqual(unknown);
      expect(
        await saveProposalAction({
          proposalId: "x",
          expectedVersion: 0,
          title: "A valid title",
          bodyMarkdown: "A valid body",
        }),
      ).toEqual(unknown);
      expect(await rejectProposalAction({ proposalId: "x", expectedVersion: 0 })).toEqual(unknown);
      expect(await publishProposalAction({ proposalId: "x", expectedVersion: 0 })).toEqual(unknown);
      expect(await restartGenerationAction({ proposalId: "x", expectedVersion: 0 })).toEqual(
        unknown,
      );
      expect(await retryIndexingAction({ proposalId: "x" })).toEqual(unknown);
      expect(JSON.stringify(errors.mock.calls)).not.toContain("no session");
    } finally {
      errors.mockRestore();
    }
  });

  // Review b-WR-01: requireSession() redirects to /login by throwing Next's NEXT_REDIRECT error,
  // and notFound() throws NEXT_HTTP_ERROR_FALLBACK. Both are framework control flow: every action
  // rethrows them (unstable_rethrow) instead of mapping them to UNKNOWN, so the browser is sent to
  // sign in rather than shown "The result is not known". The errors here are the real ones that
  // next/navigation throws.
  it("a Next redirect or not-found thrown by the session read is rethrown by every action, never UNKNOWN (review b-WR-01)", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const thrown of [thrownBy(() => redirect("/login")), thrownBy(() => notFound())]) {
        env.sessionThrows = thrown;
        await expect(requestProposalAction(["x"])).rejects.toBe(thrown);
        await expect(loadStartSelectionAction(["x"])).rejects.toBe(thrown);
        await expect(
          saveProposalAction({
            proposalId: "x",
            expectedVersion: 0,
            title: "A valid title",
            bodyMarkdown: "A valid body",
          }),
        ).rejects.toBe(thrown);
        await expect(rejectProposalAction({ proposalId: "x", expectedVersion: 0 })).rejects.toBe(
          thrown,
        );
        await expect(publishProposalAction({ proposalId: "x", expectedVersion: 0 })).rejects.toBe(
          thrown,
        );
        await expect(restartGenerationAction({ proposalId: "x", expectedVersion: 0 })).rejects.toBe(
          thrown,
        );
        await expect(retryIndexingAction({ proposalId: "x" })).rejects.toBe(thrown);
      }
      // Nothing was logged as a failed action: the control flow is not an error of the action.
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("a Next redirect thrown inside the service, or as the cause of an error, is rethrown too (review b-WR-01)", async () => {
    const { orgId, owner } = await seedOrg();
    const ticket = await seedResolvedTicket(orgId);
    env.actor = owner;
    const thrown = thrownBy(() => redirect("/login"));
    requestEnv.throwOnce = thrown as Error;

    await expect(requestProposalAction([ticket.id])).rejects.toBe(thrown);
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(await prisma.kbProposal.count({ where: { organizationId: orgId } })).toBe(0);

    // A redirect wrapped as the cause of another error is control flow as well.
    const wrapped = new Error("wrapper", { cause: thrownBy(() => redirect("/login")) });
    requestEnv.throwOnce = wrapped;
    await expect(requestProposalAction([ticket.id])).rejects.toBe(wrapped.cause);
  });

  it("a reject revalidates /kb, whose Proposals link counts drafts, as publish does (review b-IN-06)", async () => {
    const { orgId, owner } = await seedOrg();
    const ticket = await seedResolvedTicket(orgId);
    const draft = await seedProposal(orgId, { status: "DRAFT", ticketIds: [ticket.id] });
    env.actor = owner;

    expect(await rejectProposalAction({ proposalId: draft.id, expectedVersion: 0 })).toEqual({
      ok: true,
    });
    const paths = revalidatePath.mock.calls.map((call) => call[0]);
    expect(paths).toEqual(["/kb/proposals", `/kb/proposals/${draft.id}`, "/kb"]);
  });

  it("restart and retry pass queued through, save passes the new version and a field refusal its field", async () => {
    const { orgId, owner } = await seedOrg();
    const ticket = await seedResolvedTicket(orgId);
    const draft = await seedProposal(orgId, { status: "DRAFT", ticketIds: [ticket.id] });
    const published = await seedProposal(orgId, { status: "PUBLISHED", ticketIds: [ticket.id] });
    const stuck = await seedProposal(orgId, {
      status: "GENERATING",
      ticketIds: [ticket.id],
      generationQueuedAt: new Date(Date.now() - 3_600_000),
    });
    env.actor = owner;

    expect(
      await saveProposalAction({
        proposalId: draft.id,
        expectedVersion: 0,
        title: "x",
        bodyMarkdown: "A valid body",
      }),
    ).toEqual({ ok: false, code: "TITLE_TOO_SHORT", field: "title" });
    expect(
      await saveProposalAction({
        proposalId: draft.id,
        expectedVersion: 0,
        title: "A valid title",
        bodyMarkdown: "A valid body",
      }),
    ).toEqual({ ok: true, version: 1 });
    expect(await restartGenerationAction({ proposalId: stuck.id, expectedVersion: 0 })).toEqual({
      ok: true,
      queued: true,
    });
    expect(await retryIndexingAction({ proposalId: published.id })).toEqual({
      ok: true,
      queued: true,
    });
    expect(await rejectProposalAction({ proposalId: draft.id, expectedVersion: 1 })).toEqual({
      ok: true,
    });
  });
});

describe("loadProposalReview: review fields (D-08, reviews C2, C5, P1)", () => {
  it("returns sources in position order with chip data, citations, changes, names, stuck and AI state", async () => {
    const { orgId, owner } = await seedOrg();
    const a = await seedResolvedTicket(orgId);
    const b = await seedResolvedTicket(orgId);
    const requester = await prisma.user.findUniqueOrThrow({
      where: { id: owner.userId },
      select: { name: true },
    });
    const draft = await seedProposal(orgId, {
      status: "DRAFT",
      ticketIds: [b.id, a.id],
      requestedByUserId: owner.userId,
      citedSections: [["Steps"], []],
      inputTruncated: true,
    });

    const result = await loadProposalReview(owner, draft.id);

    if (result.kind !== "ok") throw new Error(`expected ok, got ${result.kind}`);
    const { proposal } = result;
    expect(proposal).toMatchObject({
      id: draft.id,
      status: "DRAFT",
      version: 0,
      inputTruncated: true,
      requestedByName: requester.name,
      rejectedByName: null,
      publishedByName: null,
      aiEnabled: true,
      stuck: false,
      article: null,
    });
    expect(proposal.sources.map((source) => [source.position, source.ticketId])).toEqual([
      [1, b.id],
      [2, a.id],
    ]);
    expect(proposal.sources[0]).toMatchObject({
      citedSections: ["Steps"],
      unavailable: false,
      ticket: { number: b.number, subject: expect.any(String), stateName: expect.any(String) },
    });
    // A null snapshot with a PUBLIC message now counts as changed (seedTicket writes one).
    expect(proposal.changedSourceNumbers).toEqual([b.number, a.number]);
    expect(proposal.sources.every((source) => source.changed)).toBe(true);
  });

  it("isStuck counts from generationQueuedAt while no job holds the lease (review C5)", async () => {
    const { orgId, owner } = await seedOrg();
    const ticket = await seedResolvedTicket(orgId);
    const queuedAt = new Date("2026-11-09T10:00:00Z");
    const generating = await seedProposal(orgId, {
      status: "GENERATING",
      ticketIds: [ticket.id],
      generationQueuedAt: queuedAt,
      createdAt: new Date("2026-11-01T10:00:00Z"),
    });

    const early = await loadProposalReview(owner, generating.id, {
      now: new Date(queuedAt.getTime() + 60_000),
    });
    const late = await loadProposalReview(owner, generating.id, {
      now: new Date(queuedAt.getTime() + 600_000),
    });

    if (early.kind !== "ok" || late.kind !== "ok") throw new Error("expected ok");
    expect(early.proposal.stuck).toBe(false);
    expect(late.proposal.stuck).toBe(true);
    expect(early.proposal.changedSourceNumbers).toEqual([]);
  });

  it("a published proposal carries its article id and the stored embeddingStatus (review C2)", async () => {
    const { orgId, owner } = await seedOrg();
    const ticket = await seedResolvedTicket(orgId);
    const published = await seedProposal(orgId, { status: "PUBLISHED", ticketIds: [ticket.id] });
    if (!published.publishedArticleId) throw new Error("fixture has no article");

    const pending = await loadProposalReview(owner, published.id);
    await prisma.kbArticle.update({
      where: { id: published.publishedArticleId },
      data: { embeddingStatus: "FAILED" },
    });
    const failed = await loadProposalReview(owner, published.id);

    if (pending.kind !== "ok" || failed.kind !== "ok") throw new Error("expected ok");
    expect(pending.proposal.article).toEqual({
      id: published.publishedArticleId,
      embeddingStatus: "PENDING",
    });
    expect(failed.proposal.article?.embeddingStatus).toBe("FAILED");
    // The fixture's publisher id has no user row: the name is omitted (null).
    expect(pending.proposal.publishedByName).toBeNull();
  });
});

describe("review P3: no snapshotSeq key and no bigint at any depth of a loader result", () => {
  it("a DRAFT with snapshotSeq 9007199254740993n, a PUBLISHED proposal and the list carry neither", async () => {
    const { orgId, owner } = await seedOrg();
    const a = await seedResolvedTicket(orgId);
    const b = await seedResolvedTicket(orgId);
    const draft = await seedProposal(orgId, {
      status: "DRAFT",
      ticketIds: [a.id, b.id],
      snapshotSeqs: [SNAPSHOT_ABOVE_2_53, SNAPSHOT_ABOVE_2_53],
      citedSections: [["Steps"], ["Cause"]],
    });
    const published = await seedProposal(orgId, {
      status: "PUBLISHED",
      ticketIds: [a.id],
      snapshotSeqs: [SNAPSHOT_ABOVE_2_53],
    });
    const stored = await prisma.kbProposalSource.findMany({
      where: { proposalId: draft.id },
      select: { snapshotSeq: true },
    });
    expect(stored.map((row) => row.snapshotSeq)).toEqual([
      SNAPSHOT_ABOVE_2_53,
      SNAPSHOT_ABOVE_2_53,
    ]);
    expect(typeof stored[0].snapshotSeq).toBe("bigint");

    const draftReview = await loadProposalReview(owner, draft.id);
    const publishedReview = await loadProposalReview(owner, published.id);
    const list = await loadProposalList(owner);
    const selection = await loadStartSelection(owner, [a.id, b.id]);

    for (const result of [draftReview, publishedReview, list, selection]) {
      expect(result.kind).toBe("ok");
      expect(findForbidden(result)).toEqual([]);
    }
    if (draftReview.kind !== "ok") throw new Error("unreachable");
    // The stored snapshots are above every seeded PUBLIC seq: nothing changed.
    expect(draftReview.proposal.changedSourceNumbers).toEqual([]);
    expect(draftReview.proposal.sources).toHaveLength(2);
  });

  it("the walker itself finds a nested bigint and a nested snapshotSeq key", () => {
    const sample = {
      list: [{ deep: new Map([["k", new Set([1n])]]) }],
      nested: { snapshotSeq: null },
      when: new Date(),
    };
    const found = findForbidden(sample);
    expect(found.some((entry) => entry.endsWith(": bigint"))).toBe(true);
    expect(found).toContain("$.nested.snapshotSeq");
  });
});
