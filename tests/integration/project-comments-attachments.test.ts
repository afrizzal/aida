// Phase 14 comments and attachments (contract sections 1, 5, 12, 14 and 15; D-14, K65, K66, C10)
// on a real Postgres through Testcontainers. Comments are untrusted Markdown read back through
// renderTaskMarkdown and recorded with ids only. Attachments are validated before anything is
// stored, staged before the transaction and discarded on any refusal or error; every download
// read checks project access; a delete writes its storage key to ProjectFileCleanup.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FileStorage } from "@/lib/attachments/file-storage";
import { prisma } from "@/lib/db";
import {
  addTaskComment,
  deleteTaskComment,
  editTaskComment,
  listTaskComments,
} from "@/lib/projects/comments";
import { setProjectServiceObserverForTests } from "@/lib/projects/service";
import {
  actorOf,
  filesUnder,
  missingId,
  seedOrgWithMembers,
  seedPrivacyWorld,
  seedProject,
  seedTask,
} from "../support/project-fixtures";

// localFileStorage reads UPLOADS_DIR when its module loads, so the attachment modules are
// imported dynamically after the variable points at a fresh temporary directory.
let uploadsDir = "";
let att: typeof import("@/lib/projects/attachments");
let storageMod: typeof import("@/lib/attachments/local-file-storage");
let cleanupMod: typeof import("@/lib/projects/file-cleanup");
// Review c-IN-02: the previous value is restored after the file. The temporary directory stays:
// the charter allows no recursive delete.
const previousUploadsDir = process.env.UPLOADS_DIR;

beforeAll(async () => {
  uploadsDir = await mkdtemp(path.join(tmpdir(), "aida-project-attachments-"));
  process.env.UPLOADS_DIR = uploadsDir;
  att = await import("@/lib/projects/attachments");
  storageMod = await import("@/lib/attachments/local-file-storage");
  cleanupMod = await import("@/lib/projects/file-cleanup");
});

afterAll(() => {
  if (previousUploadsDir === undefined) delete process.env.UPLOADS_DIR;
  else process.env.UPLOADS_DIR = previousUploadsDir;
});

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

function fileOf(name: string, data: Buffer, size = data.length) {
  return {
    name,
    size,
    arrayBuffer: async () => Uint8Array.from(data).buffer,
  };
}

// Review c-WR-01: only a missing directory is empty; any other read error fails the test.
function filesOnDisk(orgId: string): Promise<string[]> {
  return filesUnder(path.join(uploadsDir, orgId));
}

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

describe("uploadTaskAttachments", () => {
  it("a member attaches a PNG: cleaned name, file under the organization directory, one ATTACHMENT_ADDED", async () => {
    const w = await world();
    const result = await att.uploadTaskAttachments(w.member, w.task.id, [
      fileOf("  shot\u0007.png ", PNG),
    ]);
    if (!result.ok) throw new Error(`refused ${result.code}`);
    const [row] = result.attachments;
    expect(row).toMatchObject({ mimeType: "image/png", originalFilename: "shot.png" });
    const stored = await prisma.taskAttachment.findFirstOrThrow({
      where: { id: row?.id, organizationId: w.orgId },
    });
    expect(stored.storageKey).toMatch(/^[0-9a-f]{32}\.png$/);
    expect(await filesOnDisk(w.orgId)).toEqual([stored.storageKey]);
    const rows = await activityRows(w.orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      verb: "ATTACHMENT_ADDED",
      entityType: "ATTACHMENT",
      taskId: w.task.id,
      after: {
        attachmentId: row?.id,
        fileName: "shot.png",
        mimeType: "image/png",
        sizeBytes: PNG.length,
      },
    });
  });

  it("refuses TOO_MANY, UNSUPPORTED_FILE_TYPE and FILE_TOO_LARGE with no file and no row", async () => {
    const w = await world();
    const eleven = Array.from({ length: 11 }, (_, i) => fileOf(`f${i}.png`, PNG));
    expect(await att.uploadTaskAttachments(w.member, w.task.id, eleven)).toEqual({
      ok: false,
      code: "TOO_MANY",
    });
    expect(
      await att.uploadTaskAttachments(w.member, w.task.id, [
        fileOf("ok.png", PNG),
        fileOf("evil.png", Buffer.from("just text")),
      ]),
    ).toEqual({ ok: false, code: "UNSUPPORTED_FILE_TYPE" });
    const { MAX_BYTES } = await import("@/lib/attachments/constants");
    expect(
      await att.uploadTaskAttachments(w.member, w.task.id, [fileOf("big.png", PNG, MAX_BYTES + 1)]),
    ).toEqual({ ok: false, code: "FILE_TOO_LARGE" });
    expect(await filesOnDisk(w.orgId)).toEqual([]);
    expect(await prisma.taskAttachment.count({ where: { organizationId: w.orgId } })).toBe(0);
    expect(await activityRows(w.orgId)).toHaveLength(0);
  });

  it("discards the staged files when the task is archived between the pre-check and the lock", async () => {
    const w = await world();
    setProjectServiceObserverForTests({
      async onTransactionStart(_tx, operation) {
        if (operation !== "uploadTaskAttachments") return;
        await prisma.task.update({ where: { id: w.task.id }, data: { archivedAt: new Date() } });
      },
    });
    try {
      expect(
        await att.uploadTaskAttachments(w.member, w.task.id, [
          fileOf("a.png", PNG),
          fileOf("b.png", PNG),
        ]),
      ).toEqual({ ok: false, code: "ARCHIVED" });
    } finally {
      setProjectServiceObserverForTests(null);
    }
    expect(await filesOnDisk(w.orgId)).toEqual([]);
    expect(await prisma.taskAttachment.count({ where: { organizationId: w.orgId } })).toBe(0);
  });

  it("removes the first file and rethrows when the storage fails on the second", async () => {
    const w = await world();
    let saves = 0;
    const failing: FileStorage = {
      ...storageMod.localFileStorage,
      async save(params) {
        saves += 1;
        if (saves === 2) throw new Error("disk full");
        return storageMod.localFileStorage.save(params);
      },
    };
    await expect(
      att.uploadTaskAttachments(w.member, w.task.id, [fileOf("a.png", PNG), fileOf("b.png", PNG)], {
        storage: failing,
      }),
    ).rejects.toThrow("disk full");
    expect(saves).toBe(2);
    expect(await filesOnDisk(w.orgId)).toEqual([]);
    expect(await prisma.taskAttachment.count({ where: { organizationId: w.orgId } })).toBe(0);
  });

  it("refuses a non-member of the private project before anything is stored", async () => {
    const w = await world();
    expect(await att.uploadTaskAttachments(w.nonMember, w.task.id, [fileOf("a.png", PNG)])).toEqual(
      { ok: false, code: "NOT_FOUND" },
    );
    expect(await filesOnDisk(w.orgId)).toEqual([]);
  });
});

