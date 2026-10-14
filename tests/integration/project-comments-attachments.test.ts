// Phase 14 comments and attachments (contract sections 1, 5, 12, 14 and 15; D-14, K65, K66, C10)
// on a real Postgres through Testcontainers. Comments are untrusted Markdown read back through
// renderTaskMarkdown and recorded with ids only. Attachments are validated before anything is
// stored, staged before the transaction and discarded on any refusal or error; every download
// read checks project access; a delete writes its storage key to ProjectFileCleanup.
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { addTaskComment, listTaskComments } from "@/lib/projects/comments";
import { actorOf, seedOrgWithMembers, seedProject, seedTask } from "../support/project-fixtures";

async function world(opts: { isPrivate?: boolean } = {}) {
  const org = await seedOrgWithMembers(prisma, ["owner", "member", "member", "member"]);
  const [admin, manager, member, other] = org.users.map((u) => u.id) as [
    string,
    string,
    string,
    string,
  ];
  const project = await seedProject(prisma, org.orgId, {
    createdByUserId: manager,
    isPrivate: opts.isPrivate ?? true,
    managerUserIds: [manager],
    memberUserIds: [member, other],
  });
  const task = await seedTask(prisma, org.orgId, project.id, { createdByUserId: manager });
  return {
    orgId: org.orgId,
    project,
    task,
    users: { admin, manager, member, other },
    manager: actorOf(manager, org.orgId),
    member: actorOf(member, org.orgId),
    other: actorOf(other, org.orgId),
    nonMember: actorOf(admin, org.orgId),
  };
}

function activityRows(orgId: string) {
  return prisma.projectActivity.findMany({
    where: { organizationId: orgId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

describe("addTaskComment and listTaskComments", () => {
  it("a member comments and reads it back safely rendered, with one COMMENT_ADDED row and no body", async () => {
    const w = await world();
    const body = "see [docs](https://ok.example) ![x](/api/attachments/1)";
    const added = await addTaskComment(w.member, w.task.id, { body });
    expect(added).toMatchObject({ ok: true, version: 0 });
    if (!added.ok) throw new Error("not added");

    const listed = await listTaskComments(w.member, w.task.id);
    if (!listed.ok) throw new Error("not listed");
    expect(listed.hasMore).toBe(false);
    expect(listed.nextCursor).toBeNull();
    expect(listed.comments).toHaveLength(1);
    const comment = listed.comments[0];
    expect(comment).toMatchObject({
      id: added.commentId,
      taskId: w.task.id,
      authorUserId: w.users.member,
      bodyMarkdown: body,
    });
    expect(comment?.createdAt).toBeInstanceOf(Date);
    expect(comment?.bodyHtml).toContain('href="https://ok.example"');
    expect(comment?.bodyHtml).not.toContain("<img");
    expect(comment?.bodyHtml).not.toContain("/api/attachments/1");

    const rows = await activityRows(w.orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      verb: "COMMENT_ADDED",
      entityType: "COMMENT",
      entityId: added.commentId,
      taskId: w.task.id,
      projectId: w.project.id,
      actorUserId: w.users.member,
      before: null,
      after: { commentId: added.commentId },
    });
    expect(JSON.stringify(rows[0])).not.toContain("ok.example");
  });

  it("refuses an empty body, 10001 code points and a NUL with INVALID_INPUT body, and an archived task with ARCHIVED; none writes a row", async () => {
    const w = await world();
    for (const body of ["", "   ", "a".repeat(10_001), "x\u0000y"]) {
      expect(await addTaskComment(w.member, w.task.id, { body })).toEqual({
        ok: false,
        code: "INVALID_INPUT",
        field: "body",
      });
    }
    expect(await addTaskComment(w.member, w.task.id, { body: "😀".repeat(10_000) })).toMatchObject({
      ok: true,
    });
    const archived = await seedTask(prisma, w.orgId, w.project.id, {
      createdByUserId: w.users.manager,
      archivedAt: new Date(),
    });
    expect(await addTaskComment(w.member, archived.id, { body: "hi" })).toEqual({
      ok: false,
      code: "ARCHIVED",
    });
    expect(await prisma.taskComment.count({ where: { organizationId: w.orgId } })).toBe(1);
    expect(await activityRows(w.orgId)).toHaveLength(1);
  });

  it("pages comments oldest first with a keyset cursor", async () => {
    const w = await world();
    const ids: string[] = [];
    for (const body of ["one", "two", "three"]) {
      const r = await addTaskComment(w.member, w.task.id, { body });
      if (r.ok) ids.push(r.commentId);
    }
    const first = await listTaskComments(w.member, w.task.id, { limit: 2 });
    if (!first.ok) throw new Error("no page");
    expect(first.comments.map((c) => c.id)).toEqual(ids.slice(0, 2));
    expect(first.hasMore).toBe(true);
    const second = await listTaskComments(w.member, w.task.id, {
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(second.ok && second.comments.map((c) => c.id)).toEqual(ids.slice(2));
    expect(second.ok && second.hasMore).toBe(false);
  });
});
