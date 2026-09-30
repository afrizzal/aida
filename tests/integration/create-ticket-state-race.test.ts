// Phase 12.1, plan 12.1-01 (review C7): the create path follows the role-writer lock order
// against deleting and changing the default state, in both orders, on a real Postgres through
// Testcontainers. Nothing is mocked.
//
// The admin side is a raw transaction on its own pg client that follows the frozen admin
// protocol of src/lib/tickets/ticket-states.ts step by step (the configuration row FOR UPDATE,
// then the state FOR UPDATE, then the ticket moves, the role re-point and the soft delete); the
// admin service itself is plan 12.1-08's. The create side is the real createTicket with its test
// seam. Every wait is bound to recorded backend PIDs (waitForBlockedBy), never to a timer.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  createTicket,
  DefaultStateUnavailableError,
  setCreateTicketObserverForTests,
} from "@/lib/tickets/create-ticket";
import { seedOrgWithMembers, stateIdFor } from "../support/inbox-fixtures";
import { backendPid, deferred, waitForBlockedBy } from "../support/lock-wait";

const openClients: pg.Client[] = [];

afterEach(async () => {
  setCreateTicketObserverForTests(null);
  for (const client of openClients.splice(0)) await client.end();
});

/** A separate connection for the admin side; ended (and so rolled back) after each case. */
async function adminClient(): Promise<{ client: pg.Client; pid: number }> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  openClients.push(client);
  const { rows } = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
  return { client, pid: Number(rows[0].pid) };
}

/** An organization with its five default states plus a second OPEN state "Triage". */
async function orgWithTriage(): Promise<{ orgId: string; newId: string; triageId: string }> {
  const { orgId } = await seedOrgWithMembers(prisma, ["owner"]);
  const triage = await prisma.ticketState.create({
    data: {
      organizationId: orgId,
      name: "Triage",
      colorToken: "teal",
      group: "OPEN",
      sortOrder: 5,
    },
  });
  return { orgId, newId: await stateIdFor(orgId, "NEW"), triageId: triage.id };
}

function create(orgId: string, email = `race-${randomUUID()}@example.test`) {
  return createTicket(orgId, {
    subject: "Race ticket",
    priority: "NORMAL",
    body: "Race body",
    contact: { email },
    direction: "INBOUND",
  });
}

/** Full error text including the cause chain (Prisma wraps driver errors). */
function errorText(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  for (let depth = 0; current && depth < 5; depth++) {
    const e = current as { code?: string; message?: string; cause?: unknown };
    parts.push(String(e.code ?? ""), String(e.message ?? current));
    current = e.cause;
  }
  return parts.join(" ");
}

/** Asserts that no settled side rejected with a deadlock (40P01). */
function expectNoDeadlock(results: PromiseSettledResult<unknown>[]): void {
  for (const r of results) {
    if (r.status === "rejected") expect(errorText(r.reason)).not.toContain("40P01");
  }
}

async function lockConfig(client: pg.Client, orgId: string): Promise<void> {
  await client.query(
    `SELECT "organizationId" FROM "TicketStateConfig" WHERE "organizationId" = $1 FOR UPDATE`,
    [orgId],
  );
}

async function lockState(client: pg.Client, orgId: string, stateId: string): Promise<void> {
  await client.query(
    `SELECT id FROM "TicketState" WHERE id = $1 AND "organizationId" = $2 FOR UPDATE`,
    [stateId, orgId],
  );
}

/** Deletion with a same-group replacement, after both locks are held (K41, K42). */
async function deleteWithReplacement(
  client: pg.Client,
  orgId: string,
  deletedId: string,
  replacementId: string,
): Promise<void> {
  await client.query(
    `UPDATE "Ticket" SET "stateId" = $3, "updatedAt" = CURRENT_TIMESTAMP
     WHERE "organizationId" = $1 AND "stateId" = $2`,
    [orgId, deletedId, replacementId],
  );
  await client.query(
    `UPDATE "TicketStateConfig" SET "newStateId" = $2, "updatedAt" = CURRENT_TIMESTAMP
     WHERE "organizationId" = $1`,
    [orgId, replacementId],
  );
  await client.query(
    `UPDATE "TicketState" SET "deletedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
     WHERE id = $1 AND "organizationId" = $2`,
    [deletedId, orgId],
  );
}

async function stateOf(ticketId: string): Promise<string> {
  const row = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    select: { stateId: true },
  });
  return row.stateId;
}

async function config(orgId: string) {
  return prisma.ticketStateConfig.findUniqueOrThrow({ where: { organizationId: orgId } });
}

