// AIDA-55 / D-18: the ticket page's activity feed is read through scopedDb after the membership
// check, and names only members of the ticket's organization. Real Postgres through
// Testcontainers; nothing is mocked.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { type ActivityEventInput, describeEvent, partsToText } from "@/lib/tickets/activity-copy";
import { createTicket } from "@/lib/tickets/create-ticket";
import { recordTicketAudit } from "@/lib/tickets/ticket-audit";
import { loadTicketDetailData } from "@/lib/tickets/ticket-detail-data";
import { seedOrgWithMembers } from "../support/inbox-fixtures";

async function seedTicket(orgId: string, label: string) {
  return createTicket(orgId, {
    subject: `Feed ${label} ${randomUUID()}`,
    priority: "NORMAL",
    body: `Feed body ${label}`,
    contact: { email: `feed-${label}-${randomUUID()}@example.test` },
    direction: "INBOUND",
  });
}

async function feedTexts(userId: string, orgId: string, ticketId: string) {
  const data = await loadTicketDetailData(prisma, { userId, orgId }, ticketId);
  if (data.status !== "ok") throw new Error(`expected ok, got ${data.status}`);
  const context = { ticketId, ...data.feedReferences };
  return {
    data,
    texts: data.feed
      .filter((item) => item.kind === "event")
      .map((item) =>
        item.kind === "event"
          ? partsToText(describeEvent(item.event as ActivityEventInput, context).parts)
          : "",
      ),
  };
}

describe("activity feed: organization scope and name resolution (D-18)", () => {
  it("excludes another organization's audit row that carries the same ticketId", async () => {
    const a = await seedOrgWithMembers(prisma, ["owner"]);
    const b = await seedOrgWithMembers(prisma, ["owner"]);
    const ticket = await seedTicket(a.orgId, "scope");
    await recordTicketAudit(prisma, a.orgId, {
      ticketId: ticket.id,
      action: "STATUS_CHANGED",
      before: { status: "NEW" },
      after: { status: "OPEN" },
      actorType: "USER",
      actorUserId: a.users[0].id,
    });
    const foreign = await recordTicketAudit(prisma, b.orgId, {
      ticketId: ticket.id,
      action: "PRIORITY_CHANGED",
      before: { priority: "LOW" },
      after: { priority: "URGENT" },
      actorType: "USER",
      actorUserId: b.users[0].id,
    });

    const { data, texts } = await feedTexts(a.users[0].id, a.orgId, ticket.id);
    expect(data.feed.some((item) => item.id === foreign.id)).toBe(false);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toMatch(/changed the status from New to Open\.$/);
    expect(data.feed[0].kind).toBe("message");
  });

  it("shows an actor who is a member of another organization only as a former member", async () => {
    const a = await seedOrgWithMembers(prisma, ["owner"]);
    const b = await seedOrgWithMembers(prisma, ["owner"]);
    const ticket = await seedTicket(a.orgId, "foreign-actor");
    await recordTicketAudit(prisma, a.orgId, {
      ticketId: ticket.id,
      action: "WOKEN",
      before: { snoozedUntil: new Date().toISOString() },
      after: { snoozedUntil: null },
      actorType: "USER",
      actorUserId: b.users[0].id,
    });
    const outsider = await prisma.user.findUniqueOrThrow({ where: { id: b.users[0].id } });

    const { data, texts } = await feedTexts(a.users[0].id, a.orgId, ticket.id);
    expect(texts).toEqual(["A former member woke this ticket."]);
    expect(data.feedReferences.members).not.toHaveProperty(b.users[0].id);
    expect(JSON.stringify(data.feedReferences)).not.toContain(outsider.name);
  });

  it("shows a removed member's row as a former member, and names a current member", async () => {
    const a = await seedOrgWithMembers(prisma, ["owner", "member"]);
    const [owner, leaver] = a.users;
    const ticket = await seedTicket(a.orgId, "removed");
    for (const actorUserId of [owner.id, leaver.id]) {
      await recordTicketAudit(prisma, a.orgId, {
        ticketId: ticket.id,
        action: "ASSIGNEE_CHANGED",
        before: { assigneeId: null },
        after: { assigneeId: null },
        actorType: "USER",
        actorUserId,
      });
    }
    await prisma.member.delete({ where: { id: leaver.memberId } });
    const ownerRow = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });

    const { texts } = await feedTexts(owner.id, a.orgId, ticket.id);
    expect(texts).toContain(`${ownerRow.name} removed the assignee.`);
    expect(texts).toContain("A former member removed the assignee.");
  });

  it("resolves a deleted tag and an unreadable ticket to their markers", async () => {
    const a = await seedOrgWithMembers(prisma, ["owner"]);
    const b = await seedOrgWithMembers(prisma, ["owner"]);
    const ticket = await seedTicket(a.orgId, "markers");
    const foreignTicket = await seedTicket(b.orgId, "foreign");
    const tag = await prisma.tag.create({
      data: { organizationId: a.orgId, name: `gone-${randomUUID()}` },
    });
    const actor = { actorType: "USER" as const, actorUserId: a.users[0].id };
    await recordTicketAudit(prisma, a.orgId, {
      ticketId: ticket.id,
      action: "TAG_ADDED",
      before: { tagId: tag.id, present: false },
      after: { tagId: tag.id, present: true },
      ...actor,
    });
    await prisma.tag.delete({ where: { id: tag.id } });
    await recordTicketAudit(prisma, a.orgId, {
      ticketId: ticket.id,
      action: "RELATION_ADDED",
      before: {},
      after: {
        relationId: randomUUID(),
        type: "RELATED_TO",
        fromTicketId: ticket.id,
        toTicketId: foreignTicket.id,
      },
      ...actor,
    });

    const { data, texts } = await feedTexts(a.users[0].id, a.orgId, ticket.id);
    expect(texts.some((t) => t.endsWith("added the tag a deleted tag."))).toBe(true);
    expect(
      texts.some((t) =>
        t.endsWith("added a link: Related to a ticket that is no longer available."),
      ),
    ).toBe(true);
    expect(data.feedReferences.tickets).not.toHaveProperty(foreignTicket.id);
  });

  it("refuses a removed member viewing the page (membership_ended, no feed)", async () => {
    const a = await seedOrgWithMembers(prisma, ["owner", "member"]);
    const ticket = await seedTicket(a.orgId, "refused");
    await prisma.member.delete({ where: { id: a.users[1].memberId } });
    const result = await loadTicketDetailData(
      prisma,
      { userId: a.users[1].id, orgId: a.orgId },
      ticket.id,
    );
    expect(result).toEqual({ status: "membership_ended" });
  });
});

