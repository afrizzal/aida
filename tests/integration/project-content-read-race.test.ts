// Phase 14 fix batch F3, Codex diff critique D1: a content read returns comments and attachments
// only while the reader can read the task's current project. Each race parks the read after its
// access check: a holder transaction takes the content table ACCESS EXCLUSIVE before the read
// starts, the read's own backend PID (nextStartPid) is bound to that holder with waitForBlockedBy,
// then access changes and private content is added inside the holder, and only then does the read
// run its content query. No timed waits.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { listTaskAttachments } from "@/lib/projects/attachments";
import { listTaskComments } from "@/lib/projects/comments";
import { addProjectMember, removeProjectMember } from "@/lib/projects/members";
import { moveTask } from "@/lib/projects/move";
import { createProject } from "@/lib/projects/projects";
import { createTask } from "@/lib/projects/tasks";
import { backendPid, deferred, waitForBlockedBy } from "../support/lock-wait";
import {
  actorOf,
  seedAttachment,
  seedComment,
  seedOrgWithMembers,
} from "../support/project-fixtures";
import { createObserverClient, createServiceRace, type ServiceRace } from "../support/project-race";

let observer: PrismaClient;
let closeObserver: () => Promise<void>;
let race: ServiceRace | null = null;
const releases: (() => void)[] = [];

beforeAll(() => {
  const created = createObserverClient();
  observer = created.client;
  closeObserver = created.close;
});

afterAll(async () => {
  await closeObserver();
});

afterEach(() => {
  race?.clear();
  race = null;
  for (const release of releases.splice(0)) release();
});

async function world() {
  const org = await seedOrgWithMembers(prisma, ["owner", "member", "member"]);
  const reader = actorOf(org.users[1]?.id as string, org.orgId);
  const manager = actorOf(org.users[2]?.id as string, org.orgId);
  const project = async (name: string, isPrivate: boolean) => {
    const r = await createProject(manager, { name, keyPrefix: name, isPrivate });
    if (!r.ok) throw new Error(`createProject ${name}: ${r.code}`);
    return r.projectId;
  };
  const task = async (projectId: string) => {
    const r = await createTask(manager, projectId, { title: "Raced" });
    if (!r.ok) throw new Error(r.code);
    return r.taskId;
  };
  return { orgId: org.orgId, reader, manager, project, task };
}

/**
 * Parks `read` behind a holder that holds `table` ACCESS EXCLUSIVE, runs `change` while the read
 * waits, then `addPrivate` inside the holder, then releases the holder and returns the read.
 */
async function parkedRead<T>(
  table: "TaskComment" | "TaskAttachment",
  operation: string,
  read: () => Promise<T>,
  change: () => Promise<void>,
  addPrivate: (tx: PrismaClient) => Promise<void>,
): Promise<T> {
  race = createServiceRace();
  const holderPid = deferred<number>();
  const changed = deferred<void>();
  releases.push(() => changed.resolve());
  const holder = prisma.$transaction(
    async (raw) => {
      const tx = raw as unknown as PrismaClient;
      if (table === "TaskComment") {
        await tx.$executeRaw`LOCK TABLE "TaskComment" IN ACCESS EXCLUSIVE MODE`;
      } else {
        await tx.$executeRaw`LOCK TABLE "TaskAttachment" IN ACCESS EXCLUSIVE MODE`;
      }
      holderPid.resolve(await backendPid(tx));
      await changed.promise;
      await addPrivate(tx);
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
  const holder0 = await holderPid.promise;
  const readerPid = race.nextStartPid(operation);
  const pending = read();
  await waitForBlockedBy(observer, holder0, [await readerPid]);
  await change();
  changed.resolve();
  await holder;
  return pending;
}

describe("Codex diff D1: content reads return nothing the reader cannot read now", () => {
  it("comments: the task moves into a private project while the read waits; the private comment is not returned", async () => {
    const w = await world();
    const open = await w.project("CO", false);
    const hidden = await w.project("CP", true);
    const taskId = await w.task(open);
    await seedComment(prisma, w.orgId, taskId, { authorUserId: w.manager.userId, body: "open" });
    const result = await parkedRead(
      "TaskComment",
      "listTaskComments",
      () => listTaskComments(w.reader, taskId),
      async () => {
        expect(await moveTask(w.manager, taskId, hidden, 0)).toMatchObject({ ok: true });
      },
      async (tx) => {
        await seedComment(tx, w.orgId, taskId, { authorUserId: w.manager.userId, body: "secret" });
      },
    );
    expect(result).toEqual({ ok: true, comments: [], hasMore: false, nextCursor: null });
  });

  it("comments: the reader's project membership is removed while the read waits; nothing is returned", async () => {
    const w = await world();
    const hidden = await w.project("CM", true);
    expect(await addProjectMember(w.manager, hidden, { userId: w.reader.userId })).toMatchObject({
      ok: true,
    });
    const taskId = await w.task(hidden);
    await seedComment(prisma, w.orgId, taskId, { authorUserId: w.manager.userId, body: "before" });
    const result = await parkedRead(
      "TaskComment",
      "listTaskComments",
      () => listTaskComments(w.reader, taskId),
      async () => {
        expect(await removeProjectMember(w.manager, hidden, w.reader.userId)).toMatchObject({
          ok: true,
          changed: true,
        });
      },
      async (tx) => {
        await seedComment(tx, w.orgId, taskId, { authorUserId: w.manager.userId, body: "secret" });
      },
    );
    expect(result).toEqual({ ok: true, comments: [], hasMore: false, nextCursor: null });
  });

  it("attachments: the task moves into a private project while the read waits; the private file is not returned", async () => {
    const w = await world();
    const open = await w.project("AO", false);
    const hidden = await w.project("AP", true);
    const taskId = await w.task(open);
    await seedAttachment(prisma, w.orgId, taskId, { uploadedByUserId: w.manager.userId });
    const result = await parkedRead(
      "TaskAttachment",
      "listTaskAttachments",
      () => listTaskAttachments(w.reader, taskId),
      async () => {
        expect(await moveTask(w.manager, taskId, hidden, 0)).toMatchObject({ ok: true });
      },
      async (tx) => {
        await seedAttachment(tx, w.orgId, taskId, {
          uploadedByUserId: w.manager.userId,
          originalFilename: "secret.png",
        });
      },
    );
    expect(result).toEqual({ ok: true, attachments: [], hasMore: false, nextCursor: null });
  });
});
