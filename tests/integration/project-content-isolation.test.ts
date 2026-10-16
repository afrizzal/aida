// Phase 14 content isolation (contract section 17, review C5, K69) on a real Postgres through
// Testcontainers. Every comment, attachment, label and milestone operation is called by each
// actor of the privacy world on a private project: manager and member get their level's result
// (member NOT_ALLOWED on MANAGE, AUTHOR and UPLOADER rules applied); teamMember (team only, K69),
// nonMember, orgAdmin and outsider get a result deep-equal to the call with missingId() (TARGET),
// and listWorkspaceMilestones (LIST) shows them none of the private project's milestones; the
// outsider with organization A gets MEMBERSHIP_ENDED; refused writes change no row and add no
// activity. Every attachment download read is covered.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  addTaskComment,
  deleteTaskComment,
  editTaskComment,
  listTaskComments,
} from "@/lib/projects/comments";
import {
  createLabel,
  deleteLabel,
  listLabels,
  setTaskLabels,
  updateLabel,
} from "@/lib/projects/labels";
import {
  createMilestone,
  deleteMilestone,
  listProjectMilestones,
  listWorkspaceMilestones,
  setTaskMilestone,
  updateMilestone,
} from "@/lib/projects/milestones";
import {
  actorOf,
  filesUnder,
  missingId,
  type PrivacyWorld,
  projectTableSnapshot,
  seedAttachment,
  seedComment,
  seedPrivacyWorld,
} from "../support/project-fixtures";

// localFileStorage reads UPLOADS_DIR when its module loads: attachments are imported after the
// variable points at a fresh temporary directory.
let att: typeof import("@/lib/projects/attachments");
let uploadsDir = "";
// Review c-IN-02: the previous value is restored after the file. The temporary directory stays:
// the charter allows no recursive delete.
const previousUploadsDir = process.env.UPLOADS_DIR;

beforeAll(async () => {
  uploadsDir = await mkdtemp(path.join(tmpdir(), "aida-content-isolation-"));
  process.env.UPLOADS_DIR = uploadsDir;
  att = await import("@/lib/projects/attachments");
});

afterAll(() => {
  if (previousUploadsDir === undefined) delete process.env.UPLOADS_DIR;
  else process.env.UPLOADS_DIR = previousUploadsDir;
});

const MEMBERSHIP_ENDED = { ok: false, code: "MEMBERSHIP_ENDED" };
const NOT_ALLOWED = { ok: false, code: "NOT_ALLOWED" };
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const png = () => [
  {
    name: "p.png",
    size: PNG.length,
    arrayBuffer: async () => Uint8Array.from(PNG).buffer,
  },
];

function refused(pw: PrivacyWorld) {
  return [pw.actors.teamMember, pw.actors.nonMember, pw.actors.orgAdmin, pw.actors.outsider];
}

function endedOutsider(pw: PrivacyWorld) {
  return actorOf(pw.users.outsider, pw.orgA);
}

function activityCount(orgId: string): Promise<number> {
  return prisma.projectActivity.count({ where: { organizationId: orgId } });
}

describe("listTaskComments isolation", () => {
  it("refused actors get the missing-id result; members read", async () => {
    const pw = await seedPrivacyWorld(prisma);
    for (const actor of refused(pw)) {
      expect(await listTaskComments(actor, pw.task.id)).toEqual(
        await listTaskComments(actor, missingId()),
      );
    }
    expect(await listTaskComments(endedOutsider(pw), pw.task.id)).toEqual(MEMBERSHIP_ENDED);
    for (const actor of [pw.actors.manager, pw.actors.member]) {
      const r = await listTaskComments(actor, pw.task.id);
      expect(r.ok && r.comments.map((c) => c.id)).toEqual([pw.comment.id]);
    }
  });
});

