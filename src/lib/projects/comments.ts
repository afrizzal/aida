// Phase 14 task comments (contract sections 1, 2, 5, 14 and 15; D-14, K65, AIDA-67, AIDA-68).
// Relative imports only, no Next.js import (the worker reaches these modules too).
//
// A comment body is untrusted Markdown: it is stored as written (after trim) and read back as
// bodyHtml from renderTaskMarkdown, which removes every image and keeps safe live links (K65).
// Activity rows hold ids only, never the body (contract section 5, T-14-36).
// Writes run under PROJECT_SHARE with the task FOR SHARE (a subtask's parent first) through
// requireTask; edit is AUTHOR, delete AUTHOR_OR_MANAGE. A comment id is resolved to its task with
// an explicit organization term after the membership read; an unknown or unreadable comment is
// NOT_FOUND, identical to a missing id.
import { renderTaskMarkdown } from "../markdown/render";
import { requireTask } from "./access";
import { recordProjectActivity } from "./activity";
import {
  COMMENT_BODY_MAX,
  codePointLength,
  hasNul,
  LIST_DEFAULT,
  LIST_MAX,
  type ProjectActor,
  type ProjectResult,
} from "./contract";
import {
  afterLock,
  isPlausibleId,
  newBatchId,
  refuse,
  runProjectRead,
  runProjectTransaction,
} from "./service";

// ---------------------------------------------------------------------------------------------
// Shared list helpers (keyset paging, contract section 15), also used by attachments and
// milestones.

/** A page request: an opaque cursor from the previous page and a limit (1 to LIST_MAX). */
export interface PageOpts {
  cursor?: string | null;
  limit?: number;
}

/** The validated limit (default LIST_DEFAULT) or INVALID_INPUT field limit. */
export function pageLimit(raw: unknown): number {
  if (raw === undefined || raw === null) return LIST_DEFAULT;
  if (!Number.isSafeInteger(raw) || (raw as number) < 1 || (raw as number) > LIST_MAX) {
    refuse("INVALID_INPUT", "limit");
  }
  return raw as number;
}

/** An opaque keyset cursor over (sort value, id). */
export function encodeCursor(sortValue: string, id: string): string {
  return Buffer.from(JSON.stringify([sortValue, id]), "utf8").toString("base64url");
}

/** The decoded cursor, null for none, or INVALID_INPUT field cursor. */
export function decodeCursor(raw: unknown): { sortValue: string; id: string } | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string" || raw.length > 512) refuse("INVALID_INPUT", "cursor");
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === "string" &&
      isPlausibleId(parsed[1])
    ) {
      return { sortValue: parsed[0], id: parsed[1] };
    }
  } catch {
    // fall through to the refusal
  }
  return refuse("INVALID_INPUT", "cursor");
}

/** A cursor's createdAt as a Date, or INVALID_INPUT field cursor. */
export function cursorDate(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) refuse("INVALID_INPUT", "cursor");
  return date;
}

// ---------------------------------------------------------------------------------------------
// Validation

function validBody(raw: unknown): string {
  if (typeof raw !== "string" || hasNul(raw)) refuse("INVALID_INPUT", "body");
  const body = raw.trim();
  const length = codePointLength(body);
  if (length < 1 || length > COMMENT_BODY_MAX) refuse("INVALID_INPUT", "body");
  return body;
}

// ---------------------------------------------------------------------------------------------
// Reads

export interface TaskCommentView {
  id: string;
  taskId: string;
  authorUserId: string | null;
  bodyMarkdown: string;
  /** renderTaskMarkdown output: no images, safe live links (K65). */
  bodyHtml: string;
  version: number;
  editedAt: Date | null;
  createdAt: Date;
}

/** READ: the task's comments, oldest first, keyset paged. */
export async function listTaskComments(
  actor: ProjectActor,
  taskId: string,
  opts: PageOpts = {},
): Promise<
  ProjectResult<{ comments: TaskCommentView[]; hasMore: boolean; nextCursor: string | null }>
> {
  return runProjectRead(actor, "listTaskComments", async (db) => {
    const limit = pageLimit(opts.limit);
    const cursor = decodeCursor(opts.cursor);
    await requireTask(db, actor, taskId, { lock: "none", level: "READ" });
    const after = cursor ? cursorDate(cursor.sortValue) : null;
    const rows = await db.taskComment.findMany({
      where: {
        organizationId: actor.orgId,
        taskId,
        ...(after && cursor
          ? {
              OR: [{ createdAt: { gt: after } }, { createdAt: after, id: { gt: cursor.id } }],
            }
          : {}),
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit + 1,
      select: {
        id: true,
        taskId: true,
        authorUserId: true,
        bodyMarkdown: true,
        version: true,
        editedAt: true,
        createdAt: true,
      },
    });
    const page = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    const last = page[page.length - 1];
    return {
      comments: page.map((row) => ({ ...row, bodyHtml: renderTaskMarkdown(row.bodyMarkdown) })),
      hasMore,
      nextCursor: hasMore && last ? encodeCursor(last.createdAt.toISOString(), last.id) : null,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Writes

/** CONTENT under PROJECT_SHARE: adds a comment and writes COMMENT_ADDED with the id only. */
export async function addTaskComment(
  actor: ProjectActor,
  taskId: string,
  input: { body: unknown },
): Promise<ProjectResult<{ commentId: string; version: number }>> {
  return runProjectTransaction(actor, "addTaskComment", async (tx) => {
    const body = validBody(input?.body);
    const access = await requireTask(tx, actor, taskId, {
      lock: "share",
      level: "CONTENT",
      taskLock: "share",
    });
    await afterLock(tx, "addTaskComment");
    const comment = await tx.taskComment.create({
      data: {
        organizationId: actor.orgId,
        taskId: access.task.id,
        authorUserId: actor.userId,
        bodyMarkdown: body,
      },
      select: { id: true, version: true },
    });
    await recordProjectActivity(tx, {
      orgId: actor.orgId,
      projectId: access.task.projectId,
      taskId: access.task.id,
      actorUserId: actor.userId,
      verb: "COMMENT_ADDED",
      entityType: "COMMENT",
      entityId: comment.id,
      after: { commentId: comment.id },
      batchId: newBatchId(),
    });
    return { commentId: comment.id, version: comment.version };
  });
}
