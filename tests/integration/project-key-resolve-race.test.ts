// Phase 14 fix batch F4, Codex diff critique round 2 R2D-3 (run decision K73): resolveTaskKey
// decides the key's kind, the alias origin's access (K72) and the task's current project in one
// statement. The family race parks the read after its membership check and changes access; the
// alias race parks it where the old code had read the key's kind, turns the key into an alias of
// a project the reader can no longer read while the task moves into a readable one, and expects
// the missing-key answer. No timed waits.
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { resolveTaskKey } from "@/lib/projects/keys";
import { removeProjectMember } from "@/lib/projects/members";
import { moveTask } from "@/lib/projects/move";
import { actorOf, seedOrgWithMembers, seedProject, seedTask } from "../support/project-fixtures";
import { createServiceRace, type ServiceRace } from "../support/project-race";
import { describeReadRaces, gone, TASK_CHANGES } from "../support/project-read-race";

describeReadRaces({
  "key resolution": [
    {
      name: "resolveTaskKey",
      operation: "resolveTaskKey",
      changes: TASK_CHANGES,
      read: (w) => resolveTaskKey(w.reader, w.taskKey),
      before: (r, w) => expect(r).toMatchObject({ ok: true, taskId: w.taskId, isAlias: false }),
      after: gone,
    },
  ],
});

let race: ServiceRace | null = null;

afterEach(() => {
  race?.clear();
  race = null;
});

describe("K73 resolveTaskKey decides key kind, alias origin and current project in one query", () => {
  it("a key read as ACTIVE that becomes an alias of an unreadable origin while the read waits is NOT_FOUND", async () => {
    const org = await seedOrgWithMembers(prisma, ["owner", "member", "member"]);
    const readerId = org.users[1]?.id as string;
    const managerId = org.users[2]?.id as string;
    const reader = actorOf(readerId, org.orgId);
    const manager = actorOf(managerId, org.orgId);
    const origin = await seedProject(prisma, org.orgId, {
      createdByUserId: managerId,
      isPrivate: true,
      managerUserIds: [managerId],
      memberUserIds: [readerId],
    });
    const open = await seedProject(prisma, org.orgId, {
      createdByUserId: managerId,
      managerUserIds: [managerId],
    });
    const task = await seedTask(prisma, org.orgId, origin.id);
    expect(await resolveTaskKey(reader, task.key)).toMatchObject({ ok: true, isAlias: false });
    race = createServiceRace();
    const parked = race.holdAt("resolveTaskKey");
    const pending = resolveTaskKey(reader, task.key);
    expect(await parked).toBeGreaterThan(0);
    // The key becomes an alias of a project the reader can no longer read; the task itself now
    // sits in a project the reader can read.
    expect(await moveTask(manager, task.id, open.id, 0)).toMatchObject({ ok: true });
    expect(await removeProjectMember(manager, origin.id, readerId)).toMatchObject({
      ok: true,
      changed: true,
    });
    race.release();
    expect(await pending).toEqual({ ok: false, code: "NOT_FOUND" });
    // The world where the key never existed gives the same answer.
    expect(await resolveTaskKey(reader, `${origin.keyPrefix}-999`)).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
  });
});
