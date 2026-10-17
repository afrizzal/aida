// Phase 14 task attachments (contract sections 1, 2, 12, 14 and 15; D-14, C10, K66, AIDA-67).
// Relative imports only, no Next.js import (the worker reaches these modules too).
//
// Upload order (C10, the order of the ticket message route, not its renderMarkdown call):
// the file count, a CONTENT pre-check without a lock (a reader without access is refused before
// anything is stored), validateUpload on every file before any is stored (size before reading,
// then the sniffed type against ALLOWED_MIME), server-generated keys from buildStorageKey (the
// file name never reaches a path), saveStagedFiles before the transaction, then the transaction
// re-checks CONTENT under PROJECT_SHARE with the task FOR SHARE and inserts the rows. Any refusal
// or thrown error after staging calls discard() before returning or rethrowing.
// File names are untrusted metadata (cleaned by validateUpload, shown as text only).
// Every read, the download read included, checks current project access (READ); the download
// read returns metadata only, for the Phase 15 route to stream. It never uses the
// organization-only lookup of the ticket download route.
// deleteTaskAttachment (UPLOADER_OR_MANAGE) deletes the row and writes its storage key to
// ProjectFileCleanup in the same transaction (K66); the scheduled sweep removes the file.

import type { FileStorage } from "../attachments/file-storage";
import { buildStorageKey, localFileStorage } from "../attachments/local-file-storage";
import { saveStagedFiles } from "../attachments/staged-files";
import {
  type UploadCandidate,
  type ValidatedUpload,
  validateUpload,
} from "../attachments/validate-upload";
import {
  readableProjectWhere,
  refuseUnreadable,
  requireMembership,
  requireProject,
  requireTask,
} from "./access";
import { recordProjectActivity } from "./activity";
import { cursorDate, decodeCursor, encodeCursor, type PageOpts, pageLimit } from "./comments";
import {
  ACTIVITY_TEXT_MAX,
  MAX_UPLOAD_FILES,
  type ProjectActor,
  type ProjectResult,
} from "./contract";
import { enqueueFileCleanupInTx } from "./file-cleanup";
import {
  afterLock,
  afterReadCheck,
  isPlausibleId,
  newBatchId,
  type ProjectDb,
  refusalResult,
  refuse,
  runProjectRead,
  runProjectReadInTransaction,
  runProjectTransaction,
} from "./service";

export interface TaskAttachmentView {
  id: string;
  taskId: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByUserId: string | null;
  createdAt: Date;
}

const VIEW_SELECT = {
  id: true,
  taskId: true,
  originalFilename: true,
  mimeType: true,
  sizeBytes: true,
  uploadedByUserId: true,
  createdAt: true,
} as const;

/** A short label for activity values (contract section 5: at most 200 code points). */
function shortLabel(value: string): string {
  return [...value].slice(0, ACTIVITY_TEXT_MAX).join("");
}

function keysetWhere(cursor: { sortValue: string; id: string } | null) {
  if (!cursor) return {};
  const at = cursorDate(cursor.sortValue);
  return { OR: [{ createdAt: { gt: at } }, { createdAt: at, id: { gt: cursor.id } }] };
}

