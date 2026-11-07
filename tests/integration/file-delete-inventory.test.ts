// Phase 9 plan 09-04, U-13: every caller of FileStorage.delete, on a real Postgres through
// Testcontainers. Only the fenced queue sweep may delete a file that a committed row once
// referenced (tests/integration/file-fence.test.ts); every other caller deletes only keys that no
// committed row references. Each non-sweep caller is shown both ways: a failure before its
// referencing commit removes its files, and a failure injected after the referencing commit
// leaves every referenced file in place. The static list of callers is
// tests/unit/file-delete-callers.test.ts.
//
// Failure injection: a test-only table "aida_test_inject_failure" and BEFORE INSERT triggers on
// "Attachment", "TaskAttachment" (by originalFilename) and "ProjectActivity" (by entityId) raise
// inside the caller's own statement for a marker a case registers; all are created in beforeAll
// and dropped in afterAll. A failure after commit (K148, Codex diff critique round 1, findings 1
// and 7) is a COMMIT whose reply is lost: the app's pg pool connects through a TCP proxy
// (tests/support/lost-commit-proxy.ts) that, once armed, lets the server commit the connection's
// INSERT into "Attachment" or "TaskAttachment" and then drops the reply and the connection. The
// caller sees an error with an unknown outcome while the rows are committed; the case checks that
// every referenced file stays and that the keys are queued, delayed, for the reference-checked
// sweep. The session and the queue are test doubles (as tests/integration/ticket-merge.test.ts);
// everything else is real.
import { randomUUID } from "node:crypto";
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const env = await vi.hoisted(async () => {
  const { mkdtemp } = await import("node:fs/promises");
  const os = await import("node:os");
  const nodePath = await import("node:path");
  const dir = await mkdtemp(nodePath.join(os.tmpdir(), "aida-delete-inventory-"));
  const previousUploadsDir = process.env.UPLOADS_DIR;
  process.env.UPLOADS_DIR = dir;
  if (!process.env.RATE_LIMIT_PEPPER) process.env.RATE_LIMIT_PEPPER = "delete-inventory-test";
  // The pool of src/lib/db.ts is built from DATABASE_URL at import, so the proxy starts first.
  const { startLostCommitProxy } = await import("../support/lost-commit-proxy");
  const previousDatabaseUrl = process.env.DATABASE_URL;
  if (!previousDatabaseUrl) throw new Error("DATABASE_URL is not set by the global setup");
  const proxy = await startLostCommitProxy(previousDatabaseUrl);
  process.env.DATABASE_URL = proxy.url;
  return { dir, previousUploadsDir, proxy, previousDatabaseUrl };
});

const routeEnv = vi.hoisted(() => ({
  actor: null as null | { orgId: string; userId: string },
}));

vi.mock("@/lib/session", async () => {
  const { scopedDb } = await import("@/lib/scoped-db");
  return {
    getScopedDb: async () => {
      if (!routeEnv.actor) throw new Error("no session");
      return {
        db: scopedDb(routeEnv.actor.orgId),
        orgId: routeEnv.actor.orgId,
        session: { user: { id: routeEnv.actor.userId } },
      };
    },
  };
});

vi.mock("@/lib/queue/boss-client", () => ({
  getBoss: async () => ({ send: async () => "job" }),
}));

import { POST as intakePost } from "@/app/api/public/intake/route";
import { POST as followUpPost } from "@/app/api/public/status/[token]/follow-up/route";
import { POST as messagesPost } from "@/app/api/tickets/[id]/messages/route";
import type { FileStorage } from "@/lib/attachments/file-storage";
import { localFileStorage } from "@/lib/attachments/local-file-storage";
import { saveStagedFiles } from "@/lib/attachments/staged-files";
import { prisma } from "@/lib/db";
import { deleteTaskAttachment, uploadTaskAttachments } from "@/lib/projects/attachments";
import { deleteTask } from "@/lib/projects/delete";
import { setProjectServiceObserverForTests } from "@/lib/projects/service";
import { setAgentMessageObserverForTests } from "@/lib/tickets/merge";
import { uniqueClientIp } from "../support/client-ip";
import { seedContactTicket } from "../support/lifecycle-fixtures";
import {
  actorOf,
  seedAttachment,
  seedOrgWithMembers,
  seedProject,
  seedTask,
} from "../support/project-fixtures";