describe("create against the default state (review C7)", () => {
  it("C7-1: deleting the default first; create waits, then starts in the replacement", async () => {
    const { orgId, newId, triageId } = await orgWithTriage();
    const admin = await adminClient();
    await admin.client.query("BEGIN");
    await lockConfig(admin.client, orgId);
    await lockState(admin.client, orgId, newId);

    const createPid = deferred<number>();
    setCreateTicketObserverForTests({
      onTransactionStart: async (tx) => createPid.resolve(await backendPid(tx)),
    });
    const created = create(orgId);
    await waitForBlockedBy(prisma, admin.pid, [await createPid.promise]);

    await deleteWithReplacement(admin.client, orgId, newId, triageId);
    await admin.client.query("COMMIT");

    const results = await Promise.allSettled([created]);
    expectNoDeadlock(results);
    const ticket = await created;
    expect(await stateOf(ticket.id)).toBe(triageId);
    expect((await config(orgId)).newStateId).toBe(triageId);
    const deleted = await prisma.ticketState.findUniqueOrThrow({ where: { id: newId } });
    expect(deleted.deletedAt).toBeInstanceOf(Date);
  });

  it("C7-2: create holds both share locks first; the deletion waits, then moves the new ticket", async () => {
    const { orgId, newId, triageId } = await orgWithTriage();
    const createPid = deferred<number>();
    const release = deferred<void>();
    setCreateTicketObserverForTests({
      afterStateLocks: async (tx) => {
        createPid.resolve(await backendPid(tx));
        await release.promise;
      },
    });
    const created = create(orgId);
    const holder = await createPid.promise;

    const admin = await adminClient();
    await admin.client.query("BEGIN");
    const configLock = lockConfig(admin.client, orgId);
    await waitForBlockedBy(prisma, holder, [admin.pid]);
    release.resolve();

    const [createResult, lockResult] = await Promise.allSettled([created, configLock]);
    expectNoDeadlock([createResult, lockResult]);
    const ticket = await created;
    await configLock;
    expect(await stateOf(ticket.id)).toBe(newId);

    await lockState(admin.client, orgId, newId);
    await deleteWithReplacement(admin.client, orgId, newId, triageId);
    await admin.client.query("COMMIT");

    expect(await stateOf(ticket.id)).toBe(triageId);
    expect(await prisma.ticket.count({ where: { organizationId: orgId, stateId: newId } })).toBe(0);
    expect((await config(orgId)).newStateId).toBe(triageId);
    const deleted = await prisma.ticketState.findUniqueOrThrow({ where: { id: newId } });
    expect(deleted.deletedAt).toBeInstanceOf(Date);
  });

  it("C7-3: changing the default first; create waits, then starts in the new default", async () => {
    const { orgId, newId, triageId } = await orgWithTriage();
    const admin = await adminClient();
    await admin.client.query("BEGIN");
    await lockConfig(admin.client, orgId);
    await admin.client.query(
      `UPDATE "TicketStateConfig" SET "newStateId" = $2, "updatedAt" = CURRENT_TIMESTAMP
       WHERE "organizationId" = $1`,
      [orgId, triageId],
    );

    const createPid = deferred<number>();
    setCreateTicketObserverForTests({
      onTransactionStart: async (tx) => createPid.resolve(await backendPid(tx)),
    });
    const created = create(orgId);
    await waitForBlockedBy(prisma, admin.pid, [await createPid.promise]);
    await admin.client.query("COMMIT");

    const results = await Promise.allSettled([created]);
    expectNoDeadlock(results);
    const ticket = await created;
    expect(await stateOf(ticket.id)).toBe(triageId);
    expect((await config(orgId)).newStateId).toBe(triageId);
    const old = await prisma.ticketState.findUniqueOrThrow({ where: { id: newId } });
    expect(old.deletedAt).toBeNull();
  });

  it("C7-4: create holds both share locks first; the default change waits and moves no ticket", async () => {
    const { orgId, newId, triageId } = await orgWithTriage();
    const createPid = deferred<number>();
    const release = deferred<void>();
    setCreateTicketObserverForTests({
      afterStateLocks: async (tx) => {
        createPid.resolve(await backendPid(tx));
        await release.promise;
      },
    });
    const created = create(orgId);
    const holder = await createPid.promise;

    const admin = await adminClient();
    await admin.client.query("BEGIN");
    const configLock = lockConfig(admin.client, orgId);
    await waitForBlockedBy(prisma, holder, [admin.pid]);
    release.resolve();

    const results = await Promise.allSettled([created, configLock]);
    expectNoDeadlock(results);
    const ticket = await created;
    await configLock;
    await admin.client.query(
      `UPDATE "TicketStateConfig" SET "newStateId" = $2, "updatedAt" = CURRENT_TIMESTAMP
       WHERE "organizationId" = $1`,
      [orgId, triageId],
    );
    await admin.client.query("COMMIT");

    expect(await stateOf(ticket.id)).toBe(newId);
    expect((await config(orgId)).newStateId).toBe(triageId);
  });

  it("C7-5: a holder of only the default state FOR UPDATE soft-deletes it; create refuses and leaves nothing", async () => {
    const { orgId, newId } = await orgWithTriage();
    const email = `race-${randomUUID()}@example.test`;
    const holder = await adminClient();
    await holder.client.query("BEGIN");
    await lockState(holder.client, orgId, newId);

    const createPid = deferred<number>();
    setCreateTicketObserverForTests({
      onTransactionStart: async (tx) => createPid.resolve(await backendPid(tx)),
    });
    const created = create(orgId, email);
    const settled = created.then(
      () => null,
      (err: unknown) => err,
    );
    await waitForBlockedBy(prisma, holder.pid, [await createPid.promise]);
    await holder.client.query(
      `UPDATE "TicketState" SET "deletedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
       WHERE id = $1 AND "organizationId" = $2`,
      [newId, orgId],
    );
    await holder.client.query("COMMIT");

    const err = await settled;
    expect(err).toBeInstanceOf(DefaultStateUnavailableError);
    expect(errorText(err)).not.toContain("40P01");
    expect(await prisma.ticket.count({ where: { organizationId: orgId } })).toBe(0);
    expect(await prisma.contact.count({ where: { organizationId: orgId } })).toBe(0);
    expect(await prisma.ticketCounter.findUnique({ where: { organizationId: orgId } })).toBeNull();
  });
});