describe("addTaskComment isolation", () => {
  it("refused actors get the missing-id result and change nothing; members get their level's result", async () => {
    const pw = await seedPrivacyWorld(prisma);
    const snapshot = await projectTableSnapshot(prisma, pw.orgA);
    const count = await activityCount(pw.orgA);
    for (const actor of refused(pw)) {
      expect(await addTaskComment(actor, pw.task.id, { body: "hi" })).toEqual(
        await addTaskComment(actor, missingId(), { body: "hi" }),
      );
    }
    expect(await addTaskComment(endedOutsider(pw), pw.task.id, { body: "hi" })).toEqual(
      MEMBERSHIP_ENDED,
    );
    expect(await projectTableSnapshot(prisma, pw.orgA)).toEqual(snapshot);
    expect(await activityCount(pw.orgA)).toBe(count);
    for (const actor of [pw.actors.manager, pw.actors.member]) {
      expect(await addTaskComment(actor, pw.task.id, { body: "hi" })).toMatchObject({ ok: true });
    }
  });
});

describe("editTaskComment isolation", () => {
  it("refused actors get the missing-id result and change nothing; members get their level's result", async () => {
    const pw = await seedPrivacyWorld(prisma);
    const snapshot = await projectTableSnapshot(prisma, pw.orgA);
    const count = await activityCount(pw.orgA);
    for (const actor of refused(pw)) {
      expect(await editTaskComment(actor, pw.comment.id, 0, { body: "edited" })).toEqual(
        await editTaskComment(actor, missingId(), 0, { body: "edited" }),
      );
    }
    expect(await editTaskComment(endedOutsider(pw), pw.comment.id, 0, { body: "edited" })).toEqual(
      MEMBERSHIP_ENDED,
    );
    expect(await projectTableSnapshot(prisma, pw.orgA)).toEqual(snapshot);
    expect(await activityCount(pw.orgA)).toBe(count);
    expect(await editTaskComment(pw.actors.manager, pw.comment.id, 0, { body: "x" })).toEqual(
      NOT_ALLOWED,
    );
    expect(await editTaskComment(pw.actors.member, pw.comment.id, 0, { body: "x" })).toEqual({
      ok: true,
      changed: true,
      version: 1,
    });
  });
});

describe("deleteTaskComment isolation", () => {
  it("refused actors get the missing-id result and change nothing; members get their level's result", async () => {
    const pw = await seedPrivacyWorld(prisma);
    const snapshot = await projectTableSnapshot(prisma, pw.orgA);
    const count = await activityCount(pw.orgA);
    for (const actor of refused(pw)) {
      expect(await deleteTaskComment(actor, pw.comment.id)).toEqual(
        await deleteTaskComment(actor, missingId()),
      );
    }
    expect(await deleteTaskComment(endedOutsider(pw), pw.comment.id)).toEqual(MEMBERSHIP_ENDED);
    expect(await projectTableSnapshot(prisma, pw.orgA)).toEqual(snapshot);
    expect(await activityCount(pw.orgA)).toBe(count);
    const managers = await seedComment(prisma, pw.orgA, pw.task.id, {
      authorUserId: pw.users.manager,
    });
    expect(await deleteTaskComment(pw.actors.member, managers.id)).toEqual(NOT_ALLOWED);
    expect(await deleteTaskComment(pw.actors.member, pw.comment.id)).toMatchObject({ ok: true });
    expect(await deleteTaskComment(pw.actors.manager, managers.id)).toMatchObject({ ok: true });
  });
});

describe("listTaskAttachments isolation", () => {
  it("refused actors get the missing-id result; members read", async () => {
    const pw = await seedPrivacyWorld(prisma);
    for (const actor of refused(pw)) {
      expect(await att.listTaskAttachments(actor, pw.task.id)).toEqual(
        await att.listTaskAttachments(actor, missingId()),
      );
    }
    expect(await att.listTaskAttachments(endedOutsider(pw), pw.task.id)).toEqual(MEMBERSHIP_ENDED);
    for (const actor of [pw.actors.manager, pw.actors.member]) {
      const r = await att.listTaskAttachments(actor, pw.task.id);
      expect(r.ok && r.attachments.map((a) => a.id)).toEqual([pw.attachment.id]);
    }
  });
});