const INJECT_TABLE = "aida_test_inject_failure";

beforeAll(async () => {
  await prisma.$executeRawUnsafe(`CREATE TABLE "${INJECT_TABLE}" (marker text PRIMARY KEY)`);
  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION aida_test_inject_failure_fn() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM "${INJECT_TABLE}" f WHERE f.marker = (to_jsonb(NEW) ->> TG_ARGV[0])
      ) THEN
        RAISE EXCEPTION 'aida test: injected failure';
      END IF;
      RETURN NEW;
    END
    $fn$`);
  for (const [name, table, column] of [
    ["aida_test_inject_attachment", "Attachment", "originalFilename"],
    ["aida_test_inject_task_attachment", "TaskAttachment", "originalFilename"],
    ["aida_test_inject_activity", "ProjectActivity", "entityId"],
  ] as const) {
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER ${name} BEFORE INSERT ON "${table}" FOR EACH ROW EXECUTE FUNCTION aida_test_inject_failure_fn('${column}')`,
    );
  }
});

afterAll(async () => {
  await prisma.$executeRawUnsafe(
    `DROP TRIGGER IF EXISTS aida_test_inject_attachment ON "Attachment"`,
  );
  await prisma.$executeRawUnsafe(
    `DROP TRIGGER IF EXISTS aida_test_inject_task_attachment ON "TaskAttachment"`,
  );
  await prisma.$executeRawUnsafe(
    `DROP TRIGGER IF EXISTS aida_test_inject_activity ON "ProjectActivity"`,
  );
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS aida_test_inject_failure_fn()`);
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${INJECT_TABLE}"`);
  if (env.previousUploadsDir === undefined) delete process.env.UPLOADS_DIR;
  else process.env.UPLOADS_DIR = env.previousUploadsDir;
  await rm(env.dir, { recursive: true, force: true });
  process.env.DATABASE_URL = env.previousDatabaseUrl;
  await env.proxy.close();
});

afterEach(() => {
  setProjectServiceObserverForTests(null);
  setAgentMessageObserverForTests(null);
  routeEnv.actor = null;
  vi.restoreAllMocks();
});

async function injectFailureFor(marker: string): Promise<void> {
  await prisma.$executeRawUnsafe(`INSERT INTO "${INJECT_TABLE}" (marker) VALUES ($1)`, marker);
}

/**
 * Runs `work` with the proxy armed for `table`: the server commits the INSERT's work and the
 * reply to that commit is lost. Returns the error the caller saw.
 */
async function withLostCommit(table: string, work: () => Promise<unknown>): Promise<unknown> {
  const lostBefore = env.proxy.lost;
  env.proxy.arm(table);
  let caught: unknown = null;
  try {
    await work();
  } catch (err) {
    caught = err;
  }
  expect(env.proxy.lost).toBe(lostBefore + 1);
  expect(caught).not.toBeNull();
  return caught;
}

/** The queue rows of the keys: present, and not due before the K148 delay (at least 10 min). */
async function expectQueuedDelayed(orgId: string, keys: readonly string[]): Promise<void> {
  const rows = await prisma.$queryRaw<{ storageKey: string; delayed: boolean }[]>`
    SELECT "storageKey", "nextAttemptAt" > now() + interval '10 minutes' AS delayed
    FROM "ProjectFileCleanup"
    WHERE "organizationId" = ${orgId} AND "storageKey" = ANY(${[...keys]}::text[])
  `;
  expect(rows.map((r) => r.storageKey).sort()).toEqual([...keys].sort());
  for (const row of rows) expect(row.delayed).toBe(true);
}

/** The stored file names of one organization (empty when its directory does not exist). */
async function filesOf(orgId: string): Promise<string[]> {
  try {
    const entries = await readdir(path.join(env.dir, orgId), { withFileTypes: true });
    return entries
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .sort();
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return [];
    throw err;
  }
}

const newKey = (ext = "txt") => `${randomUUID().replace(/-/g, "")}.${ext}`;
const marker = (ext = "png") => `inject-${randomUUID().replace(/-/g, "")}.${ext}`;