describe("attachment reads", () => {
  it("getTaskAttachmentForDownload returns metadata to readers, also on an archived task, and the missing-id result to everyone else", async () => {
    const pw = await seedPrivacyWorld(prisma);
    for (const actor of [pw.actors.manager, pw.actors.member]) {
      expect(await att.getTaskAttachmentForDownload(actor, pw.attachment.id)).toEqual({
        ok: true,
        attachment: {
          id: pw.attachment.id,
          taskId: pw.task.id,
          storageKey: pw.attachment.storageKey,
          mimeType: "image/png",
          originalFilename: "fixture.png",
          sizeBytes: 128,
        },
      });
    }
    for (const actor of [
      pw.actors.teamMember,
      pw.actors.nonMember,
      pw.actors.orgAdmin,
      pw.actors.outsider,
    ]) {
      expect(await att.getTaskAttachmentForDownload(actor, pw.attachment.id)).toEqual(
        await att.getTaskAttachmentForDownload(actor, missingId()),
      );
    }
    await prisma.task.update({ where: { id: pw.task.id }, data: { archivedAt: new Date() } });
    expect(
      await att.getTaskAttachmentForDownload(pw.actors.member, pw.attachment.id),
    ).toMatchObject({ ok: true });
  });

  it("listTaskAttachments and listProjectAttachments list only readable attachments, with task keys", async () => {
    const pw = await seedPrivacyWorld(prisma);
    const open = await seedTask(prisma, pw.orgA, pw.openProject.id, {
      createdByUserId: pw.users.manager,
    });
    const upload = await att.uploadTaskAttachments(pw.actors.nonMember, open.id, [
      fileOf("open.png", PNG),
    ]);
    expect(upload.ok).toBe(true);
    const own = await att.listTaskAttachments(pw.actors.member, pw.task.id);
    expect(own.ok && own.attachments.map((a) => a.id)).toEqual([pw.attachment.id]);
    const project = await att.listProjectAttachments(pw.actors.member, pw.project.id);
    expect(project.ok && project.attachments.map((a) => [a.id, a.taskKey])).toEqual([
      [pw.attachment.id, pw.task.key],
    ]);
    expect(await att.listProjectAttachments(pw.actors.nonMember, pw.project.id)).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    const openList = await att.listProjectAttachments(pw.actors.nonMember, pw.openProject.id);
    expect(openList.ok && openList.attachments.map((a) => a.taskKey)).toEqual([open.key]);
  });
});

