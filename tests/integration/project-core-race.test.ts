// Phase 14 core races (contract section 3, C17), on a real Postgres through Testcontainers. Every
// race records the holder's and the waiter's backend PIDs through the service observer and waits
// for exactly that waiter to be blocked by that holder (waitForBlockedBy on the one-connection
// observer client). No timed waits; every promise settles and none rejects with 40P01.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { moveProjectPosition, setProjectStatus, updateProject } from "@/lib/projects/projects";
import { waitForBlockedBy } from "../support/lock-wait";
import { actorOf, seedOrgWithMembers, seedProject } from "../support/project-fixtures";
import {
  assertNoDeadlock,
  createObserverClient,
  createServiceRace,
  type ServiceRace,
  settleAll,
} from "../support/project-race";

let observer: PrismaClient;
let closeObserver: () => Promise<void>;
let race: ServiceRace | null = null;
const racePids: { race: string; holder: number; waiter: number }[] = [];

beforeAll(() => {
  const created = createObserverClient();
  observer = created.client;
  closeObserver = created.close;
});

afterAll(async () => {
  console.info(`project-core-race PIDs: ${JSON.stringify(racePids)}`);
  await closeObserver();
});

afterEach(() => {
  race?.clear();
  race = null;
});

async function managedOrg() {
  const org = await seedOrgWithMembers(prisma, ["owner", "member"]);
  const manager = org.users[1]?.id as string;
  const first = await seedProject(prisma, org.orgId, {
    createdByUserId: manager,
    managerUserIds: [manager],
    position: 10,
  });
  const second = await seedProject(prisma, org.orgId, {
    createdByUserId: manager,
    managerUserIds: [manager],
    position: 11,
  });
  return { orgId: org.orgId, manager: actorOf(manager, org.orgId), first, second };
}

describe("project core races", () => {
  it("two updateProject calls with the same version serialize and the second gets CONFLICT", async () => {
    const w = await managedOrg();
    race = createServiceRace();
    const holderPid = race.holdAt("updateProject");
    const first = updateProject(w.manager, w.first.id, 0, { name: "First writer" });
    const holder = await holderPid;
    const waiterPid = race.nextStartPid("updateProject");
    const second = updateProject(w.manager, w.first.id, 0, { name: "Second writer" });
    const waiter = await waiterPid;
    await waitForBlockedBy(observer, holder, [waiter]);
    racePids.push({ race: "updateProject x2", holder, waiter });
    race.release();
    const results = await settleAll([first, second]);
    assertNoDeadlock(results);
    expect(results.map((r) => (r.status === "fulfilled" ? r.value : r.reason))).toEqual([
      { ok: true, changed: true, version: 1 },
      { ok: false, code: "CONFLICT" },
    ]);
    const stored = await prisma.project.findFirstOrThrow({
      where: { id: w.first.id, organizationId: w.orgId },
    });
    expect(stored).toMatchObject({ name: "First writer", version: 1 });
    expect(
      await prisma.projectActivity.count({
        where: { organizationId: w.orgId, verb: "PROJECT_UPDATED" },
      }),
    ).toBe(1);
  });

  it("setProjectStatus on another project waits for moveProjectPosition's organization lock", async () => {
    const w = await managedOrg();
    race = createServiceRace();
    const holderPid = race.holdAt("moveProjectPosition");
    const move = moveProjectPosition(w.manager, w.first.id, { placeAfterProjectId: w.second.id });
    const holder = await holderPid;
    const waiterPid = race.nextStartPid("setProjectStatus");
    const status = setProjectStatus(w.manager, w.second.id, 0, "ACTIVE");
    const waiter = await waiterPid;
    await waitForBlockedBy(observer, holder, [waiter]);
    racePids.push({ race: "moveProjectPosition vs setProjectStatus", holder, waiter });
    race.release();
    const results = await settleAll([move, status]);
    assertNoDeadlock(results);
    expect(results.map((r) => (r.status === "fulfilled" ? r.value : r.reason))).toEqual([
      { ok: true, changed: true },
      { ok: true, changed: true, version: 1 },
    ]);
  });
});
