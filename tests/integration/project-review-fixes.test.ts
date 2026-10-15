// Phase 14 code review fixes, batch F1 (14-REVIEW.md dispositions), on a real Postgres through
// Testcontainers. Each describe names the finding it proves. Every case seeds fresh organizations.
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { listProjectActivity } from "@/lib/projects/activity";
import { bulkUpdateTasks } from "@/lib/projects/bulk";
import { setProjectMemberRole } from "@/lib/projects/members";
import {
  createProject,
  getProject,
  listProjects,
  moveProjectPosition,
  setProjectPrivacy,
  setProjectStatus,
  updateProject,
} from "@/lib/projects/projects";
import { createTask, getTask, updateTask } from "@/lib/projects/tasks";
import {
  actorOf,
  addOrgMember,
  projectTableSnapshot,
  removeOrgMember,
  seedLabel,
  seedOrgWithMembers,
  seedProject,
  seedTask,
} from "../support/project-fixtures";

async function managerWorld() {
  const org = await seedOrgWithMembers(prisma, ["owner", "member"]);
  const managerId = org.users[1]?.id as string;
  const manager = actorOf(managerId, org.orgId);
  const project = await seedProject(prisma, org.orgId, {
    createdByUserId: managerId,
    managerUserIds: [managerId],
  });
  return { org, orgId: org.orgId, managerId, manager, project };
}

