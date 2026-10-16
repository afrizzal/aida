// Phase 14 project operations (contract sections 1, 2, 5, 6, 8 and 15; AIDA-64, AIDA-68, AIDA-100,
// AIDA-104): create, read, edit, status, privacy, prefix, order and list, each mutation with its
// one activity row. Unmocked, on the shared Testcontainers database; every case seeds fresh
// organizations.
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { renderTaskMarkdown } from "@/lib/markdown/render";
import {
  changeProjectKeyPrefix,
  createProject,
  getProject,
  listProjects,
  moveProjectPosition,
  setProjectPrivacy,
  setProjectStatus,
  updateProject,
} from "@/lib/projects/projects";
import {
  actorOf,
  addOrgMember,
  missingId,
  seedOrgWithMembers,
  seedProject,
} from "../support/project-fixtures";

async function orgWith(roles: ("owner" | "admin" | "member")[]) {
  const org = await seedOrgWithMembers(prisma, roles);
  return { orgId: org.orgId, users: org.users.map((u) => u.id) };
}

async function activityOf(orgId: string, projectId: string) {
  return prisma.projectActivity.findMany({
    where: { organizationId: orgId, OR: [{ projectId }, { relatedProjectId: projectId }] },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

describe("createProject and getProject (tracer)", () => {
  it("a member creates a private project, reads it back, and one PROJECT_CREATED row exists", async () => {
    const { orgId, users } = await orgWith(["owner", "member", "member"]);
    const [, creator, other] = users as [string, string, string];
    const existing = await seedProject(prisma, orgId, { createdByUserId: creator, position: 5000 });

    const created = await createProject(actorOf(creator, orgId), {
      name: "Launch",
      keyPrefix: " lch ",
      isPrivate: true,
    });
    expect(created).toEqual({ ok: true, projectId: expect.any(String), keyPrefix: "LCH" });
    if (!created.ok) throw new Error("unreachable");
    const id = created.projectId;

    const project = await prisma.project.findFirstOrThrow({ where: { id, organizationId: orgId } });
    expect(project).toMatchObject({ name: "Launch", keyPrefix: "LCH", isPrivate: true });
    expect(project.position).toBeGreaterThan(5000);
    expect(existing.id).not.toBe(id);
    expect(
      await prisma.projectKeyPrefix.findMany({
        where: { organizationId: orgId, prefix: "LCH" },
        select: { projectId: true },
      }),
    ).toEqual([{ projectId: id }]);
    expect(
      await prisma.projectTaskCounter.findMany({
        where: { organizationId: orgId, projectId: id },
        select: { lastNumber: true },
      }),
    ).toEqual([{ lastNumber: 0 }]);
    expect(
      await prisma.projectMember.findMany({
        where: { organizationId: orgId, projectId: id },
        select: { userId: true, role: true },
      }),
    ).toEqual([{ userId: creator, role: "MANAGER" }]);

    const rows = await activityOf(orgId, id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      verb: "PROJECT_CREATED",
      entityType: "PROJECT",
      entityId: id,
      projectId: id,
      actorUserId: creator,
      before: null,
      after: {
        name: "Launch",
        keyPrefix: "LCH",
        isPrivate: true,
        status: "PLANNING",
        color: "blue",
        managerUserId: creator,
      },
    });

    const read = await getProject(actorOf(creator, orgId), id);
    expect(read).toMatchObject({ ok: true, myRole: "MANAGER", canManage: true });
    if (!read.ok) throw new Error("unreachable");
    expect(read.project.descriptionHtml).toBe("");

    const hidden = await getProject(actorOf(other, orgId), id);
    expect(hidden).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(hidden).toEqual(await getProject(actorOf(other, orgId), missingId()));
  });

  it("getProject renders the description with renderTaskMarkdown", async () => {
    const { orgId, users } = await orgWith(["owner", "member"]);
    const creator = users[1] as string;
    const description =
      "Hello **team** ![x](https://example.test/a.png) [link](https://example.test)";
    const created = await createProject(actorOf(creator, orgId), {
      name: "Docs",
      keyPrefix: "DOCS",
      description,
    });
    if (!created.ok) throw new Error(`create failed: ${created.code}`);
    const read = await getProject(actorOf(creator, orgId), created.projectId);
    if (!read.ok) throw new Error("unreachable");
    expect(read.project.descriptionMarkdown).toBe(description);
    expect(read.project.descriptionHtml).toBe(renderTaskMarkdown(description));
  });

  it("a user without a member row gets MEMBERSHIP_ENDED and nothing is written", async () => {
    const { orgId, users } = await orgWith(["owner"]);
    const other = await orgWith(["member"]);
    const stranger = other.users[0] as string;
    const before = await prisma.project.count({ where: { organizationId: orgId } });
    expect(
      await createProject(actorOf(stranger, orgId), { name: "Nope", keyPrefix: "NOPE" }),
    ).toEqual({ ok: false, code: "MEMBERSHIP_ENDED" });
    expect(await prisma.project.count({ where: { organizationId: orgId } })).toBe(before);
    expect(await prisma.projectActivity.count({ where: { organizationId: orgId } })).toBe(0);
    expect(users).toHaveLength(1);
    // A member added later can create.
    const late = await addOrgMember(prisma, orgId, "member");
    expect(
      await createProject(actorOf(late.id, orgId), { name: "Late", keyPrefix: "LATE" }),
    ).toMatchObject({ ok: true, keyPrefix: "LATE" });
  });
});

/** An organization with an owner, a manager, a plain member and a project of the manager. */
async function managedWorld(opts: { isPrivate?: boolean; prefix?: string } = {}) {
  const { orgId, users } = await orgWith(["owner", "member", "member", "member"]);
  const [owner, manager, member, outsiderOfProject] = users as [string, string, string, string];
  const created = await createProject(actorOf(manager, orgId), {
    name: "Launch",
    keyPrefix: opts.prefix ?? "LCH",
    isPrivate: opts.isPrivate ?? false,
  });
  if (!created.ok) throw new Error(`create failed: ${created.code}`);
  const projectId = created.projectId;
  await prisma.projectMember.create({
    data: { organizationId: orgId, projectId, userId: member, role: "MEMBER" },
  });
  return {
    orgId,
    projectId,
    owner: actorOf(owner, orgId),
    manager: actorOf(manager, orgId),
    member: actorOf(member, orgId),
    nonMember: actorOf(outsiderOfProject, orgId),
  };
}

async function activityCount(orgId: string): Promise<number> {
  return prisma.projectActivity.count({ where: { organizationId: orgId } });
}

describe("updateProject", () => {
  it("updateProject changes the fields, increments version and writes one PROJECT_UPDATED row with the changed keys", async () => {
    const w = await managedWorld();
    const patch = {
      name: "Launch v2",
      description: "Secret plan text",
      color: "teal",
      icon: "rocket",
      dueDate: "2027-03-01",
    };
    const result = await updateProject(w.manager, w.projectId, 0, patch);
    expect(result).toEqual({ ok: true, changed: true, version: 1 });
    const stored = await prisma.project.findFirstOrThrow({
      where: { id: w.projectId, organizationId: w.orgId },
    });
    expect(stored).toMatchObject({
      name: "Launch v2",
      descriptionMarkdown: "Secret plan text",
      color: "teal",
      icon: "rocket",
      version: 1,
    });
    const rows = (await activityOf(w.orgId, w.projectId)).filter(
      (r) => r.verb !== "PROJECT_CREATED",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      verb: "PROJECT_UPDATED",
      actorUserId: w.manager.userId,
      before: {
        name: "Launch",
        descriptionChanged: false,
        color: "blue",
        icon: null,
        dueDate: null,
      },
      after: {
        name: "Launch v2",
        descriptionChanged: true,
        color: "teal",
        icon: "rocket",
        dueDate: "2027-03-01",
      },
    });
    expect(JSON.stringify(rows[0])).not.toContain("Secret plan text");

    // The same call again with the current version is a no-op with no row (a stale version is
    // CONFLICT first, review a-IN-02).
    const count = await activityCount(w.orgId);
    expect(await updateProject(w.manager, w.projectId, 1, patch)).toEqual({
      ok: true,
      changed: false,
    });
    expect(await activityCount(w.orgId)).toBe(count);

    // Only the changed key is recorded.
    expect(await updateProject(w.manager, w.projectId, 1, { ...patch, color: "red" })).toEqual({
      ok: true,
      changed: true,
      version: 2,
    });
    const last = await prisma.projectActivity.findFirstOrThrow({
      where: { organizationId: w.orgId, projectId: w.projectId, verb: "PROJECT_UPDATED" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    expect(last.before).toEqual({ color: "teal" });
    expect(last.after).toEqual({ color: "red" });
  });

  it("updateProject refuses a stale version, a member, an archived project and invalid input, writing nothing", async () => {
    const w = await managedWorld();
    const count = await activityCount(w.orgId);
    expect(await updateProject(w.manager, w.projectId, 7, { name: "Other" })).toEqual({
      ok: false,
      code: "CONFLICT",
    });
    expect(await updateProject(w.member, w.projectId, 0, { name: "Other" })).toEqual({
      ok: false,
      code: "NOT_ALLOWED",
    });
    for (const [patch, field] of [
      [{ name: "x".repeat(81) }, "name"],
      [{ name: "a\u0000b" }, "name"],
      [{ color: "#fff" }, "color"],
      [{ icon: "skull-x" }, "icon"],
    ] as const) {
      expect(await updateProject(w.manager, w.projectId, 0, patch)).toEqual({
        ok: false,
        code: "INVALID_INPUT",
        field,
      });
    }
    await prisma.project.updateMany({
      where: { id: w.projectId, organizationId: w.orgId },
      data: { archivedAt: new Date() },
    });
    expect(await updateProject(w.manager, w.projectId, 0, { name: "Other" })).toEqual({
      ok: false,
      code: "ARCHIVED",
    });
    expect(await activityCount(w.orgId)).toBe(count);
    const stored = await prisma.project.findFirstOrThrow({
      where: { id: w.projectId, organizationId: w.orgId },
    });
    expect(stored).toMatchObject({ name: "Launch", version: 0 });
  });
});

describe("setProjectStatus and setProjectPrivacy", () => {
  it("setProjectStatus writes PROJECT_STATUS_CHANGED", async () => {
    const w = await managedWorld();
    expect(await setProjectStatus(w.manager, w.projectId, 0, "AT_RISK")).toEqual({
      ok: true,
      changed: true,
      version: 1,
    });
    const row = await prisma.projectActivity.findFirstOrThrow({
      where: { organizationId: w.orgId, projectId: w.projectId, verb: "PROJECT_STATUS_CHANGED" },
    });
    expect(row).toMatchObject({
      verb: "PROJECT_STATUS_CHANGED",
      actorUserId: w.manager.userId,
      before: { status: "PLANNING" },
      after: { status: "AT_RISK" },
    });
    expect(await setProjectStatus(w.manager, w.projectId, 1, "AT_RISK")).toEqual({
      ok: true,
      changed: false,
    });
    expect(await setProjectStatus(w.manager, w.projectId, 1, "DONE" as never)).toEqual({
      ok: false,
      code: "INVALID_INPUT",
      field: "status",
    });
  });

  it("setProjectPrivacy writes PROJECT_PRIVACY_CHANGED", async () => {
    const w = await managedWorld();
    expect(await setProjectPrivacy(w.manager, w.projectId, 0, true)).toEqual({
      ok: true,
      changed: true,
      version: 1,
    });
    const row = await prisma.projectActivity.findFirstOrThrow({
      where: { organizationId: w.orgId, projectId: w.projectId, verb: "PROJECT_PRIVACY_CHANGED" },
    });
    expect(row).toMatchObject({
      verb: "PROJECT_PRIVACY_CHANGED",
      before: { isPrivate: false },
      after: { isPrivate: true },
    });
  });

  it("an organization admin manages a non-private project and gets NOT_FOUND on a private one", async () => {
    const open = await managedWorld();
    expect(await setProjectStatus(open.owner, open.projectId, 0, "ACTIVE")).toMatchObject({
      ok: true,
      changed: true,
    });
    expect(await setProjectPrivacy(open.owner, open.projectId, 1, true)).toMatchObject({
      ok: true,
      changed: true,
    });
    const closed = await managedWorld({ isPrivate: true });
    const count = await activityCount(closed.orgId);
    const missing = await setProjectStatus(closed.owner, missingId(), 0, "ACTIVE");
    expect(missing).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(await setProjectStatus(closed.owner, closed.projectId, 0, "ACTIVE")).toEqual(missing);
    expect(await setProjectPrivacy(closed.owner, closed.projectId, 0, false)).toEqual(missing);
    expect(await activityCount(closed.orgId)).toBe(count);
  });
});

describe("changeProjectKeyPrefix", () => {
  it("changeProjectKeyPrefix writes PROJECT_UPDATED and keeps the old prefix reserved forever", async () => {
    const w = await managedWorld({ prefix: "LCH" });
    expect(await changeProjectKeyPrefix(w.manager, w.projectId, 0, "new")).toEqual({
      ok: true,
      changed: true,
      version: 1,
    });
    const row = await prisma.projectActivity.findFirstOrThrow({
      where: { organizationId: w.orgId, projectId: w.projectId, verb: "PROJECT_UPDATED" },
    });
    expect(row).toMatchObject({
      verb: "PROJECT_UPDATED",
      before: { keyPrefix: "LCH" },
      after: { keyPrefix: "NEW" },
    });
    const count = await activityCount(w.orgId);
    expect(await createProject(w.member, { name: "Other", keyPrefix: "LCH" })).toEqual({
      ok: false,
      code: "PREFIX_TAKEN",
    });
    const other = await createProject(w.member, { name: "Other", keyPrefix: "OTH" });
    if (!other.ok) throw new Error("unreachable");
    const afterCreate = await activityCount(w.orgId);
    expect(afterCreate).toBe(count + 1);
    expect(await changeProjectKeyPrefix(w.member, other.projectId, 0, "LCH")).toEqual({
      ok: false,
      code: "PREFIX_TAKEN",
    });
    expect(await changeProjectKeyPrefix(w.member, other.projectId, 0, "NEW")).toEqual({
      ok: false,
      code: "PREFIX_TAKEN",
    });
    expect(await activityCount(w.orgId)).toBe(afterCreate);
    expect(await changeProjectKeyPrefix(w.manager, w.projectId, 1, "LCH")).toEqual({
      ok: true,
      changed: true,
      version: 2,
    });
    expect(await changeProjectKeyPrefix(w.manager, w.projectId, 2, "1AB")).toEqual({
      ok: false,
      code: "PREFIX_INVALID",
    });
    expect(
      await prisma.projectKeyPrefix.findMany({
        where: { organizationId: w.orgId, projectId: w.projectId },
        orderBy: { prefix: "asc" },
        select: { prefix: true },
      }),
    ).toEqual([{ prefix: "LCH" }, { prefix: "NEW" }]);
  });
});

describe("moveProjectPosition and listProjects", () => {
  async function orderOf(actor: { userId: string; orgId: string }): Promise<string[]> {
    const listed = await listProjects(actor, { archived: "include", limit: 200 });
    if (!listed.ok) throw new Error(listed.code);
    return listed.projects.map((p) => p.id);
  }

  it("moveProjectPosition places a project after another, first, and rebalances adjacent positions with one PROJECT_REORDERED row", async () => {
    const { orgId, users } = await orgWith(["owner", "member"]);
    const manager = actorOf(users[1] as string, orgId);
    const ids: string[] = [];
    for (const [i, position] of [10, 11, 12, 13].entries()) {
      const p = await seedProject(prisma, orgId, {
        createdByUserId: manager.userId,
        managerUserIds: [manager.userId],
        position,
        name: `P${i}`,
      });
      ids.push(p.id);
    }
    const [a, b, c, d] = ids as [string, string, string, string];
    expect(await orderOf(manager)).toEqual([a, b, c, d]);

    // d after a: positions 10 and 11 are adjacent integers, so the organization is rebalanced.
    expect(await moveProjectPosition(manager, d, { placeAfterProjectId: a })).toEqual({
      ok: true,
      changed: true,
    });
    expect(await orderOf(manager)).toEqual([a, d, b, c]);
    const positions = await prisma.project.findMany({
      where: { organizationId: orgId },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      select: { position: true },
    });
    expect(positions.map((p) => p.position)).toEqual([1024, 2048, 3072, 4096]);
    const reordered = await prisma.projectActivity.findMany({
      where: { organizationId: orgId, verb: "PROJECT_REORDERED" },
    });
    expect(reordered).toHaveLength(1);
    expect(reordered[0]).toMatchObject({
      verb: "PROJECT_REORDERED",
      projectId: d,
      // K71: no stored position and no neighbour is recorded.
      before: null,
      after: null,
    });

    // c first (null), then b after d (between two positions, no rebalance).
    expect(await moveProjectPosition(manager, c, { placeAfterProjectId: null })).toEqual({
      ok: true,
      changed: true,
    });
    expect(await orderOf(manager)).toEqual([c, a, d, b]);
    expect(await moveProjectPosition(manager, b, { placeAfterProjectId: a })).toEqual({
      ok: true,
      changed: true,
    });
    expect(await orderOf(manager)).toEqual([c, a, b, d]);
    // Already there: no-op, no row.
    const count = await activityCount(orgId);
    expect(await moveProjectPosition(manager, b, { placeAfterProjectId: a })).toEqual({
      ok: true,
      changed: false,
    });
    expect(await activityCount(orgId)).toBe(count);
    expect(
      await prisma.projectActivity.count({
        where: { organizationId: orgId, verb: "PROJECT_REORDERED" },
      }),
    ).toBe(3);
  });

  it("listProjects returns readable projects only, archived per option, keyset-paged", async () => {
    const { orgId, users } = await orgWith(["owner", "member", "member"]);
    const [owner, manager, reader] = users as [string, string, string];
    const open1 = await seedProject(prisma, orgId, { createdByUserId: manager, position: 1 });
    const hidden = await seedProject(prisma, orgId, {
      createdByUserId: manager,
      position: 2,
      isPrivate: true,
      managerUserIds: [manager],
    });
    const archived = await seedProject(prisma, orgId, {
      createdByUserId: manager,
      position: 3,
      archivedAt: new Date(),
    });
    const open2 = await seedProject(prisma, orgId, { createdByUserId: manager, position: 4 });
    const mine = await seedProject(prisma, orgId, {
      createdByUserId: manager,
      position: 5,
      isPrivate: true,
      memberUserIds: [reader],
    });
    const ids = async (
      actor: { userId: string; orgId: string },
      archivedOpt?: "only" | "include",
    ) => {
      const r = await listProjects(actor, archivedOpt ? { archived: archivedOpt } : {});
      if (!r.ok) throw new Error(r.code);
      return r.projects.map((p) => p.id);
    };
    expect(await ids(actorOf(reader, orgId))).toEqual([open1.id, open2.id, mine.id]);
    expect(await ids(actorOf(reader, orgId), "only")).toEqual([archived.id]);
    expect(await ids(actorOf(reader, orgId), "include")).toEqual([
      open1.id,
      archived.id,
      open2.id,
      mine.id,
    ]);
    expect(await ids(actorOf(owner, orgId))).toEqual([open1.id, open2.id]);
    expect(await ids(actorOf(manager, orgId))).toEqual([open1.id, hidden.id, open2.id]);

    const first = await listProjects(actorOf(reader, orgId), { archived: "include", limit: 3 });
    if (!first.ok) throw new Error(first.code);
    expect(first.projects.map((p) => p.id)).toEqual([open1.id, archived.id, open2.id]);
    expect(first.hasMore).toBe(true);
    const second = await listProjects(actorOf(reader, orgId), {
      archived: "include",
      limit: 3,
      cursor: first.nextCursor,
    });
    expect(second).toMatchObject({ ok: true, hasMore: false, nextCursor: null });
    if (!second.ok) throw new Error(second.code);
    expect(second.projects.map((p) => p.id)).toEqual([mine.id]);
    expect(await listProjects(actorOf(reader, orgId), { limit: 0 })).toEqual({
      ok: false,
      code: "INVALID_INPUT",
      field: "limit",
    });
    // One limit rule (review b-IN-09): above the maximum is refused, never clamped.
    expect(await listProjects(actorOf(reader, orgId), { limit: 5000 })).toEqual({
      ok: false,
      code: "INVALID_INPUT",
      field: "limit",
    });
    expect((await listProjects(actorOf(reader, orgId), { limit: 200 })).ok).toBe(true);
  });
});