// Phase 12.1 (D-11 Feed row as amended by K42, UI-SPEC Surface 7; T-12.1-47): state rows read the
// state's current name in the ticket's organization, a soft-deleted state keeps its name with the
// marker, and another organization's state never lends its name. The rename and the soft delete
// are direct prisma updates (the admin service is plan 12.1-08's).
describe("activity feed: state names over renames and deletions (Phase 12.1)", () => {
  it("shows the renamed target and the soft-deleted source with the marker", async () => {
    const { runTicketMutation } = await import("@/lib/tickets/mutations");
    const a = await seedOrgWithMembers(prisma, ["owner"]);
    const marker = randomUUID().slice(0, 8);
    const ticket = await seedTicket(a.orgId, "states");
    const source = await prisma.ticketState.create({
      data: {
        organizationId: a.orgId,
        name: `Waiting on vendor ${marker}`,
        colorToken: "amber",
        group: "PENDING",
        sortOrder: 9,
      },
    });
    const target = await prisma.ticketState.create({
      data: {
        organizationId: a.orgId,
        name: `Triage ${marker}`,
        colorToken: "blue",
        group: "OPEN",
        sortOrder: 9,
      },
    });
    const actor = { orgId: a.orgId, userId: a.users[0].id };
    for (const stateId of [source.id, target.id]) {
      const result = await runTicketMutation({
        actor,
        ticketIds: [ticket.id],
        op: { kind: "state", stateId },
        mode: "single",
      });
      expect(result).toMatchObject({ ok: true, count: 1 });
    }
    await prisma.ticketState.update({
      where: { id: target.id },
      data: { name: `Triage renamed ${marker}` },
    });
    await prisma.ticketState.update({ where: { id: source.id }, data: { deletedAt: new Date() } });

    const { data, texts } = await feedTexts(a.users[0].id, a.orgId, ticket.id);
    expect(data.feedReferences.states[source.id]).toEqual({
      name: `Waiting on vendor ${marker}`,
      deleted: true,
    });
    const last = texts.at(-1) ?? "";
    expect(last).toContain(
      `changed the status from Waiting on vendor ${marker} (deleted status) to Triage renamed ${marker}.`,
    );
    expect(texts.join("\n")).not.toContain(`Triage ${marker}.`);
  });

  it("a state id of another organization renders as 'a deleted status', never its name", async () => {
    const a = await seedOrgWithMembers(prisma, ["owner"]);
    const b = await seedOrgWithMembers(prisma, ["owner"]);
    const marker = randomUUID().slice(0, 8);
    const ticket = await seedTicket(a.orgId, "foreign-state");
    const foreign = await prisma.ticketState.create({
      data: {
        organizationId: b.orgId,
        name: `Foreign state ${marker}`,
        colorToken: "red",
        group: "OPEN",
        sortOrder: 9,
      },
    });
    const own = await prisma.ticketState.findFirstOrThrow({
      where: { organizationId: a.orgId, group: "RESOLVED", deletedAt: null },
    });
    await recordTicketAudit(prisma, a.orgId, {
      ticketId: ticket.id,
      action: "STATUS_CHANGED",
      before: { stateId: foreign.id, stateGroup: "OPEN" },
      after: { stateId: own.id, stateGroup: "RESOLVED" },
      actorType: "USER",
      actorUserId: a.users[0].id,
    });
    const { data, texts } = await feedTexts(a.users[0].id, a.orgId, ticket.id);
    expect(Object.hasOwn(data.feedReferences.states, foreign.id)).toBe(false);
    expect(texts.at(-1)).toContain(`changed the status from a deleted status to ${own.name}.`);
    // The ticket row carries a BigInt (slaPausedMs), so the replacer turns it into text.
    const serialized = JSON.stringify(data, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    );
    expect(serialized).not.toContain(`Foreign state ${marker}`);
  });
});
