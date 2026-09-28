// Populated pre-12.1 seed (Phase 12.1, D-10, review C8, review R2-3).
//
// Writes three organizations with raw SQL against the schema as of 20261109100000_ticket_lifecycle
// (the Ticket.status enum still exists): A with tickets in every enum value (two PENDING), past and
// future deadlines, both SLA flags, responses, resolutions, CSAT, a tag, a custom field, a merged
// pair, private and shared version 1 saved views and audit rows of several actions; B with two
// tickets and one shared view; C with nothing. Every pre-existing column of organization, Ticket and
// SavedView holds a non-null, non-default value on at least one row (review C8).
//
// Every INSERT writes every timestamp column of its table explicitly, either null or one of the
// FIXTURE_TIMESTAMPS constants: distinct millisecond values, past ones before 2005-01-01 and future
// deadlines after 2090-01-01, so no constant can equal a value produced at insertion or at check
// time by CURRENT_TIMESTAMP or now() (review R2-3).
//
// Used by tests/integration/ticket-states-migration.test.ts, ticket-states-deploy.test.ts and plan
// 12.1-06's migrated-resume case. Test-only module: relative imports only.
import type pg from "pg";

export const FIXTURE_TIMESTAMPS = Object.freeze({
  orgA: "2001-01-01T08:00:00.101Z",
  orgB: "2001-01-02T08:00:00.102Z",
  orgC: "2001-01-03T08:00:00.103Z",
  userCreated: "2001-01-04T09:00:00.104Z",
  userUpdated: "2001-01-05T09:00:00.105Z",
  banExpires: "2004-12-31T23:59:59.999Z",
  memberCreated: "2001-01-06T09:00:00.106Z",
  contactCreated: "2001-02-01T10:00:00.201Z",
  contactUpdated: "2001-02-02T10:00:00.202Z",
  tagCreated: "2001-02-03T10:00:00.203Z",
  fieldCreated: "2001-02-04T10:00:00.204Z",
  fieldUpdated: "2001-02-05T10:00:00.205Z",
  fieldValueDate: "2001-02-06T00:00:00.206Z",
  ticketCreated1: "2002-03-01T10:00:00.301Z",
  ticketCreated2: "2002-03-02T11:30:00.302Z",
  ticketUpdated: "2003-04-01T12:00:00.401Z",
  pastFirstDue: "2002-03-01T11:00:00.311Z",
  pastResolutionDue: "2002-03-03T18:00:00.312Z",
  firstResponded: "2002-03-01T10:45:00.321Z",
  firstResponded2: "2002-03-02T12:10:00.322Z",
  resolved: "2002-03-04T09:15:00.331Z",
  resolved2: "2002-03-05T16:40:00.332Z",
  mergedAt: "2003-01-15T14:00:00.341Z",
  csatCreated: "2003-02-01T09:00:00.351Z",
  csatUpdated: "2003-02-02T09:00:00.352Z",
  viewCreated: "2003-03-01T09:00:00.361Z",
  viewUpdated: "2003-03-02T09:00:00.362Z",
  auditCreated1: "2002-03-01T10:05:00.371Z",
  auditCreated2: "2002-03-01T10:06:00.372Z",
  auditCreated3: "2002-03-05T00:00:00.373Z",
  auditCreated4: "2002-03-06T07:30:00.374Z",
  futureFirstDue: "2091-05-01T12:00:00.501Z",
  futureResolutionDue: "2092-06-01T12:00:00.502Z",
  snoozedUntil: "2093-07-01T08:00:00.601Z",
});

export type FixtureTimestampKey = keyof typeof FIXTURE_TIMESTAMPS;

/** Every fixture constant, for assertFixtureCoverage. */
export const FIXTURE_TIMESTAMP_VALUES: readonly string[] = Object.values(FIXTURE_TIMESTAMPS);

const T = FIXTURE_TIMESTAMPS;

type LegacyStatus = "NEW" | "OPEN" | "PENDING" | "RESOLVED" | "CLOSED";