describe("listProjectAttachments isolation", () => {
  it("refused actors get the missing-id result; members read", async () => {
    const pw = await seedPrivacyWorld(prisma);
    for (const actor of refused(pw)) {
      expect(await att.listProjectAttachments(actor, pw.project.id)).toEqual(
        await att.listProjectAttachments(actor, missingId()),
      );
    }
    expect(await att.listProjectAttachments(endedOutsider(pw), pw.project.id)).toEqual(
      MEMBERSHIP_ENDED,
    );
    for (const actor of [pw.actors.manager, pw.actors.member]) {
      const r = await att.listProjectAttachments(actor, pw.project.id);
      expect(r.ok && r.attachments.map((a) => a.taskKey)).toEqual([pw.task.key]);
    }
  });
});

describe("getTaskAttachmentForDownload isolation", () => {
  it("refused actors get the missing-id result; members read", async () => {
    const pw = await seedPrivacyWorld(prisma);
    for (const actor of refused(pw)) {
      expect(await att.getTaskAttachmentForDownload(actor, pw.attachment.id)).toEqual(
        await att.getTaskAttachmentForDownload(actor, missingId()),
      );
    }
    expect(await att.getTaskAttachmentForDownload(endedOutsider(pw), pw.attachment.id)).toEqual(
      MEMBERSHIP_ENDED,
    );
    for (const actor of [pw.actors.manager, pw.actors.member]) {
      expect(await att.getTaskAttachmentForDownload(actor, pw.attachment.id)).toMatchObject({
        ok: true,
        attachment: { id: pw.attachment.id, storageKey: pw.attachment.storageKey },
      });
    }
  });
});

describe("uploadTaskAttachments isolation", () => {
  it("refused actors get the missing-id result and change nothing; members get their level's result", async () => {
    const pw = await seedPrivacyWorld(prisma);
    const snapshot = await projectTableSnapshot(prisma, pw.orgA);
    const count = await activityCount(pw.orgA);
    // Review c-WR-02: a refused upload writes no file, in either organization's directory.
    const diskOf = () =>
      Promise.all([pw.orgA, pw.orgB].map((orgId) => filesUnder(path.join(uploadsDir, orgId))));
    const disk = await diskOf();
    for (const actor of refused(pw)) {
      expect(await att.uploadTaskAttachments(actor, pw.task.id, png())).toEqual(
        await att.uploadTaskAttachments(actor, missingId(), png()),
      );
    }
    expect(await att.uploadTaskAttachments(endedOutsider(pw), pw.task.id, png())).toEqual(
      MEMBERSHIP_ENDED,
    );
    expect(await projectTableSnapshot(prisma, pw.orgA)).toEqual(snapshot);
    expect(await activityCount(pw.orgA)).toBe(count);
    expect(await diskOf()).toEqual(disk);
    for (const actor of [pw.actors.manager, pw.actors.member]) {
      expect(await att.uploadTaskAttachments(actor, pw.task.id, png())).toMatchObject({ ok: true });
    }
  });
});

describe("deleteTaskAttachment isolation", () => {
  it("refused actors get the missing-id result and change nothing; members get their level's result", async () => {
    const pw = await seedPrivacyWorld(prisma);
    const snapshot = await projectTableSnapshot(prisma, pw.orgA);
    const count = await activityCount(pw.orgA);
    for (const actor of refused(pw)) {
      expect(await att.deleteTaskAttachment(actor, pw.attachment.id)).toEqual(
        await att.deleteTaskAttachment(actor, missingId()),
      );
    }
    expect(await att.deleteTaskAttachment(endedOutsider(pw), pw.attachment.id)).toEqual(
      MEMBERSHIP_ENDED,
    );
    expect(await projectTableSnapshot(prisma, pw.orgA)).toEqual(snapshot);
    expect(await activityCount(pw.orgA)).toBe(count);
    const managers = await seedAttachment(prisma, pw.orgA, pw.task.id, {
      uploadedByUserId: pw.users.manager,
    });
    expect(await att.deleteTaskAttachment(pw.actors.member, managers.id)).toEqual(NOT_ALLOWED);
    expect(await att.deleteTaskAttachment(pw.actors.manager, pw.attachment.id)).toMatchObject({
      ok: true,
    });
  });
});