let png: Buffer;
beforeAll(async () => {
  png = await readFile(path.resolve(__dirname, "../e2e/fixtures/sample.png"));
});

const pngFile = (name: string) => new File([new Uint8Array(png)], name, { type: "image/png" });

/** A project task with a manager, for the project attachment and task delete callers. */
async function projectWorld() {
  const org = await seedOrgWithMembers(prisma, ["owner", "member"]);
  const [, manager] = org.users.map((u) => u.id) as [string, string];
  const project = await seedProject(prisma, org.orgId, {
    createdByUserId: manager,
    managerUserIds: [manager],
  });
  const task = await seedTask(prisma, org.orgId, project.id, { createdByUserId: manager });
  return { orgId: org.orgId, manager, actor: actorOf(manager, org.orgId), task };
}

/** A stored file referenced by a committed TaskAttachment row. */
async function committedTaskFile(w: Awaited<ReturnType<typeof projectWorld>>, bytes = "kept") {
  const key = newKey("png");
  await localFileStorage.save({ orgId: w.orgId, key, data: Buffer.from(bytes) });
  const row = await seedAttachment(prisma, w.orgId, w.task.id, {
    uploadedByUserId: w.manager,
    storageKey: key,
  });
  return row;
}

// ---------------------------------------------------------------------------------------------

describe("staged rollback (saveStagedFiles: save failure and discard)", () => {
  it("a save that fails part-way deletes every attempted key and rethrows the save error", async () => {
    const orgId = randomUUID();
    const keys = [newKey(), newKey(), newKey()];
    let saves = 0;
    const failing: FileStorage = {
      ...localFileStorage,
      async save(params) {
        saves += 1;
        if (saves === 2) {
          // Writes part of the file, then fails.
          await localFileStorage.save({ ...params, data: params.data.subarray(0, 3) });
          throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
        }
        return localFileStorage.save(params);
      },
    };
    await expect(
      saveStagedFiles(
        failing,
        orgId,
        keys.map((key) => ({ key, data: Buffer.from(`data ${key}`) })),
      ),
    ).rejects.toMatchObject({ code: "ENOSPC" });
    expect(saves).toBe(2);
    expect(await filesOf(orgId)).toEqual([]);
  });

  it("discard() deletes the saved keys once", async () => {
    const orgId = randomUUID();
    const keys = [newKey(), newKey()];
    const deletes = vi.spyOn(localFileStorage, "delete");
    const staged = await saveStagedFiles(
      localFileStorage,
      orgId,
      keys.map((key) => ({ key, data: Buffer.from("staged") })),
    );
    expect(await filesOf(orgId)).toEqual([...keys].sort());
    await staged.discard();
    await staged.discard();
    expect(await filesOf(orgId)).toEqual([]);
    expect(deletes).toHaveBeenCalledTimes(2);
  });

  it("after commit: a save that collides (EEXIST) with a key a committed row references leaves that file in place and removes only the request's own files", async () => {
    const w = await projectWorld();
    const committed = await committedTaskFile(w, "committed bytes");
    const own = newKey();
    await expect(
      saveStagedFiles(localFileStorage, w.orgId, [
        { key: own, data: Buffer.from("own") },
        { key: committed.storageKey, data: Buffer.from("colliding bytes") },
      ]),
    ).rejects.toMatchObject({ code: "EEXIST" });
    expect(await filesOf(w.orgId)).toEqual([committed.storageKey]);
    expect(
      (await localFileStorage.read({ orgId: w.orgId, key: committed.storageKey })).toString(),
    ).toBe("committed bytes");
    expect(await prisma.taskAttachment.count({ where: { id: committed.id } })).toBe(1);
  });
});

