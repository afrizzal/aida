// Phase 14 code review fixes, batch F1 (14-REVIEW.md dispositions), on a real Postgres through
// Testcontainers. Each describe names the finding it proves. Every case seeds fresh organizations.
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  listProjectActivity,
  listTaskActivity,
  listTeamActivity,
  recordProjectActivity,
} from "@/lib/projects/activity";
import { archiveProject } from "@/lib/projects/archive";
import { bulkUpdateTasks } from "@/lib/projects/bulk";
import { listTaskComments } from "@/lib/projects/comments";
import { deleteProject } from "@/lib/projects/delete";
import { favoriteProject, favoriteTask, listFavorites } from "@/lib/projects/favorites";
import { resolveTaskKey } from "@/lib/projects/keys";
import {
  listEligibleAssignees,
  listProjectMembers,
  setProjectMemberRole,
} from "@/lib/projects/members";
import { listProjectMilestones, listWorkspaceMilestones } from "@/lib/projects/milestones";
import { moveTask } from "@/lib/projects/move";
import {
  createProject,
  getProject,
  listProjects,
  moveProjectPosition,
  setProjectPrivacy,
  setProjectStatus,
  updateProject,
} from "@/lib/projects/projects";
import {
  createTask,
  getTask,
  listProjectTasks,
  listWorkspaceTasks,
  updateTask,
} from "@/lib/projects/tasks";
import { listProjectTeams, listTeams } from "@/lib/projects/teams";
import {
  actorOf,
  addOrgMember,
  projectTableSnapshot,
  removeOrgMember,
  seedLabel,
  seedMilestone,
  seedOrgWithMembers,
  seedProject,
  seedTask,
  seedTeam,
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

describe("a-IN-03: the activity writer measures size as the database does (jsonb::text)", () => {
  /** 16 keys (15 arrays of 80-character strings and one padded string) of exactly `target` compact bytes. */
  function valueWithCompactBytes(target: number): Record<string, string | string[]> {
    const value: Record<string, string | string[]> = {};
    for (let i = 0; i < 15; i++) {
      value[`k${String(i).padStart(2, "0")}`] = Array.from({ length: i === 0 ? 4 : 3 }, () =>
        "x".repeat(80),
      );
    }
    value.pad = "";
    const pad = target - Buffer.byteLength(JSON.stringify(value));
    if (pad < 0 || pad > 200) throw new Error(`pad ${pad} out of range`);
    value.pad = "p".repeat(pad);
    return value;
  }

  /** jsonb::text writes ": " and ", " where compact JSON writes ":" and ",". */
  function jsonbSpaces(value: Record<string, string | string[]>): number {
    const keys = Object.keys(value).length;
    const arrays = Object.values(value).reduce(
      (n, v) => n + (Array.isArray(v) ? Math.max(0, v.length - 1) : 0),
      0,
    );
    return keys + (keys - 1) + arrays;
  }

  it("a value within 4096 bytes compact but over 4096 as jsonb::text is refused by the writer itself", async () => {
    const w = await managerWorld();
    const value = valueWithCompactBytes(4096);
    expect(Buffer.byteLength(JSON.stringify(value))).toBe(4096);
    await expect(
      prisma.$transaction((tx) =>
        recordProjectActivity(tx as never, {
          orgId: w.orgId,
          projectId: w.project.id,
          actorUserId: w.managerId,
          verb: "PROJECT_UPDATED",
          entityType: "PROJECT",
          entityId: w.project.id,
          after: value,
          batchId: "b1",
        }),
      ),
    ).rejects.toThrow(/recordProjectActivity: after exceeds 4096 bytes/);
  });

  it("a value of exactly 4096 bytes as jsonb::text is written and passes the CHECK", async () => {
    const w = await managerWorld();
    const probe = valueWithCompactBytes(4000);
    const value = valueWithCompactBytes(4096 - jsonbSpaces(probe));
    const row = await prisma.$transaction((tx) =>
      recordProjectActivity(tx as never, {
        orgId: w.orgId,
        projectId: w.project.id,
        actorUserId: w.managerId,
        verb: "PROJECT_UPDATED",
        entityType: "PROJECT",
        entityId: w.project.id,
        after: value,
        batchId: "b2",
      }),
    );
    const size = await prisma.$queryRaw<{ size: number }[]>`
      SELECT octet_length("after"::text)::int AS size FROM "ProjectActivity"
      WHERE "id" = ${row.id} AND "organizationId" = ${w.orgId}`;
    expect(size[0]?.size).toBe(4096);
  });
});

describe("b-IN-09: one rule for list limits, a limit above the maximum is refused", () => {
  it("every paged list refuses a limit above its maximum with INVALID_INPUT field limit and accepts the maximum", async () => {
    const w = await managerWorld();
    const task = await seedTask(prisma, w.orgId, w.project.id, { title: "T" });
    const team = await seedTeam(prisma, w.orgId, {});
    const refused = { ok: false, code: "INVALID_INPUT", field: "limit" };
    const lists: [string, (limit: number) => Promise<{ ok: boolean }>, number][] = [
      ["listProjects", (limit) => listProjects(w.manager, { limit }), 200],
      ["listProjectTasks", (limit) => listProjectTasks(w.manager, w.project.id, { limit }), 200],
      ["listWorkspaceTasks", (limit) => listWorkspaceTasks(w.manager, { limit }), 200],
      ["listFavorites", (limit) => listFavorites(w.manager, { limit }), 200],
      ["listTaskComments", (limit) => listTaskComments(w.manager, task.id, { limit }), 200],
      [
        "listProjectActivity",
        (limit) => listProjectActivity(w.manager, w.project.id, { limit }),
        100,
      ],
      ["listTaskActivity", (limit) => listTaskActivity(w.manager, task.id, { limit }), 100],
      ["listTeamActivity", (limit) => listTeamActivity(w.manager, team.id, { limit }), 100],
    ];
    for (const [name, call, max] of lists) {
      expect({ name, result: await call(max + 1) }).toEqual({ name, result: refused });
      expect({ name, ok: (await call(max)).ok }).toEqual({ name, ok: true });
    }
  });
});

describe("a-WR-07, b-WR-05: people, team, milestone and favorite lists are keyset-paged with hasMore and nextCursor", () => {
  type Page = { ok: boolean; hasMore?: boolean; nextCursor?: string | null } & Record<
    string,
    unknown
  >;

  /** Pages with limit 2 until hasMore is false; returns the ids in order and the page count. */
  async function pageAll(
    call: (opts: { limit: number; cursor: string | null }) => Promise<Page>,
    itemsKey: string,
    idOf: (item: Record<string, unknown>) => string,
  ): Promise<{ ids: string[]; pages: number }> {
    const ids: string[] = [];
    let cursor: string | null = null;
    for (let pages = 1; pages <= 50; pages++) {
      const page = await call({ limit: 2, cursor });
      if (!page.ok) throw new Error(`refused: ${JSON.stringify(page)}`);
      const items = page[itemsKey] as Record<string, unknown>[];
      expect(items.length).toBeLessThanOrEqual(2);
      ids.push(...items.map(idOf));
      if (!page.hasMore) {
        expect(page.nextCursor).toBeNull();
        return { ids, pages };
      }
      expect(typeof page.nextCursor).toBe("string");
      cursor = page.nextCursor as string;
    }
    throw new Error("too many pages");
  }

  it("every list returns all its rows across pages, in its order, without duplicates", async () => {
    const w = await managerWorld();
    const people = [];
    for (let i = 0; i < 4; i++) people.push(await addOrgMember(prisma, w.orgId, "member"));
    for (const person of people) {
      await prisma.projectMember.create({
        data: {
          organizationId: w.orgId,
          projectId: w.project.id,
          userId: person.id,
          role: "MEMBER",
        },
      });
    }
    const teams = [];
    for (let i = 0; i < 5; i++) {
      teams.push(
        await seedTeam(prisma, w.orgId, { name: `Team ${i % 2}${i}`, projectIds: [w.project.id] }),
      );
    }
    for (let i = 0; i < 5; i++) {
      await seedMilestone(prisma, w.orgId, w.project.id, {
        name: `M${i}`,
        date: `2027-01-0${(i % 3) + 1}`,
      });
    }
    const favTasks = [];
    for (let i = 0; i < 5; i++) {
      const t = await seedTask(prisma, w.orgId, w.project.id, { title: `F${i}` });
      favTasks.push(t);
      expect(await favoriteTask(w.manager, t.id)).toEqual({ ok: true, changed: true });
    }
    const extraProjects = [];
    for (let i = 0; i < 4; i++) {
      const p = await seedProject(prisma, w.orgId, { createdByUserId: w.managerId });
      extraProjects.push(p);
      expect(await favoriteProject(w.manager, p.id)).toEqual({ ok: true, changed: true });
    }

    const cases: [
      string,
      (o: { limit: number; cursor: string | null }) => Promise<Page>,
      string,
      (i: Record<string, unknown>) => string,
      (max: number) => Promise<Page>,
    ][] = [
      [
        "listProjectMembers",
        (o) => listProjectMembers(w.manager, w.project.id, o) as Promise<Page>,
        "members",
        (i) => i.userId as string,
        (limit) => listProjectMembers(w.manager, w.project.id, { limit }) as Promise<Page>,
      ],
      [
        "listEligibleAssignees",
        (o) => listEligibleAssignees(w.manager, w.project.id, o) as Promise<Page>,
        "assignees",
        (i) => i.userId as string,
        (limit) => listEligibleAssignees(w.manager, w.project.id, { limit }) as Promise<Page>,
      ],
      [
        "listTeams",
        (o) => listTeams(w.manager, o) as Promise<Page>,
        "teams",
        (i) => i.id as string,
        (limit) => listTeams(w.manager, { limit }) as Promise<Page>,
      ],
      [
        "listProjectTeams",
        (o) => listProjectTeams(w.manager, w.project.id, o) as Promise<Page>,
        "teams",
        (i) => i.id as string,
        (limit) => listProjectTeams(w.manager, w.project.id, { limit }) as Promise<Page>,
      ],
      [
        "listProjectMilestones",
        (o) => listProjectMilestones(w.manager, w.project.id, o) as Promise<Page>,
        "milestones",
        (i) => i.id as string,
        (limit) => listProjectMilestones(w.manager, w.project.id, { limit }) as Promise<Page>,
      ],
      [
        "listWorkspaceMilestones",
        (o) => listWorkspaceMilestones(w.manager, o) as Promise<Page>,
        "milestones",
        (i) => i.id as string,
        (limit) => listWorkspaceMilestones(w.manager, { limit }) as Promise<Page>,
      ],
      [
        "listFavorites projects",
        (o) =>
          listFavorites(w.manager, { limit: o.limit, projectsCursor: o.cursor }).then((r) =>
            r.ok
              ? {
                  ok: true,
                  items: r.projects,
                  hasMore: r.hasMoreProjects,
                  nextCursor: r.nextProjectsCursor,
                }
              : r,
          ) as Promise<Page>,
        "items",
        (i) => i.projectId as string,
        (limit) =>
          listFavorites(w.manager, { limit }).then((r) =>
            r.ok ? { ok: true, items: r.projects, hasMore: r.hasMoreProjects } : r,
          ) as Promise<Page>,
      ],
      [
        "listFavorites tasks",
        (o) =>
          listFavorites(w.manager, { limit: o.limit, tasksCursor: o.cursor }).then((r) =>
            r.ok
              ? { ok: true, items: r.tasks, hasMore: r.hasMoreTasks, nextCursor: r.nextTasksCursor }
              : r,
          ) as Promise<Page>,
        "items",
        (i) => i.taskId as string,
        (limit) =>
          listFavorites(w.manager, { limit }).then((r) =>
            r.ok ? { ok: true, items: r.tasks, hasMore: r.hasMoreTasks } : r,
          ) as Promise<Page>,
      ],
    ];
    for (const [name, call, key, idOf, full] of cases) {
      const all = await full(200);
      expect({ name, ok: all.ok, hasMore: all.hasMore }).toEqual({
        name,
        ok: true,
        hasMore: false,
      });
      const expected = (all[key] as Record<string, unknown>[]).map(idOf);
      expect({ name, enough: expected.length >= 4 }).toEqual({ name, enough: true });
      const paged = await pageAll(call, key, idOf);
      expect({ name, ids: paged.ids }).toEqual({ name, ids: expected });
      expect(paged.pages).toBeGreaterThan(1);
    }
    // A malformed cursor is INVALID_INPUT field cursor.
    expect(await listTeams(w.manager, { cursor: "not-a-cursor" })).toEqual({
      ok: false,
      code: "INVALID_INPUT",
      field: "cursor",
    });
  });

  it("an organization with more than 200 members: assignees after the 200th are reachable on the next page", async () => {
    const w = await managerWorld();
    const seeded = new Set<string>([w.managerId, w.org.users[0]?.id as string]);
    for (let i = 0; i < 201; i++) seeded.add((await addOrgMember(prisma, w.orgId, "member")).id);
    const first = await listEligibleAssignees(w.manager, w.project.id, { limit: 200 });
    if (!first.ok) throw new Error(first.code);
    expect(first.assignees).toHaveLength(200);
    expect(first.hasMore).toBe(true);
    const second = await listEligibleAssignees(w.manager, w.project.id, {
      limit: 200,
      cursor: first.nextCursor,
    });
    if (!second.ok) throw new Error(second.code);
    expect(second.hasMore).toBe(false);
    const ids = [...first.assignees, ...second.assignees].map((a) => a.userId);
    expect(new Set(ids)).toEqual(seeded);
    expect(ids).toHaveLength(seeded.size);
  });
});

describe("Codex diff D3, K72: an alias resolves only while its origin project is readable", () => {
  /** A task keyed in an origin project of another user, then moved into a public project. */
  async function aliasWorld(origin: "none" | "private" | "deleted") {
    const org = await seedOrgWithMembers(prisma, ["owner", "member", "member"]);
    const reader = actorOf(org.users[1]?.id as string, org.orgId);
    const other = actorOf(org.users[2]?.id as string, org.orgId);
    const make = async (name: string, isPrivate: boolean) => {
      const r = await createProject(other, { name, keyPrefix: name, isPrivate });
      if (!r.ok) throw new Error(`createProject ${name}: ${r.code}`);
      return r.projectId;
    };
    const target = await make("QQ", false);
    let taskId: string;
    if (origin === "none") {
      const t = await createTask(other, target, { title: "Keyed" });
      if (!t.ok) throw new Error(t.code);
      taskId = t.taskId;
    } else {
      const source = await make("HP", origin === "private");
      const t = await createTask(other, source, { title: "Keyed" });
      if (!t.ok) throw new Error(t.code);
      expect(t.key).toBe("HP-1");
      taskId = t.taskId;
      const moved = await moveTask(other, taskId, target, 0);
      expect(moved.ok).toBe(true);
      if (origin === "deleted") {
        const project = await getProject(other, source);
        if (!project.ok) throw new Error(project.code);
        expect(await archiveProject(other, source, project.project.version)).toMatchObject({ ok: true });
        expect(await deleteProject(other, source, { confirmName: "HP" })).toMatchObject({ ok: true });
      }
    }
    return { reader, other, taskId };
  }

  it("an alias of a private origin the reader cannot read is NOT_FOUND, identical to a missing key", async () => {
    const plain = await aliasWorld("none");
    const hidden = await aliasWorld("private");
    const missing = await resolveTaskKey(plain.reader, "HP-1");
    expect(missing).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(await resolveTaskKey(hidden.reader, "HP-1")).toEqual(missing);
    // The current key resolves the same way in both worlds.
    const current = await resolveTaskKey(hidden.reader, "QQ-1");
    expect(current).toMatchObject({ ok: true, taskId: hidden.taskId, isAlias: false });
    expect(await resolveTaskKey(plain.reader, "QQ-1")).toMatchObject({ ok: true, isAlias: false });
    // A reader of the origin still resolves the alias.
    expect(await resolveTaskKey(hidden.other, "HP-1")).toMatchObject({
      ok: true,
      taskId: hidden.taskId,
      key: "QQ-1",
      isAlias: true,
    });
  });

  it("an alias whose origin project was deleted no longer resolves, for anyone", async () => {
    const w = await aliasWorld("deleted");
    for (const actor of [w.reader, w.other]) {
      expect(await resolveTaskKey(actor, "HP-1")).toEqual({ ok: false, code: "NOT_FOUND" });
      expect(await resolveTaskKey(actor, "QQ-1")).toMatchObject({ ok: true, taskId: w.taskId });
    }
  });
});