function pageOf<T extends { id: string; createdAt: Date }>(rows: T[], limit: number) {
  const page = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  const last = page[page.length - 1];
  return {
    page,
    hasMore,
    nextCursor: hasMore && last ? encodeCursor(last.createdAt.toISOString(), last.id) : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Reads

/** READ: the task's attachments, oldest first, keyset paged. */
export async function listTaskAttachments(
  actor: ProjectActor,
  taskId: string,
  opts: PageOpts = {},
): Promise<
  ProjectResult<{ attachments: TaskAttachmentView[]; hasMore: boolean; nextCursor: string | null }>
> {
  return runProjectReadInTransaction(actor, "listTaskAttachments", async (db) => {
    const limit = pageLimit(opts.limit);
    const cursor = decodeCursor(opts.cursor);
    await requireTask(db, actor, taskId, { lock: "none", level: "READ" });
    await afterReadCheck(db, "listTaskAttachments");
    const rows = await db.taskAttachment.findMany({
      // Codex diff D1: the current read predicate in the content query itself.
      where: {
        organizationId: actor.orgId,
        taskId,
        task: { organizationId: actor.orgId, project: readableProjectWhere(actor) },
        ...keysetWhere(cursor),
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit + 1,
      select: VIEW_SELECT,
    });
    const { page, hasMore, nextCursor } = pageOf(rows, limit);
    return { attachments: page, hasMore, nextCursor };
  });
}

/** READ: every attachment of the project's tasks with each task's key, oldest first. */
export async function listProjectAttachments(
  actor: ProjectActor,
  projectId: string,
  opts: PageOpts = {},
): Promise<
  ProjectResult<{
    attachments: (TaskAttachmentView & { taskKey: string })[];
    hasMore: boolean;
    nextCursor: string | null;
  }>
> {
  return runProjectReadInTransaction(actor, "listProjectAttachments", async (db) => {
    const limit = pageLimit(opts.limit);
    const cursor = decodeCursor(opts.cursor);
    await requireProject(db, actor, projectId, { lock: "none", level: "READ" });
    await afterReadCheck(db, "listProjectAttachments");
    const rows = await db.taskAttachment.findMany({
      where: {
        organizationId: actor.orgId,
        task: { organizationId: actor.orgId, projectId, project: readableProjectWhere(actor) },
        ...keysetWhere(cursor),
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit + 1,
      select: { ...VIEW_SELECT, task: { select: { key: true } } },
    });
    const { page, hasMore, nextCursor } = pageOf(rows, limit);
    return {
      attachments: page.map(({ task, ...row }) => ({ ...row, taskKey: task.key })),
      hasMore,
      nextCursor,
    };
  });
}

/**
 * READ: the metadata a download route needs, only after the project access check (T-14-33).
 * Unknown and unreadable ids are the same NOT_FOUND.
 */
export async function getTaskAttachmentForDownload(
  actor: ProjectActor,
  attachmentId: string,
): Promise<
  ProjectResult<{
    attachment: {
      id: string;
      taskId: string;
      storageKey: string;
      mimeType: string;
      originalFilename: string;
      sizeBytes: number;
    };
  }>
> {
  return runProjectReadInTransaction(actor, "getTaskAttachmentForDownload", async (db) => {
    if (!isPlausibleId(attachmentId)) refuse("NOT_FOUND");
    await afterReadCheck(db, "getTaskAttachmentForDownload");
    const row = await db.taskAttachment.findFirst({
      where: {
        id: attachmentId,
        organizationId: actor.orgId,
        task: { organizationId: actor.orgId, project: readableProjectWhere(actor) },
      },
      select: {
        id: true,
        taskId: true,
        storageKey: true,
        mimeType: true,
        originalFilename: true,
        sizeBytes: true,
      },
    });
    // K73: no row under the predicate is MEMBERSHIP_ENDED once the member row is gone.
    if (!row) return refuseUnreadable(db, actor);
    await requireTask(db, actor, row.taskId, { lock: "none", level: "READ" });
    return { attachment: row };
  });
}

// ---------------------------------------------------------------------------------------------
// Writes

export interface UploadOpts {
  /** The storage (default localFileStorage); tests inject a failing one. */
  storage?: FileStorage;
}

/** CONTENT under PROJECT_SHARE: validates, stages and attaches 1 to MAX_UPLOAD_FILES files. */
export async function uploadTaskAttachments(
  actor: ProjectActor,
  taskId: string,
  files: readonly UploadCandidate[],
  opts: UploadOpts = {},
): Promise<ProjectResult<{ attachments: TaskAttachmentView[] }>> {
  if (!Array.isArray(files) || files.length === 0) return refusalResult("INVALID_INPUT", "files");
  if (files.length > MAX_UPLOAD_FILES) return refusalResult("TOO_MANY");

  const precheck = await runProjectRead(actor, "uploadTaskAttachments", async (db) => {
    await requireTask(db, actor, taskId, { lock: "none", level: "CONTENT" });
    return {};
  });
  if (!precheck.ok) return precheck;

  const validated: (ValidatedUpload & { key: string })[] = [];
  for (const file of files) {
    const result = await validateUpload(file);
    if (!result.ok) return refusalResult(result.code);
    validated.push({ ...result, key: buildStorageKey(result.originalFilename) });
  }

  const storage = opts.storage ?? localFileStorage;
  const staged = await saveStagedFiles(
    storage,
    actor.orgId,
    validated.map((file) => ({ key: file.key, data: file.buffer })),
  );

  let result: ProjectResult<{ attachments: TaskAttachmentView[] }>;
  try {
    result = await runProjectTransaction(actor, "uploadTaskAttachments", async (tx) => {
      const access = await requireTask(tx, actor, taskId, {
        lock: "share",
        level: "CONTENT",
        taskLock: "share",
      });
      await afterLock(tx, "uploadTaskAttachments");
      const batchId = newBatchId();
      const attachments: TaskAttachmentView[] = [];
      for (const file of validated) {
        const row = await tx.taskAttachment.create({
          data: {
            organizationId: actor.orgId,
            taskId: access.task.id,
            storageKey: file.key,
            originalFilename: file.originalFilename,
            mimeType: file.mimeType,
            sizeBytes: file.sizeBytes,
            uploadedByUserId: actor.userId,
          },
          select: VIEW_SELECT,
        });
        await recordProjectActivity(tx, {
          orgId: actor.orgId,
          projectId: access.task.projectId,
          taskId: access.task.id,
          actorUserId: actor.userId,
          verb: "ATTACHMENT_ADDED",
          entityType: "ATTACHMENT",
          entityId: row.id,
          after: {
            attachmentId: row.id,
            fileName: shortLabel(row.originalFilename),
            mimeType: row.mimeType,
            sizeBytes: row.sizeBytes,
          },
          batchId,
        });
        attachments.push(row);
      }
      return { attachments };
    });
  } catch (err) {
    await staged.discard();
    throw err;
  }
  if (!result.ok) await staged.discard();
  return result;
}

async function attachmentRow(tx: ProjectDb, actor: ProjectActor, attachmentId: string) {
  await requireMembership(tx, actor);
  if (!isPlausibleId(attachmentId)) refuse("NOT_FOUND");
  const row = await tx.taskAttachment.findFirst({
    where: { id: attachmentId, organizationId: actor.orgId },
    select: { taskId: true, uploadedByUserId: true },
  });
  return row ?? refuse("NOT_FOUND");
}

/**
 * UPLOADER_OR_MANAGE under PROJECT_SHARE: deletes the row, queues its storage key in
 * ProjectFileCleanup in the same transaction (K66) and writes ATTACHMENT_DELETED.
 */
export async function deleteTaskAttachment(
  actor: ProjectActor,
  attachmentId: string,
): Promise<ProjectResult<{ cleanupQueued: number }>> {
  return runProjectTransaction(actor, "deleteTaskAttachment", async (tx) => {
    const found = await attachmentRow(tx, actor, attachmentId);
    const access = await requireTask(tx, actor, found.taskId, {
      lock: "share",
      level: "UPLOADER_OR_MANAGE",
      taskLock: "share",
      allow: () => found.uploadedByUserId !== null && found.uploadedByUserId === actor.userId,
    });
    await afterLock(tx, "deleteTaskAttachment");
    const row = await tx.taskAttachment.findFirst({
      where: { id: attachmentId, organizationId: actor.orgId, taskId: found.taskId },
      select: { storageKey: true, originalFilename: true },
    });
    if (!row) refuse("NOT_FOUND");
    const removed = await tx.taskAttachment.deleteMany({
      where: { id: attachmentId, organizationId: actor.orgId, taskId: found.taskId },
    });
    if (removed.count !== 1) refuse("NOT_FOUND");
    const cleanupQueued = await enqueueFileCleanupInTx(tx, actor.orgId, [row.storageKey]);
    await recordProjectActivity(tx, {
      orgId: actor.orgId,
      projectId: access.task.projectId,
      taskId: found.taskId,
      actorUserId: actor.userId,
      verb: "ATTACHMENT_DELETED",
      entityType: "ATTACHMENT",
      entityId: attachmentId,
      before: { attachmentId, fileName: shortLabel(row.originalFilename) },
      batchId: newBatchId(),
    });
    return { cleanupQueued };
  });
}
