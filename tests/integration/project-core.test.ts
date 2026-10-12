// Phase 14 project operations (contract sections 1, 2, 5, 6, 8 and 15; AIDA-64, AIDA-68, AIDA-100,
// AIDA-104): create, read, edit, status, privacy, prefix, order and list, each mutation with its
// one activity row. Unmocked, on the shared Testcontainers database; every case seeds fresh
// organizations.
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { renderTaskMarkdown } from "@/lib/markdown/render";
import { createProject, getProject } from "@/lib/projects/projects";
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