export interface SeededPre121 {
  orgs: { a: string; b: string; c: string };
  users: { a1: string; a2: string; b1: string };
  members: { a1: string; a2: string; b1: string };
  /** Ticket ids per organization and old status. */
  tickets: { a: Record<LegacyStatus, string[]>; b: Record<LegacyStatus, string[]> };
  /** Every ticket id with its old status. */
  statusById: Record<string, LegacyStatus>;
  savedViews: { aPrivate: string; aShared: string; aEmpty: string; bShared: string };
  /** The version 1 filters each saved view was written with. */
  viewFilters: Record<string, Record<string, unknown>>;
  tagId: string;
  fieldId: string;
}

interface TicketSeed {
  id: string;
  org: "a" | "b";
  number: number;
  status: LegacyStatus;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  assigneeId: string | null;
  createdAt: FixtureTimestampKey;
  firstDue: FixtureTimestampKey;
  resolutionDue: FixtureTimestampKey;
  firstRespondedAt: FixtureTimestampKey | null;
  resolvedAt: FixtureTimestampKey | null;
  isAtRisk: boolean;
  isBreached: boolean;
  triage: boolean;
  snoozed: boolean;
  mergedInto: string | null;
}

/**
 * Seeds the three organizations on a database migrated through 20261109100000_ticket_lifecycle.
 * Ids are fixed strings with a prefix, so several databases can hold the same seed.
 */