describe("listLabels isolation", () => {
  it("refused actors get the missing-id result; members read", async () => {
    const pw = await seedPrivacyWorld(prisma);
    for (const actor of refused(pw)) {
      expect(await listLabels(actor, pw.project.id)).toEqual(await listLabels(actor, missingId()));
    }
    expect(await listLabels(endedOutsider(pw), pw.project.id)).toEqual(MEMBERSHIP_ENDED);
    for (const actor of [pw.actors.manager, pw.actors.member]) {
      const r = await listLabels(actor, pw.project.id);
      expect(r.ok && r.labels.map((l) => l.id)).toEqual([pw.label.id]);
    }
  });
});

describe("createLabel isolation", () => {
  it("refused actors get the missing-id result and change nothing; members get their level's result", async () => {
    const pw = await seedPrivacyWorld(prisma);
    const snapshot = await projectTableSnapshot(prisma, pw.orgA);
    const count = await activityCount(pw.orgA);
    for (const actor of refused(pw)) {
      expect(await createLabel(actor, pw.project.id, { name: "New" })).toEqual(
        await createLabel(actor, missingId(), { name: "New" }),
      );
    }
    expect(await createLabel(endedOutsider(pw), pw.project.id, { name: "New" })).toEqual(
      MEMBERSHIP_ENDED,
    );
    expect(await projectTableSnapshot(prisma, pw.orgA)).toEqual(snapshot);
    expect(await activityCount(pw.orgA)).toBe(count);
    expect(await createLabel(pw.actors.member, pw.project.id, { name: "New" })).toEqual(
      NOT_ALLOWED,
    );
    expect(await createLabel(pw.actors.manager, pw.project.id, { name: "New" })).toMatchObject({
      ok: true,
    });
  });
});

describe("updateLabel isolation", () => {
  it("refused actors get the missing-id result and change nothing; members get their level's result", async () => {
    const pw = await seedPrivacyWorld(prisma);
    const snapshot = await projectTableSnapshot(prisma, pw.orgA);
    const count = await activityCount(pw.orgA);
    for (const actor of refused(pw)) {
      expect(await updateLabel(actor, pw.label.id, { name: "Renamed" })).toEqual(
        await updateLabel(actor, missingId(), { name: "Renamed" }),
      );
    }
    expect(await updateLabel(endedOutsider(pw), pw.label.id, { name: "Renamed" })).toEqual(
      MEMBERSHIP_ENDED,
    );
    expect(await projectTableSnapshot(prisma, pw.orgA)).toEqual(snapshot);
    expect(await activityCount(pw.orgA)).toBe(count);
    expect(await updateLabel(pw.actors.member, pw.label.id, { name: "R" })).toEqual(NOT_ALLOWED);
    expect(await updateLabel(pw.actors.manager, pw.label.id, { name: "R" })).toMatchObject({
      ok: true,
      changed: true,
    });
  });
});

describe("deleteLabel isolation", () => {
  it("refused actors get the missing-id result and change nothing; members get their level's result", async () => {
    const pw = await seedPrivacyWorld(prisma);
    const snapshot = await projectTableSnapshot(prisma, pw.orgA);
    const count = await activityCount(pw.orgA);
    for (const actor of refused(pw)) {
      expect(await deleteLabel(actor, pw.label.id)).toEqual(await deleteLabel(actor, missingId()));
    }
    expect(await deleteLabel(endedOutsider(pw), pw.label.id)).toEqual(MEMBERSHIP_ENDED);
    expect(await projectTableSnapshot(prisma, pw.orgA)).toEqual(snapshot);
    expect(await activityCount(pw.orgA)).toBe(count);
    expect(await deleteLabel(pw.actors.member, pw.label.id)).toEqual(NOT_ALLOWED);
    expect(await deleteLabel(pw.actors.manager, pw.label.id)).toEqual({
      ok: true,
      affectedTaskCount: 1,
    });
  });
});