describe("public intake (removeStoredUploads)", () => {
  let org: Awaited<ReturnType<typeof prisma.organization.findUniqueOrThrow>>;

  beforeAll(async () => {
    const { orgId } = await seedOrgWithMembers(prisma, ["owner"]);
    org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
  });

  function intakeRequest(files: File[]): Request {
    const form = new FormData();
    form.set("name", "Inventory Tester");
    form.set("email", "inventory@example.test");
    form.set("subject", "Delete inventory");
    form.set("message", "Files attached");
    for (const f of files) form.append("file", f);
    return new Request("http://localhost/api/public/intake", {
      method: "POST",
      headers: { "x-forwarded-for": uniqueClientIp() },
      body: form,
    });
  }

  it("a failure before the attachment insert commits removes the stored files", async () => {
    vi.spyOn(prisma.organization, "findFirstOrThrow").mockResolvedValue(org as never);
    const name = marker();
    await injectFailureFor(name);
    const before = await filesOf(org.id);
    await expect(intakePost(intakeRequest([pngFile(name), pngFile("second.png")]))).rejects.toThrow(
      /injected failure/,
    );
    expect(await filesOf(org.id)).toEqual(before);
    expect(await prisma.attachment.count({ where: { originalFilename: name } })).toBe(0);
  });

  it("after commit: the attachment insert committed and its reply was lost; every referenced file stays and is queued, not unlinked (K148)", async () => {
    vi.spyOn(prisma.organization, "findFirstOrThrow").mockResolvedValue(org as never);
    const names = [marker(), marker()];
    await withLostCommit("Attachment", () => intakePost(intakeRequest(names.map(pngFile))));
    const rows = await prisma.attachment.findMany({
      where: { organizationId: org.id, originalFilename: { in: names } },
      select: { storageKey: true },
    });
    expect(rows).toHaveLength(2);
    const files = await filesOf(org.id);
    for (const row of rows) expect(files).toContain(row.storageKey);
    await expectQueuedDelayed(
      org.id,
      rows.map((r) => r.storageKey),
    );
  });
});

describe("status follow-up (removeStoredUploads through discard)", () => {
  let orgId = "";
  let token = "";

  beforeAll(async () => {
    ({ orgId } = await seedOrgWithMembers(prisma, ["owner"]));
    const seeded = await seedContactTicket(orgId, { contactEmail: "inventory-fu@example.test" });
    const row = await prisma.ticket.findUniqueOrThrow({
      where: { id: seeded.id },
      select: { statusToken: true },
    });
    token = row.statusToken;
  });

  function followUp(files: File[]) {
    const form = new FormData();
    form.set("message", "Follow-up with files");
    for (const f of files) form.append("file", f);
    const request = new Request(`http://localhost/api/public/status/${token}/follow-up`, {
      method: "POST",
      headers: { "x-forwarded-for": uniqueClientIp() },
      body: form,
    });
    return followUpPost(request, { params: Promise.resolve({ token }) });
  }

  it("a failure inside the transaction, before the message commits, removes the stored files", async () => {
    const name = marker();
    await injectFailureFor(name);
    const before = await filesOf(orgId);
    await expect(followUp([pngFile("first.png"), pngFile(name)])).rejects.toThrow(
      /injected failure/,
    );
    expect(await filesOf(orgId)).toEqual(before);
    expect(await prisma.attachment.count({ where: { originalFilename: name } })).toBe(0);
  });

  it("after commit: the message and its attachments committed and the COMMIT reply was lost; every referenced file stays and is queued, not unlinked (K148)", async () => {
    const names = [marker(), marker()];
    await withLostCommit("Attachment", () => followUp(names.map(pngFile)));
    const rows = await prisma.attachment.findMany({
      where: { organizationId: orgId, originalFilename: { in: names } },
      select: { storageKey: true },
    });
    expect(rows).toHaveLength(2);
    const files = await filesOf(orgId);
    for (const row of rows) expect(files).toContain(row.storageKey);
    await expectQueuedDelayed(
      orgId,
      rows.map((r) => r.storageKey),
    );
  });
});