export async function seedPopulatedPre121(client: pg.Client, prefix = "m"): Promise<SeededPre121> {
  const id = (name: string) => `${prefix}-${name}`;
  const orgs = { a: id("org-a"), b: id("org-b"), c: id("org-c") };
  const users = { a1: id("user-a1"), a2: id("user-a2"), b1: id("user-b1") };
  const members = { a1: id("member-a1"), a2: id("member-a2"), b1: id("member-b1") };
  const contacts = { a: id("contact-a"), b: id("contact-b") };
  const tagId = id("tag-a");
  const fieldId = id("field-a");

  await client.query(
    `INSERT INTO "organization" ("id", "name", "slug", "logo", "createdAt", "metadata") VALUES
       ($1, 'Acme Support', $2, 'https://acme.example.test/logo.png', $3, '{"plan":"fixture"}'),
       ($4, 'Beta Desk', $5, NULL, $6, NULL),
       ($7, 'Calm Corp', $8, NULL, $9, NULL)`,
    [orgs.a, id("acme"), T.orgA, orgs.b, id("beta"), T.orgB, orgs.c, id("calm"), T.orgC],
  );
  await client.query(
    `INSERT INTO "user" ("id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt",
       "role", "banned", "banReason", "banExpires") VALUES
       ($1, 'Ana Agent', $2, true, 'https://acme.example.test/ana.png', $3, $4, 'admin', true,
        'fixture ban', $5),
       ($6, 'Ari Agent', $7, false, NULL, $3, $4, NULL, NULL, NULL, NULL),
       ($8, 'Bea Agent', $9, true, NULL, $3, $4, NULL, NULL, NULL, NULL)`,
    [
      users.a1,
      `${prefix}-ana@acme.test`,
      T.userCreated,
      T.userUpdated,
      T.banExpires,
      users.a2,
      `${prefix}-ari@acme.test`,
      users.b1,
      `${prefix}-bea@beta.test`,
    ],
  );
  await client.query(
    `INSERT INTO "member" ("id", "organizationId", "userId", "role", "createdAt") VALUES
       ($1, $2, $3, 'owner', $7), ($4, $2, $5, 'member', $7), ($6, $8, $9, 'owner', $7)`,
    [
      members.a1,
      orgs.a,
      users.a1,
      members.a2,
      users.a2,
      members.b1,
      T.memberCreated,
      orgs.b,
      users.b1,
    ],
  );
  await client.query(
    `INSERT INTO "Contact" ("id", "organizationId", "name", "email", "phone", "company", "notes",
       "createdAt", "updatedAt") VALUES
       ($1, $2, 'Carla Customer', 'carla@customer.test', '+620000', 'Customer Co', 'vip', $5, $6),
       ($3, $4, NULL, 'dan@customer.test', NULL, NULL, NULL, $5, $6)`,
    [contacts.a, orgs.a, contacts.b, orgs.b, T.contactCreated, T.contactUpdated],
  );
  await client.query(
    `INSERT INTO "Tag" ("id", "organizationId", "name", "createdAt") VALUES ($1, $2, 'billing', $3)`,
    [tagId, orgs.a, T.tagCreated],
  );
  await client.query(
    `INSERT INTO "CustomFieldDefinition" ("id", "organizationId", "label", "type", "options",
       "position", "createdAt", "updatedAt")
     VALUES ($1, $2, 'Tier', 'TEXT', NULL, 2, $3, $4)`,
    [fieldId, orgs.a, T.fieldCreated, T.fieldUpdated],
  );

  const ticketSeeds: TicketSeed[] = [
    // A: every enum value, two PENDING, one merged source (CLOSED).
    {
      id: id("a-new"),
      org: "a",
      number: 1,
      status: "NEW",
      priority: "HIGH",
      assigneeId: users.a1,
      createdAt: "ticketCreated1",
      firstDue: "futureFirstDue",
      resolutionDue: "futureResolutionDue",
      firstRespondedAt: null,
      resolvedAt: null,
      isAtRisk: false,
      isBreached: false,
      triage: true,
      snoozed: true,
      mergedInto: null,
    },
    {
      id: id("a-open"),
      org: "a",
      number: 2,
      status: "OPEN",
      priority: "URGENT",
      assigneeId: users.a2,
      createdAt: "ticketCreated1",
      firstDue: "pastFirstDue",
      resolutionDue: "pastResolutionDue",
      firstRespondedAt: "firstResponded",
      resolvedAt: null,
      isAtRisk: true,
      isBreached: false,
      triage: false,
      snoozed: false,
      mergedInto: null,
    },
    {
      id: id("a-pending-1"),
      org: "a",
      number: 3,
      status: "PENDING",
      priority: "NORMAL",
      assigneeId: null,
      createdAt: "ticketCreated1",
      firstDue: "pastFirstDue",
      resolutionDue: "pastResolutionDue",
      firstRespondedAt: null,
      resolvedAt: null,
      isAtRisk: true,
      isBreached: true,
      triage: false,
      snoozed: false,
      mergedInto: null,
    },
    {
      id: id("a-pending-2"),
      org: "a",
      number: 4,
      status: "PENDING",
      priority: "LOW",
      assigneeId: users.a1,
      createdAt: "ticketCreated2",
      firstDue: "futureFirstDue",
      resolutionDue: "futureResolutionDue",
      firstRespondedAt: "firstResponded2",
      resolvedAt: null,
      isAtRisk: false,
      isBreached: false,
      triage: false,
      snoozed: false,
      mergedInto: null,
    },
    {
      id: id("a-resolved"),
      org: "a",
      number: 5,
      status: "RESOLVED",
      priority: "NORMAL",
      assigneeId: users.a1,
      createdAt: "ticketCreated1",
      firstDue: "pastFirstDue",
      resolutionDue: "pastResolutionDue",
      firstRespondedAt: "firstResponded",
      resolvedAt: "resolved",
      isAtRisk: true,
      isBreached: true,
      triage: false,
      snoozed: false,
      mergedInto: null,
    },
    {
      id: id("a-closed"),
      org: "a",
      number: 6,
      status: "CLOSED",
      priority: "HIGH",
      assigneeId: null,
      createdAt: "ticketCreated2",
      firstDue: "pastFirstDue",
      resolutionDue: "pastResolutionDue",
      firstRespondedAt: "firstResponded2",
      resolvedAt: "resolved2",
      isAtRisk: false,
      isBreached: false,
      triage: false,
      snoozed: false,
      mergedInto: null,
    },
    {
      id: id("a-merged"),
      org: "a",
      number: 7,
      status: "CLOSED",
      priority: "NORMAL",
      assigneeId: null,
      createdAt: "ticketCreated2",
      firstDue: "pastFirstDue",
      resolutionDue: "pastResolutionDue",
      firstRespondedAt: null,
      resolvedAt: "resolved2",
      isAtRisk: false,
      isBreached: false,
      triage: false,
      snoozed: false,
      mergedInto: id("a-open"),
    },
    // B: two tickets.
    {
      id: id("b-open"),
      org: "b",
      number: 1,
      status: "OPEN",
      priority: "NORMAL",
      assigneeId: users.b1,
      createdAt: "ticketCreated1",
      firstDue: "futureFirstDue",
      resolutionDue: "futureResolutionDue",
      firstRespondedAt: null,
      resolvedAt: null,
      isAtRisk: false,
      isBreached: false,
      triage: false,
      snoozed: false,
      mergedInto: null,
    },
    {
      id: id("b-pending"),
      org: "b",
      number: 2,
      status: "PENDING",
      priority: "HIGH",
      assigneeId: null,
      createdAt: "ticketCreated2",
      firstDue: "pastFirstDue",
      resolutionDue: "futureResolutionDue",
      firstRespondedAt: "firstResponded2",
      resolvedAt: null,
      isAtRisk: true,
      isBreached: false,
      triage: false,
      snoozed: false,
      mergedInto: null,
    },
  ];

  const empty = (): Record<LegacyStatus, string[]> => ({
    NEW: [],
    OPEN: [],
    PENDING: [],
    RESOLVED: [],
    CLOSED: [],
  });
  const tickets = { a: empty(), b: empty() };
  const statusById: Record<string, LegacyStatus> = {};
  for (const t of ticketSeeds) {
    await client.query(
      `INSERT INTO "Ticket" ("id", "organizationId", "number", "statusToken", "subject", "status",
         "priority", "contactId", "assigneeId", "firstResponseTargetMinutes",
         "resolutionTargetMinutes", "firstResponseDueAt", "resolutionDueAt", "firstRespondedAt",
         "resolvedAt", "isAtRisk", "isBreached", "triageCategory", "triageSentiment",
         "triageLanguage", "triageStatus", "snoozedUntil", "mergedIntoTicketId", "mergedAt",
         "mergeMessageSeq", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6::"TicketStatus", $7::"TicketPriority", $8, $9, $10, $11, $12,
         $13, $14, $15, $16, $17, $18::"TriageCategory", $19::"TriageSentiment", $20,
         $21::"TriageStatus", $22, $23, $24, $25, $26, $27)`,
      [
        t.id,
        orgs[t.org],
        t.number,
        `${t.id}-token`,
        `Subject of ${t.id}`,
        t.status,
        t.priority,
        contacts[t.org],
        t.assigneeId,
        t.priority === "URGENT" ? 30 : 60,
        t.priority === "URGENT" ? 240 : 480,
        T[t.firstDue],
        T[t.resolutionDue],
        t.firstRespondedAt ? T[t.firstRespondedAt] : null,
        t.resolvedAt ? T[t.resolvedAt] : null,
        t.isAtRisk,
        t.isBreached,
        t.triage ? "TECHNICAL" : null,
        t.triage ? "NEGATIVE" : null,
        t.triage ? "en" : null,
        t.triage ? "COMPLETED" : null,
        t.snoozed ? T.snoozedUntil : null,
        t.mergedInto,
        t.mergedInto ? T.mergedAt : null,
        t.mergedInto ? "42" : null,
        T[t.createdAt],
        T.ticketUpdated,
      ],
    );
    tickets[t.org][t.status].push(t.id);
    statusById[t.id] = t.status;
  }
  await client.query(
    `INSERT INTO "TicketCounter" ("organizationId", "lastNumber") VALUES ($1, 7), ($2, 2)`,
    [orgs.a, orgs.b],
  );
  await client.query(`INSERT INTO "TicketTag" ("ticketId", "tagId") VALUES ($1, $2)`, [
    id("a-new"),
    tagId,
  ]);
  await client.query(
    `INSERT INTO "CustomFieldValue" ("id", "organizationId", "ticketId", "customFieldDefinitionId",
       "valueText", "valueNumber", "valueBoolean", "valueDate")
     VALUES ($1, $2, $3, $4, 'gold', NULL, NULL, $5)`,
    [id("cfv-a"), orgs.a, id("a-new"), fieldId, T.fieldValueDate],
  );
  await client.query(
    `INSERT INTO "CsatResponse" ("id", "organizationId", "ticketId", "score", "comment", "createdAt",
       "updatedAt") VALUES
       ($1, $2, $3, 5, NULL, $6, $7),
       ($4, $2, $5, 2, 'slow first answer', $6, $7)`,
    [
      id("csat-1"),
      orgs.a,
      id("a-resolved"),
      id("csat-2"),
      id("a-closed"),
      T.csatCreated,
      T.csatUpdated,
    ],
  );

  const fullFilters = {
    version: 1,
    view: "mine",
    statuses: ["PENDING", "OPEN"],
    tagId,
    cf: { definitionId: fieldId, value: "gold" },
    q: "refund",
    snoozed: true,
  };
  const savedViews = {
    aPrivate: id("view-a-private"),
    aShared: id("view-a-shared"),
    aEmpty: id("view-a-empty"),
    bShared: id("view-b-shared"),
  };
  const viewFilters: Record<string, Record<string, unknown>> = {
    [savedViews.aPrivate]: fullFilters,
    [savedViews.aShared]: { ...fullFilters, view: "unassigned" },
    [savedViews.aEmpty]: { version: 1, view: "all", statuses: [] },
    [savedViews.bShared]: { version: 1, view: "all", statuses: ["RESOLVED", "NEW", "CLOSED"] },
  };
  const viewRows: [string, string, string, string, "PRIVATE" | "SHARED", number][] = [
    [savedViews.aPrivate, orgs.a, users.a1, "My pending", "PRIVATE", 0],
    [savedViews.aShared, orgs.a, users.a2, "Team pending", "SHARED", 3],
    [savedViews.aEmpty, orgs.a, users.a1, "Everything", "PRIVATE", 1],
    [savedViews.bShared, orgs.b, users.b1, "Done and new", "SHARED", 0],
  ];
  for (const [viewId, orgId, owner, name, visibility, position] of viewRows) {
    await client.query(
      `INSERT INTO "SavedView" ("id", "organizationId", "ownerUserId", "name", "visibility",
         "filters", "position", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5::"SavedViewVisibility", $6::jsonb, $7, $8, $9)`,
      [
        viewId,
        orgId,
        owner,
        name,
        visibility,
        JSON.stringify(viewFilters[viewId]),
        position,
        T.viewCreated,
        T.viewUpdated,
      ],
    );
  }

  const audits: [
    string,
    string,
    "USER" | "SYSTEM",
    string | null,
    string,
    object,
    object,
    string | null,
    string,
  ][] = [
    [
      id("audit-1"),
      id("a-open"),
      "USER",
      users.a1,
      "STATUS_CHANGED",
      { status: "NEW" },
      { status: "OPEN" },
      null,
      T.auditCreated1,
    ],
    [
      id("audit-2"),
      id("a-new"),
      "USER",
      users.a2,
      "PRIORITY_CHANGED",
      { priority: "NORMAL" },
      { priority: "HIGH" },
      id("batch-1"),
      T.auditCreated2,
    ],
    [
      id("audit-3"),
      id("a-closed"),
      "SYSTEM",
      null,
      "AUTO_CLOSED",
      { status: "RESOLVED" },
      { status: "CLOSED" },
      null,
      T.auditCreated3,
    ],
    [
      id("audit-4"),
      id("a-new"),
      "USER",
      users.a1,
      "SNOOZED",
      { snoozedUntil: null },
      { snoozedUntil: T.snoozedUntil },
      id("batch-1"),
      T.auditCreated4,
    ],
  ];
  for (const [
    auditId,
    ticketId,
    actorType,
    actorUserId,
    action,
    before,
    after,
    batchId,
    createdAt,
  ] of audits) {
    await client.query(
      `INSERT INTO "TicketAuditEvent" ("id", "organizationId", "ticketId", "actorType", "actorUserId",
         "action", "before", "after", "batchId", "createdAt")
       VALUES ($1, $2, $3, $4::"TicketAuditActorType", $5, $6::"TicketAuditAction", $7::jsonb,
         $8::jsonb, $9, $10)`,
      [
        auditId,
        orgs.a,
        ticketId,
        actorType,
        actorUserId,
        action,
        JSON.stringify(before),
        JSON.stringify(after),
        batchId,
        createdAt,
      ],
    );
  }

  return { orgs, users, members, tickets, statusById, savedViews, viewFilters, tagId, fieldId };
}