describe("a-WR-05, b-WR-02: descriptions are stored as the trimmed text that was validated", () => {
  it("a project description at the limit plus surrounding whitespace is accepted and stored trimmed", async () => {
    const w = await managerWorld();
    const atLimit = "d".repeat(5000);
    const created = await createProject(w.manager, {
      name: "Trimmed",
      keyPrefix: "TRIM",
      description: `  ${atLimit}\n`,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const read = await getProject(w.manager, created.projectId);
    expect(read.ok && read.project.descriptionMarkdown).toBe(atLimit);

    const updated = await updateProject(w.manager, created.projectId, 0, {
      description: `\n${atLimit}\n\n`,
    });
    // The trimmed value equals the stored one: a no-op.
    expect(updated).toEqual({ ok: true, changed: false });
    const shorter = await updateProject(w.manager, created.projectId, 0, {
      description: " short \n",
    });
    expect(shorter).toEqual({ ok: true, changed: true, version: 1 });
    const row = await prisma.project.findFirst({
      where: { id: created.projectId, organizationId: w.orgId },
      select: { descriptionMarkdown: true },
    });
    expect(row?.descriptionMarkdown).toBe("short");
    expect(
      await updateProject(w.manager, created.projectId, 1, { description: `${atLimit}d` }),
    ).toEqual({ ok: false, code: "INVALID_INPUT", field: "description" });
  });

  it("a task description at the limit plus a trailing newline is accepted and stored trimmed", async () => {
    const w = await managerWorld();
    const atLimit = "t".repeat(20000);
    const created = await createTask(w.manager, w.project.id, {
      title: "Long",
      description: `${atLimit}\n`,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const read = await getTask(w.manager, created.taskId);
    expect(read.ok && read.task.descriptionMarkdown).toBe(atLimit);

    const updated = await updateTask(w.manager, created.taskId, created.version, {
      description: ` ${atLimit} `,
    });
    expect(updated).toEqual({ ok: true, changed: false });
    const shorter = await updateTask(w.manager, created.taskId, created.version, {
      description: "\n body \n",
    });
    expect(shorter.ok).toBe(true);
    const row = await prisma.task.findFirst({
      where: { id: created.taskId, organizationId: w.orgId },
      select: { descriptionMarkdown: true },
    });
    expect(row?.descriptionMarkdown).toBe("body");
  });
});

describe("a-IN-02: editProject checks expectedVersion before the no-op test", () => {
  it("a stale version with values equal to the stored ones is CONFLICT, not a no-op", async () => {
    const w = await managerWorld();
    const first = await updateProject(w.manager, w.project.id, 0, { name: "Renamed" });
    expect(first).toEqual({ ok: true, changed: true, version: 1 });
    const before = await projectTableSnapshot(prisma, w.orgId);
    expect(await updateProject(w.manager, w.project.id, 0, { name: "Renamed" })).toEqual({
      ok: false,
      code: "CONFLICT",
    });
    expect(await setProjectStatus(w.manager, w.project.id, 0, "PLANNING")).toEqual({
      ok: false,
      code: "CONFLICT",
    });
    expect(await projectTableSnapshot(prisma, w.orgId)).toEqual(before);
    // The current version with the same values stays a no-op.
    expect(await updateProject(w.manager, w.project.id, 1, { name: "Renamed" })).toEqual({
      ok: true,
      changed: false,
    });
  });
});

describe("a-WR-04: setProjectPrivacy(true) needs an active manager to remain", () => {
  it("an org admin cannot make a project private when no MANAGER row belongs to an active member", async () => {
    const w = await managerWorld();
    const admin = actorOf(w.org.users[0]?.id as string, w.orgId);
    await removeOrgMember(prisma, w.orgId, w.managerId);
    const before = await projectTableSnapshot(prisma, w.orgId);
    expect(await setProjectPrivacy(admin, w.project.id, 0, true)).toEqual({
      ok: false,
      code: "LAST_MANAGER",
    });
    expect(await projectTableSnapshot(prisma, w.orgId)).toEqual(before);
    // Making it non-private again, or a project with an active manager, is unaffected.
    const other = await managerWorld();
    expect(await setProjectPrivacy(other.manager, other.project.id, 0, true)).toEqual({
      ok: true,
      changed: true,
      version: 1,
    });
    expect(await setProjectPrivacy(other.manager, other.project.id, 1, false)).toEqual({
      ok: true,
      changed: true,
      version: 2,
    });
  });
});

describe("a-IN-04: setProjectMemberRole to MANAGER requires an active organization member", () => {
  it("promoting a stale ProjectMember row whose member row is gone is NOT_ELIGIBLE", async () => {
    const w = await managerWorld();
    const leaver = await addOrgMember(prisma, w.orgId, "member");
    await prisma.projectMember.create({
      data: { organizationId: w.orgId, projectId: w.project.id, userId: leaver.id, role: "MEMBER" },
    });
    await removeOrgMember(prisma, w.orgId, leaver.id);
    const before = await projectTableSnapshot(prisma, w.orgId);
    expect(await setProjectMemberRole(w.manager, w.project.id, leaver.id, "MANAGER")).toEqual({
      ok: false,
      code: "NOT_ELIGIBLE",
    });
    expect(await projectTableSnapshot(prisma, w.orgId)).toEqual(before);
    // An active member is still promoted.
    const active = await addOrgMember(prisma, w.orgId, "member");
    await prisma.projectMember.create({
      data: { organizationId: w.orgId, projectId: w.project.id, userId: active.id, role: "MEMBER" },
    });
    expect(await setProjectMemberRole(w.manager, w.project.id, active.id, "MANAGER")).toEqual({
      ok: true,
      changed: true,
    });
  });
});

describe("a-CR-01, K71: hidden private projects change no visible order value, cursor, result or activity", () => {
  type Normalized = unknown;

  /** One world: the reader's projects V1..V3, with or without private projects of another user. */
  async function orderWorld(hidden: boolean) {
    const org = await seedOrgWithMembers(prisma, ["owner", "member", "member"]);
    const readerId = org.users[1]?.id as string;
    const otherId = org.users[2]?.id as string;
    const reader = actorOf(readerId, org.orgId);
    const other = actorOf(otherId, org.orgId);
    const ids: Record<string, string> = {};
    const create = async (actor: typeof reader, name: string, isPrivate: boolean) => {
      const r = await createProject(actor, { name, keyPrefix: name, isPrivate });
      if (!r.ok) throw new Error(`createProject ${name}: ${r.code}`);
      return r.projectId;
    };
    ids.V1 = await create(reader, "VA", false);
    if (hidden) await create(other, "HA", true);
    ids.V2 = await create(reader, "VB", false);
    if (hidden) {
      await create(other, "HB", true);
      await create(other, "HC", true);
    }
    ids.V3 = await create(reader, "VC", false);
    const placeholders = new Map<string, string>([
      [org.orgId, "ORG"],
      [readerId, "READER"],
      [otherId, "OTHER"],
      [ids.V1, "V1"],
      [ids.V2, "V2"],
      [ids.V3, "V3"],
    ]);
    return { orgId: org.orgId, reader, ids, placeholders };
  }

  type OrderWorld = Awaited<ReturnType<typeof orderWorld>>;

  /** Ids to placeholders, cursors decoded, per-row generated values fixed. */
  function normalize(w: OrderWorld, value: unknown): Normalized {
    const decodeCursors = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(decodeCursors);
      if (v && typeof v === "object" && !(v instanceof Date)) {
        const out: Record<string, unknown> = {};
        for (const [k, item] of Object.entries(v)) {
          if (k === "nextCursor" && typeof item === "string") {
            out[k] = Buffer.from(item, "base64url").toString("utf8");
          } else if (
            k === "createdAt" ||
            k === "updatedAt" ||
            k === "batchId" ||
            (k === "id" && "verb" in v)
          ) {
            out[k] = "generated";
          } else {
            out[k] = decodeCursors(item);
          }
        }
        return out;
      }
      return v;
    };
    let text = JSON.stringify(decodeCursors(value));
    for (const [id, name] of w.placeholders) text = text.split(id).join(name);
    return JSON.parse(text);
  }

  async function story(w: OrderWorld): Promise<Normalized[]> {
    const out: unknown[] = [];
    const listAll = async () => {
      const pages: unknown[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < 10; i++) {
        const page = await listProjects(w.reader, { limit: 1, cursor });
        pages.push(page);
        if (!page.ok || !page.hasMore) break;
        cursor = page.nextCursor;
      }
      return pages;
    };
    out.push(await listAll());
    for (const id of [w.ids.V1, w.ids.V2, w.ids.V3]) out.push(await getProject(w.reader, id));
    // V2 is visibly right after V1 in both worlds: a no-op in both.
    out.push(
      await moveProjectPosition(w.reader, w.ids.V2 as string, { placeAfterProjectId: w.ids.V1 }),
    );
    // Halve the same gap until the organization-wide order is renumbered.
    for (let i = 0; i < 14; i++) {
      const moved = i % 2 === 0 ? w.ids.V3 : w.ids.V2;
      out.push(
        await moveProjectPosition(w.reader, moved as string, { placeAfterProjectId: w.ids.V1 }),
      );
    }
    out.push(
      await moveProjectPosition(w.reader, w.ids.V1 as string, { placeAfterProjectId: null }),
    );
    out.push(
      await moveProjectPosition(w.reader, w.ids.V3 as string, { placeAfterProjectId: null }),
    );
    out.push(await listAll());
    for (const id of [w.ids.V1, w.ids.V2, w.ids.V3]) {
      out.push(await getProject(w.reader, id as string));
      out.push(await listProjectActivity(w.reader, id as string));
    }
    // A project created now sits last among the visible ones.
    const late = await createProject(w.reader, { name: "Late", keyPrefix: "VD" });
    if (!late.ok) throw new Error(late.code);
    w.placeholders.set(late.projectId, "V4");
    out.push(await getProject(w.reader, late.projectId));
    out.push(await listAll());
    return out.map((item) => normalize(w, item));
  }

  it("two worlds that differ only by hidden private projects give identical results", async () => {
    const plain = await orderWorld(false);
    const withHidden = await orderWorld(true);
    const expected = await story(plain);
    const actual = await story(withHidden);
    expect(actual).toEqual(expected);
    // The story did move projects, and the visible order is the expected one.
    const finalList = expected[expected.length - 1] as { ok: true; projects: { id: string }[] }[];
    expect(finalList.flatMap((page) => page.projects.map((p) => p.id))).toEqual([
      "V3",
      "V1",
      "V2",
      "V4",
    ]);
    // The raw organization-wide value is never returned or recorded.
    expect(JSON.stringify(actual)).not.toMatch(/"position"/);
  });
});

describe("b-WR-01: a bulk completion creates the recurrence successor from the patched task", () => {
  it("the successor carries the new due date, priority, assignee and labels of the same bulk call", async () => {
    const w = await managerWorld();
    const assignee = await addOrgMember(prisma, w.orgId, "member");
    const kept = await seedLabel(prisma, w.orgId, w.project.id, { name: "kept" });
    const added = await seedLabel(prisma, w.orgId, w.project.id, { name: "added" });
    const removed = await seedLabel(prisma, w.orgId, w.project.id, { name: "removed" });
    const task = await seedTask(prisma, w.orgId, w.project.id, {
      title: "Weekly",
      dueDate: "2026-11-01",
      labelIds: [kept.id, removed.id],
      recurrence: { rule: "WEEKLY", anchor: "2026-11-01", timeZone: "UTC" },
    });
    const result = await bulkUpdateTasks(
      w.manager,
      [task.id],
      {
        status: "DONE",
        dueDate: "2026-12-01",
        priority: "HIGH",
        assigneeUserId: assignee.id,
        addLabelIds: [added.id],
        removeLabelIds: [removed.id],
      },
      { now: new Date("2026-11-20T10:00:00Z") },
    );
    expect(result).toMatchObject({ ok: true, changedCount: 1 });
    const successor = await prisma.task.findFirstOrThrow({
      where: { organizationId: w.orgId, recurrencePredecessorId: task.id },
      select: { id: true, dueDate: true, priority: true, assigneeUserId: true },
    });
    expect({
      dueDate: successor.dueDate?.toISOString().slice(0, 10),
      priority: successor.priority,
      assigneeUserId: successor.assigneeUserId,
    }).toEqual({ dueDate: "2026-12-06", priority: "HIGH", assigneeUserId: assignee.id });
    const labels = await prisma.taskLabel.findMany({
      where: { organizationId: w.orgId, taskId: successor.id },
      select: { labelId: true },
      orderBy: { labelId: "asc" },
    });
    expect(labels.map((l) => l.labelId)).toEqual([added.id, kept.id].sort());
    const recurred = await prisma.projectActivity.findFirstOrThrow({
      where: { organizationId: w.orgId, verb: "TASK_RECURRED" },
      select: { after: true },
    });
    expect(recurred.after).toMatchObject({ dueDate: "2026-12-06" });
  });
});

describe("b-IN-03: getTask returns no predecessor id the reader cannot read", () => {
  it("a successor moved out of a private predecessor's project shows recurrencePredecessorId null to a target-only reader", async () => {
    const w = await managerWorld();
    const reader = await addOrgMember(prisma, w.orgId, "member");
    const secret = await seedProject(prisma, w.orgId, {
      createdByUserId: w.managerId,
      managerUserIds: [w.managerId],
      isPrivate: true,
    });
    const predecessor = await seedTask(prisma, w.orgId, secret.id, { title: "Origin" });
    const successor = await seedTask(prisma, w.orgId, w.project.id, { title: "Next" });
    await prisma.task.updateMany({
      where: { id: successor.id, organizationId: w.orgId },
      data: { recurrencePredecessorId: predecessor.id },
    });
    const asReader = await getTask(actorOf(reader.id, w.orgId), successor.id);
    expect(asReader.ok && asReader.task.recurrencePredecessorId).toBeNull();
    const asManager = await getTask(w.manager, successor.id);
    expect(asManager.ok && asManager.task.recurrencePredecessorId).toBe(predecessor.id);
  });
});