describe("ticket messages route (staged discard)", () => {
  async function agentTicket() {
    const { orgId, users } = await seedOrgWithMembers(prisma, ["admin"]);
    const user = users[0] as { id: string };
    const seeded = await seedContactTicket(orgId, {
      contactEmail: `inventory-msg-${randomUUID()}@example.test`,
    });
    routeEnv.actor = { orgId, userId: user.id };
    return { orgId, userId: user.id, ticketId: seeded.id };
  }

  function post(ticketId: string, files: File[]) {
    const form = new FormData();
    form.set("mode", "internal");
    form.set("body", "Internal note with files");
    for (const f of files) form.append("file", f);
    const request = new Request(`http://localhost/api/tickets/${ticketId}/messages`, {
      method: "POST",
      body: form,
    });
    return messagesPost(request, { params: Promise.resolve({ id: ticketId }) });
  }

  it("a refusal inside the transaction (membership ended) discards the staged files", async () => {
    const t = await agentTicket();
    setAgentMessageObserverForTests({
      async onTransactionStart() {
        await prisma.member.deleteMany({ where: { organizationId: t.orgId, userId: t.userId } });
      },
    });
    const res = await post(t.ticketId, [pngFile("a.png"), pngFile("b.png")]);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "MEMBERSHIP_ENDED" });
    expect(await filesOf(t.orgId)).toEqual([]);
  });

  it("a thrown error inside the transaction discards the staged files", async () => {
    const t = await agentTicket();
    setAgentMessageObserverForTests({
      afterLock() {
        throw new Error("injected failure inside the transaction");
      },
    });
    await expect(post(t.ticketId, [pngFile("a.png"), pngFile("b.png")])).rejects.toThrow(
      "injected failure inside the transaction",
    );
    expect(await filesOf(t.orgId)).toEqual([]);
  });

  it("after commit: the message and its attachments committed and the COMMIT reply was lost; every referenced file stays and is queued, not unlinked (K148)", async () => {
    const t = await agentTicket();
    const names = [marker(), marker()];
    await withLostCommit("Attachment", () => post(t.ticketId, names.map(pngFile)));
    const rows = await prisma.attachment.findMany({
      where: { organizationId: t.orgId, originalFilename: { in: names } },
      select: { storageKey: true },
    });
    expect(rows).toHaveLength(2);
    expect(await filesOf(t.orgId)).toEqual(rows.map((r) => r.storageKey).sort());
    await expectQueuedDelayed(
      t.orgId,
      rows.map((r) => r.storageKey),
    );
  });
});

describe("project attachments (uploadTaskAttachments discard)", () => {
  const candidate = (name: string) => ({
    name,
    size: png.length,
    arrayBuffer: async () => Uint8Array.from(png).buffer,
  });

  it("a refusal (task archived between the pre-check and the lock) discards the staged files", async () => {
    const w = await projectWorld();
    setProjectServiceObserverForTests({
      async onTransactionStart(_tx, operation) {
        if (operation !== "uploadTaskAttachments") return;
        await prisma.task.update({ where: { id: w.task.id }, data: { archivedAt: new Date() } });
      },
    });
    expect(
      await uploadTaskAttachments(w.actor, w.task.id, [candidate("a.png"), candidate("b.png")]),
    ).toEqual({ ok: false, code: "ARCHIVED" });
    expect(await filesOf(w.orgId)).toEqual([]);
  });

  it("a thrown error inside the transaction discards the staged files", async () => {
    const w = await projectWorld();
    setProjectServiceObserverForTests({
      afterLock(_tx, operation) {
        if (operation === "uploadTaskAttachments") throw new Error("injected failure in upload");
      },
    });
    await expect(
      uploadTaskAttachments(w.actor, w.task.id, [candidate("a.png"), candidate("b.png")]),
    ).rejects.toThrow("injected failure in upload");
    expect(await filesOf(w.orgId)).toEqual([]);
  });

  it("after commit: a committed attachment's file survives a later failed upload to the same task", async () => {
    const w = await projectWorld();
    const first = await uploadTaskAttachments(w.actor, w.task.id, [candidate("kept.png")]);
    if (!first.ok) throw new Error("first upload refused");
    const kept = await prisma.taskAttachment.findMany({
      where: { organizationId: w.orgId, taskId: w.task.id },
      select: { storageKey: true },
    });
    expect(kept).toHaveLength(1);
    setProjectServiceObserverForTests({
      afterLock(_tx, operation) {
        if (operation === "uploadTaskAttachments") throw new Error("injected failure in upload");
      },
    });
    await expect(
      uploadTaskAttachments(w.actor, w.task.id, [candidate("c.png"), candidate("d.png")]),
    ).rejects.toThrow("injected failure in upload");
    expect(await filesOf(w.orgId)).toEqual([kept[0]?.storageKey]);
  });

  it("after commit: the attachment rows committed and the COMMIT reply was lost; every referenced file stays and is queued, not unlinked (K148)", async () => {
    const w = await projectWorld();
    await withLostCommit("TaskAttachment", () =>
      uploadTaskAttachments(w.actor, w.task.id, [candidate("e.png"), candidate("f.png")]),
    );
    const rows = await prisma.taskAttachment.findMany({
      where: { organizationId: w.orgId, taskId: w.task.id },
      select: { storageKey: true },
    });
    expect(rows).toHaveLength(2);
    expect(await filesOf(w.orgId)).toEqual(rows.map((r) => r.storageKey).sort());
    await expectQueuedDelayed(
      w.orgId,
      rows.map((r) => r.storageKey),
    );
  });
});