describe("setTaskLabels isolation", () => {
  it("refused actors get the missing-id result and change nothing; members get their level's result", async () => {
    const pw = await seedPrivacyWorld(prisma);
    const snapshot = await projectTableSnapshot(prisma, pw.orgA);
    const count = await activityCount(pw.orgA);
    for (const actor of refused(pw)) {
      expect(await setTaskLabels(actor, pw.task.id, 0, [])).toEqual(
        await setTaskLabels(actor, missingId(), 0, []),
      );
    }
    expect(await setTaskLabels(endedOutsider(pw), pw.task.id, 0, [])).toEqual(MEMBERSHIP_ENDED);
    expect(await projectTableSnapshot(prisma, pw.orgA)).toEqual(snapshot);
    expect(await activityCount(pw.orgA)).toBe(count);
    expect(await setTaskLabels(pw.actors.member, pw.task.id, 0, [])).toMatchObject({ ok: true });
    expect(await setTaskLabels(pw.actors.manager, pw.task.id, 1, [pw.label.id])).toMatchObject({
      ok: true,
      version: 2,
    });
  });
});

describe("listProjectMilestones isolation", () => {
  it("refused actors get the missing-id result; members read", async () => {
    const pw = await seedPrivacyWorld(prisma);
    for (const actor of refused(pw)) {
      expect(await listProjectMilestones(actor, pw.project.id)).toEqual(
        await listProjectMilestones(actor, missingId()),
      );
    }
    expect(await listProjectMilestones(endedOutsider(pw), pw.project.id)).toEqual(MEMBERSHIP_ENDED);
    for (const actor of [pw.actors.manager, pw.actors.member]) {
      const r = await listProjectMilestones(actor, pw.project.id);
      expect(r.ok && r.milestones.map((m) => m.id)).toEqual([pw.milestone.id]);
    }
  });
});

describe("createMilestone isolation", () => {
  it("refused actors get the missing-id result and change nothing; members get their level's result", async () => {
    const pw = await seedPrivacyWorld(prisma);
    const snapshot = await projectTableSnapshot(prisma, pw.orgA);
    const count = await activityCount(pw.orgA);
    for (const actor of refused(pw)) {
      expect(
        await createMilestone(actor, pw.project.id, { name: "M", date: "2026-08-01" }),
      ).toEqual(await createMilestone(actor, missingId(), { name: "M", date: "2026-08-01" }));
    }
    expect(
      await createMilestone(endedOutsider(pw), pw.project.id, { name: "M", date: "2026-08-01" }),
    ).toEqual(MEMBERSHIP_ENDED);
    expect(await projectTableSnapshot(prisma, pw.orgA)).toEqual(snapshot);
    expect(await activityCount(pw.orgA)).toBe(count);
    const input = { name: "M", date: "2026-08-01" };
    expect(await createMilestone(pw.actors.member, pw.project.id, input)).toEqual(NOT_ALLOWED);
    expect(await createMilestone(pw.actors.manager, pw.project.id, input)).toMatchObject({
      ok: true,
    });
  });
});