describe("deleteTaskAttachment", () => {
  it("the uploader or a manager deletes; ProjectFileCleanup gets the key; another member is NOT_ALLOWED; the sweep removes the file", async () => {
    const w = await world();
    const up = async (actor: typeof w.member) => {
      const r = await att.uploadTaskAttachments(actor, w.task.id, [fileOf("x.png", PNG)]);
      if (!r.ok) throw new Error("upload refused");
      const id = r.attachments[0]?.id as string;
      const row = await prisma.taskAttachment.findFirstOrThrow({ where: { id } });
      return { id, storageKey: row.storageKey };
    };
    const mine = await up(w.member);
    const managed = await up(w.member);
    const countBefore = (await activityRows(w.orgId)).length;
    expect(await att.deleteTaskAttachment(w.other, mine.id)).toEqual({
      ok: false,
      code: "NOT_ALLOWED",
    });
    expect(await prisma.taskAttachment.count({ where: { organizationId: w.orgId } })).toBe(2);
    expect(await prisma.projectFileCleanup.count({ where: { organizationId: w.orgId } })).toBe(0);
    expect((await activityRows(w.orgId)).length).toBe(countBefore);

    expect(await att.deleteTaskAttachment(w.member, mine.id)).toEqual({
      ok: true,
      cleanupQueued: 1,
    });
    expect(await att.deleteTaskAttachment(w.manager, managed.id)).toEqual({
      ok: true,
      cleanupQueued: 1,
    });
    expect(await prisma.taskAttachment.count({ where: { organizationId: w.orgId } })).toBe(0);
    const queued = await prisma.projectFileCleanup.findMany({
      where: { organizationId: w.orgId },
      select: { storageKey: true },
    });
    expect(queued.map((q) => q.storageKey).sort()).toEqual(
      [mine.storageKey, managed.storageKey].sort(),
    );
    const deleted = (await activityRows(w.orgId)).filter((r) => r.verb === "ATTACHMENT_DELETED");
    expect(deleted.map((r) => r.entityId).sort()).toEqual([mine.id, managed.id].sort());
    expect(deleted[0]).toMatchObject({ entityType: "ATTACHMENT", taskId: w.task.id });

    expect((await filesOnDisk(w.orgId)).sort()).toEqual(
      [mine.storageKey, managed.storageKey].sort(),
    );
    await cleanupMod.sweepProjectFileCleanup({
      client: prisma,
      storage: storageMod.localFileStorage,
      now: new Date(Date.now() + 60_000),
    });
    expect(await filesOnDisk(w.orgId)).toEqual([]);
    expect(await prisma.projectFileCleanup.count({ where: { organizationId: w.orgId } })).toBe(0);
  });
});

describe("editTaskComment and deleteTaskComment", () => {
  it("the author edits with the current version; another member is NOT_ALLOWED; a stale version is CONFLICT", async () => {
    const w = await world();
    const added = await addTaskComment(w.member, w.task.id, { body: "first" });
    if (!added.ok) throw new Error("not added");
    expect(await editTaskComment(w.other, added.commentId, 0, { body: "hijack" })).toEqual({
      ok: false,
      code: "NOT_ALLOWED",
    });
    expect(await editTaskComment(w.member, added.commentId, 0, { body: "second" })).toEqual({
      ok: true,
      changed: true,
      version: 1,
    });
    const row = await prisma.taskComment.findFirstOrThrow({ where: { id: added.commentId } });
    expect(row).toMatchObject({ bodyMarkdown: "second", version: 1 });
    expect(row.editedAt).toBeInstanceOf(Date);
    const count = (await activityRows(w.orgId)).length;
    expect(await editTaskComment(w.member, added.commentId, 0, { body: "third" })).toEqual({
      ok: false,
      code: "CONFLICT",
    });
    const rows = await activityRows(w.orgId);
    expect(rows.length).toBe(count);
    expect(rows.find((r) => r.verb === "COMMENT_EDITED")).toMatchObject({
      entityType: "COMMENT",
      entityId: added.commentId,
      after: { commentId: added.commentId },
    });
    expect(JSON.stringify(rows)).not.toContain("second");
  });

  it("the author or a manager deletes with COMMENT_DELETED; another member is NOT_ALLOWED", async () => {
    const w = await world();
    const a = await addTaskComment(w.member, w.task.id, { body: "one" });
    const b = await addTaskComment(w.member, w.task.id, { body: "two" });
    if (!a.ok || !b.ok) throw new Error("not added");
    expect(await deleteTaskComment(w.other, a.commentId)).toEqual({
      ok: false,
      code: "NOT_ALLOWED",
    });
    expect(await deleteTaskComment(w.member, a.commentId)).toEqual({ ok: true, deleted: true });
    expect(await deleteTaskComment(w.manager, b.commentId)).toEqual({ ok: true, deleted: true });
    expect(await prisma.taskComment.count({ where: { organizationId: w.orgId } })).toBe(0);
    const deleted = (await activityRows(w.orgId)).filter((r) => r.verb === "COMMENT_DELETED");
    expect(deleted.map((r) => r.before)).toEqual([
      { commentId: a.commentId, authorUserId: w.users.member },
      { commentId: b.commentId, authorUserId: w.users.member },
    ]);
    expect(await deleteTaskComment(w.member, a.commentId)).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
  });
});