/** Settles a service call that may refuse or throw; true only for an ok result. */
async function succeeded(work: Promise<{ ok: boolean }>): Promise<boolean> {
  try {
    return (await work).ok;
  } catch {
    return false;
  }
}

async function queuedKeys(orgId: string): Promise<string[]> {
  const rows = await prisma.projectFileCleanup.findMany({
    where: { organizationId: orgId },
    select: { storageKey: true },
  });
  return rows.map((r) => r.storageKey).sort();
}

describe("task hard delete and attachment delete (enqueue in the dereferencing transaction)", () => {
  it("a rolled-back attachment delete leaves the row, no queue row and the file", async () => {
    const w = await projectWorld();
    const row = await committedTaskFile(w);
    await injectFailureFor(row.id);
    expect(await succeeded(deleteTaskAttachment(w.actor, row.id))).toBe(false);
    expect(await prisma.taskAttachment.count({ where: { id: row.id } })).toBe(1);
    expect(await queuedKeys(w.orgId)).toEqual([]);
    expect(await filesOf(w.orgId)).toEqual([row.storageKey]);
  });

  it("a rolled-back task hard delete leaves the rows, no queue row and the files", async () => {
    const w = await projectWorld();
    const rows = [await committedTaskFile(w), await committedTaskFile(w)];
    await injectFailureFor(w.task.id);
    expect(
      await succeeded(deleteTask(w.actor, w.task.id, { confirm: true, expectedVersion: 0 })),
    ).toBe(false);
    expect(await prisma.taskAttachment.count({ where: { taskId: w.task.id } })).toBe(2);
    expect(await queuedKeys(w.orgId)).toEqual([]);
    expect(await filesOf(w.orgId)).toEqual(rows.map((r) => r.storageKey).sort());
  });

  it("after commit: the attachment delete and the task hard delete leave one queue row per key and every file in place for the fenced sweep", async () => {
    const w = await projectWorld();
    const single = await committedTaskFile(w);
    expect(await deleteTaskAttachment(w.actor, single.id)).toEqual({ ok: true, cleanupQueued: 1 });
    const rows = [await committedTaskFile(w), await committedTaskFile(w)];
    expect(await deleteTask(w.actor, w.task.id, { confirm: true, expectedVersion: 0 })).toEqual({
      ok: true,
      removedTaskCount: 1,
      cleanupQueued: 2,
    });
    const keys = [single, ...rows].map((r) => r.storageKey).sort();
    expect(await queuedKeys(w.orgId)).toEqual(keys);
    expect(await prisma.taskAttachment.count({ where: { organizationId: w.orgId } })).toBe(0);
    // Nothing but the fenced sweep deletes these files.
    expect(await filesOf(w.orgId)).toEqual(keys);
  });
});

describe("queue sweep (the fenced path)", () => {
  it("is covered by tests/integration/file-fence.test.ts, cases G1 to G6", async () => {
    const source = await readFile(path.resolve(__dirname, "file-fence.test.ts"), "utf8");
    for (const name of ["G1", "G2", "G3", "G4", "G5", "G6"]) {
      expect(source).toMatch(new RegExp(`it\\(\\s*"${name}[: ]`));
    }
  });
});