describe("updateMilestone isolation", () => {
  it("refused actors get the missing-id result and change nothing; members get their level's result", async () => {
    const pw = await seedPrivacyWorld(prisma);
    const snapshot = await projectTableSnapshot(prisma, pw.orgA);
    const count = await activityCount(pw.orgA);
    for (const actor of refused(pw)) {
      expect(await updateMilestone(actor, pw.milestone.id, 0, { name: "Renamed" })).toEqual(
        await updateMilestone(actor, missingId(), 0, { name: "Renamed" }),
      );
    }
    expect(
      await updateMilestone(endedOutsider(pw), pw.milestone.id, 0, { name: "Renamed" }),
    ).toEqual(MEMBERSHIP_ENDED);
    expect(await projectTableSnapshot(prisma, pw.orgA)).toEqual(snapshot);
    expect(await activityCount(pw.orgA)).toBe(count);
    expect(await updateMilestone(pw.actors.member, pw.milestone.id, 0, { name: "R" })).toEqual(
      NOT_ALLOWED,
    );
    expect(await updateMilestone(pw.actors.manager, pw.milestone.id, 0, { name: "R" })).toEqual({
      ok: true,
      changed: true,
      version: 1,
    });
  });
});

describe("deleteMilestone isolation", () => {
  it("refused actors get the missing-id result and change nothing; members get their level's result", async () => {
    const pw = await seedPrivacyWorld(prisma);
    const snapshot = await projectTableSnapshot(prisma, pw.orgA);
    const count = await activityCount(pw.orgA);
    for (const actor of refused(pw)) {
      expect(await deleteMilestone(actor, pw.milestone.id)).toEqual(
        await deleteMilestone(actor, missingId()),
      );
    }
    expect(await deleteMilestone(endedOutsider(pw), pw.milestone.id)).toEqual(MEMBERSHIP_ENDED);
    expect(await projectTableSnapshot(prisma, pw.orgA)).toEqual(snapshot);
    expect(await activityCount(pw.orgA)).toBe(count);
    expect(await deleteMilestone(pw.actors.member, pw.milestone.id)).toEqual(NOT_ALLOWED);
    expect(await deleteMilestone(pw.actors.manager, pw.milestone.id)).toEqual({
      ok: true,
      affectedTaskCount: 1,
    });
  });
});

describe("setTaskMilestone isolation", () => {
  it("refused actors get the missing-id result and change nothing; members get their level's result", async () => {
    const pw = await seedPrivacyWorld(prisma);
    const snapshot = await projectTableSnapshot(prisma, pw.orgA);
    const count = await activityCount(pw.orgA);
    for (const actor of refused(pw)) {
      expect(await setTaskMilestone(actor, pw.task.id, 0, null)).toEqual(
        await setTaskMilestone(actor, missingId(), 0, null),
      );
    }
    expect(await setTaskMilestone(endedOutsider(pw), pw.task.id, 0, null)).toEqual(
      MEMBERSHIP_ENDED,
    );
    expect(await projectTableSnapshot(prisma, pw.orgA)).toEqual(snapshot);
    expect(await activityCount(pw.orgA)).toBe(count);
    expect(await setTaskMilestone(pw.actors.member, pw.task.id, 0, null)).toMatchObject({
      ok: true,
      version: 1,
    });
    expect(await setTaskMilestone(pw.actors.manager, pw.task.id, 1, pw.milestone.id)).toMatchObject(
      { ok: true, version: 2 },
    );
  });
});

describe("listWorkspaceMilestones isolation", () => {
  it("refused actors see none of the private project's milestones (LIST: no missingId()), the manager does", async () => {
    const pw = await seedPrivacyWorld(prisma);
    for (const actor of refused(pw)) {
      const result = await listWorkspaceMilestones(actor);
      expect(result.ok).toBe(true);
      const text = JSON.stringify(result);
      for (const secret of [pw.milestone.id, pw.milestone.name, pw.project.id]) {
        expect(text).not.toContain(secret);
      }
    }
    expect(await listWorkspaceMilestones(endedOutsider(pw))).toEqual(MEMBERSHIP_ENDED);
    for (const actor of [pw.actors.manager, pw.actors.member]) {
      const result = await listWorkspaceMilestones(actor);
      expect(result.ok && result.milestones.map((m) => m.id)).toContain(pw.milestone.id);
    }
  });
});
