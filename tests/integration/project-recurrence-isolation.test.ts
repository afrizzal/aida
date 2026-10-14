// Phase 14 recurrence isolation (contract section 17, Isolation class TARGET, review C5, K69) on
// a real Postgres through Testcontainers. setTaskRecurrence, clearTaskRecurrence and setTaskStatus
// completing a recurring task are called by each actor of the privacy world on a private project:
// manager and member succeed; teamMember (team only, refused under K69), nonMember, orgAdmin and
// outsider get a result deep-equal to the call with missingId() and no successor appears; the
// outsider with organization A gets MEMBERSHIP_ENDED; refused calls change no row and add no
// activity.
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { fromCalendarDate } from "@/lib/projects/contract";
import { clearTaskRecurrence, setTaskRecurrence } from "@/lib/projects/recurrence";
import { setTaskStatus } from "@/lib/projects/tasks";
import {
  actorOf,
  missingId,
  type PrivacyWorld,
  projectTableSnapshot,
  seedPrivacyWorld,
  seedTask,
} from "../support/project-fixtures";

const ENDED = { ok: false, code: "MEMBERSHIP_ENDED" };
const NOW = new Date("2026-03-15T12:00:00Z");

function refused(pw: PrivacyWorld) {
  return [pw.actors.teamMember, pw.actors.nonMember, pw.actors.orgAdmin, pw.actors.outsider];
}

function endedOutsider(pw: PrivacyWorld) {
  return actorOf(pw.users.outsider, pw.orgA);
}

function activityCount(orgId: string): Promise<number> {
  return prisma.projectActivity.count({ where: { organizationId: orgId } });
}

/** The privacy world with pw.task and a second top-level task both recurring DAILY. */
async function recurringWorld() {
  const pw = await seedPrivacyWorld(prisma);
  await prisma.task.updateMany({
    where: { id: pw.task.id, organizationId: pw.orgA },
    data: {
      recurrenceRule: "DAILY",
      recurrenceAnchor: fromCalendarDate("2026-03-01"),
      recurrenceTimeZone: "UTC",
    },
  });
  const second = await seedTask(prisma, pw.orgA, pw.project.id, {
    dueDate: "2026-03-20",
    recurrence: { rule: "WEEKLY", anchor: "2026-03-20", timeZone: "UTC" },
  });
  return { pw, second };
}

function successorCount(orgId: string): Promise<number> {
  return prisma.task.count({
    where: { organizationId: orgId, recurrencePredecessorId: { not: null } },
  });
}

describe("setTaskRecurrence isolation", () => {
  it("only project members set a rule; refused calls change no row and add no activity", async () => {
    const pw = await seedPrivacyWorld(prisma);
    const input = { rule: "DAILY" as const, anchorDate: "2026-03-01" };
    const snapshot = await projectTableSnapshot(prisma, pw.orgA);
    const count = await activityCount(pw.orgA);
    for (const actor of refused(pw)) {
      expect(await setTaskRecurrence(actor, pw.task.id, 0, input, { now: NOW })).toEqual(
        await setTaskRecurrence(actor, missingId(), 0, input, { now: NOW }),
      );
      expect(await projectTableSnapshot(prisma, pw.orgA)).toEqual(snapshot);
      expect(await activityCount(pw.orgA)).toBe(count);
    }
    expect(await setTaskRecurrence(endedOutsider(pw), pw.task.id, 0, input, { now: NOW })).toEqual(
      ENDED,
    );
    expect(await projectTableSnapshot(prisma, pw.orgA)).toEqual(snapshot);
    expect(await activityCount(pw.orgA)).toBe(count);
    expect(await setTaskRecurrence(pw.actors.member, pw.task.id, 0, input, { now: NOW })).toEqual({
      ok: true,
      changed: true,
      version: 1,
    });
    expect(
      await setTaskRecurrence(pw.actors.manager, pw.task.id, 1, { rule: "WEEKLY" }, { now: NOW }),
    ).toEqual({ ok: true, changed: true, version: 2 });
    const row = await prisma.projectActivity.findFirst({
      where: { organizationId: pw.orgA, verb: "TASK_UPDATED", entityId: pw.task.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    expect(row?.verb).toBe("TASK_UPDATED");
  });
});

describe("clearTaskRecurrence isolation", () => {
  it("only project members clear a rule; refused calls change no row and add no activity", async () => {
    const { pw, second } = await recurringWorld();
    const snapshot = await projectTableSnapshot(prisma, pw.orgA);
    const count = await activityCount(pw.orgA);
    for (const actor of refused(pw)) {
      expect(await clearTaskRecurrence(actor, pw.task.id, 0)).toEqual(
        await clearTaskRecurrence(actor, missingId(), 0),
      );
      expect(await projectTableSnapshot(prisma, pw.orgA)).toEqual(snapshot);
      expect(await activityCount(pw.orgA)).toBe(count);
    }
    expect(await clearTaskRecurrence(endedOutsider(pw), pw.task.id, 0)).toEqual(ENDED);
    expect(await projectTableSnapshot(prisma, pw.orgA)).toEqual(snapshot);
    expect(await activityCount(pw.orgA)).toBe(count);
    expect(await clearTaskRecurrence(pw.actors.member, pw.task.id, 0)).toEqual({
      ok: true,
      changed: true,
      version: 1,
    });
    expect(await clearTaskRecurrence(pw.actors.manager, second.id, 0)).toEqual({
      ok: true,
      changed: true,
      version: 1,
    });
    expect(
      await prisma.projectActivity.count({
        where: { organizationId: pw.orgA, verb: "TASK_UPDATED" },
      }),
    ).toBe(2);
  });
});

describe("setTaskStatus completing a recurring task isolation", () => {
  it("only project members complete it; refused calls create no successor, change no row and add no activity", async () => {
    const { pw, second } = await recurringWorld();
    const snapshot = await projectTableSnapshot(prisma, pw.orgA);
    const count = await activityCount(pw.orgA);
    for (const actor of refused(pw)) {
      expect(await setTaskStatus(actor, pw.task.id, 0, "DONE", { now: NOW })).toEqual(
        await setTaskStatus(actor, missingId(), 0, "DONE", { now: NOW }),
      );
      expect(await projectTableSnapshot(prisma, pw.orgA)).toEqual(snapshot);
      expect(await activityCount(pw.orgA)).toBe(count);
    }
    expect(await setTaskStatus(endedOutsider(pw), pw.task.id, 0, "DONE", { now: NOW })).toEqual(
      ENDED,
    );
    expect(await projectTableSnapshot(prisma, pw.orgA)).toEqual(snapshot);
    expect(await activityCount(pw.orgA)).toBe(count);
    expect(await successorCount(pw.orgA)).toBe(0);

    expect(await setTaskStatus(pw.actors.member, pw.task.id, 0, "DONE", { now: NOW })).toEqual({
      ok: true,
      changed: true,
      version: 1,
    });
    expect(await setTaskStatus(pw.actors.manager, second.id, 0, "DONE", { now: NOW })).toEqual({
      ok: true,
      changed: true,
      version: 1,
    });
    expect(await successorCount(pw.orgA)).toBe(2);
    const recurred = await prisma.projectActivity.findMany({
      where: { organizationId: pw.orgA, verb: "TASK_RECURRED" },
      select: { verb: true, actorUserId: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    expect(recurred.map((r) => r.verb)).toEqual(["TASK_RECURRED", "TASK_RECURRED"]);
    expect(recurred.map((r) => r.actorUserId).sort()).toEqual(
      [pw.users.member, pw.users.manager].sort(),
    );
  });
});
