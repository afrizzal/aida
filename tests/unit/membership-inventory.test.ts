// Phase 10, plan 10-02 Task 3 (AIDA-43, D-08, C5, R2-3, V-05, K141): the per-function inventory of
// the one membership gate. tests/support/source-inventory.ts parses src with the TypeScript parser
// (no type checker, no new package) and this file holds the rules, their allowlists and fail-first
// fixtures. Every allowlist entry is a file plus a function plus a non-empty reason, and an entry
// that names a missing function or suppresses no finding fails the suite.
//
// Rule A: every tenant-reaching entry function under src/app (exported server action, route
//   handler, page or layout default export, default-exported async server component of
//   src/app/(app) imported by a page) calls a gate: getScopedDb, requirePageAccess,
//   getActiveOrgAccess, requireOrgAdminScope or requireOrgAdmin; or getSessionActor together with
//   a src/lib function that reads membership (findActiveMembership, findConservativeMembership,
//   shareLockActiveMembership or readMemberRights, directly or through the functions it calls).
//   getOrgRole is display-only and is not a gate. Tenant reach: the entry (with the same-module
//   and src/app helpers and server components it runs) references a binding of a src/lib module
//   that, transitively, references the shared prisma client, calls scopedDb( or uses raw SQL.
// Rule C: session readers. auth.api.getSession only in readFreshSession (src/lib/fresh-session.ts);
//   every other auth.api. call only in an allowlisted function; getCurrentSession, requireSession
//   and readFreshSession called from an entry under src/app only through an allowlist entry.
// Rule C2 (K141): at most one session-reading call per exported server action or route handler.
// Rule D: the worker (src/lib/worker) imports no next/*, no src/app and no session.ts and calls no
//   auth.api; a write to a DOMAIN_MODELS model through a client not bound from scopedDb(...) has
//   organizationId in its where (update, delete) or data (create) literal; every raw INSERT,
//   UPDATE or DELETE has an allowlist entry.
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  type AllowEntry,
  findViolations,
  type InventoryRules,
  type NamedFn,
  readSourceTree,
  type Violation,
} from "../support/source-inventory";

const ROOT = path.resolve(__dirname, "../..");
const REAL = readSourceTree(ROOT);

const SESSION = "src/lib/session.ts";
const FRESH = "src/lib/fresh-session.ts";
const AUTHZ = "src/lib/authz.ts";
const PAGE_ACCESS = "src/lib/page-access.ts";
const MEMBERSHIP = "src/lib/membership.ts";
const MEMBER_RIGHTS = "src/lib/workspace-members/member-rights.ts";

/** DOMAIN_MODELS, read from src/lib/scoped-db.ts at test time (not imported: no database client). */
function readDomainModels(text: string): string[] {
  const sf = ts.createSourceFile("scoped-db.ts", text, ts.ScriptTarget.Latest, true);
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const d of stmt.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.name.text === "DOMAIN_MODELS" && d.initializer) {
        const arr = ts.isAsExpression(d.initializer) ? d.initializer.expression : d.initializer;
        if (ts.isArrayLiteralExpression(arr)) {
          return arr.elements.filter(ts.isStringLiteral).map((e) => e.text);
        }
      }
    }
  }
  throw new Error("DOMAIN_MODELS not found in src/lib/scoped-db.ts");
}
const DOMAIN_MODELS = readDomainModels(REAL.get("src/lib/scoped-db.ts") ?? "");

const at = (home: string, ...names: string[]): NamedFn[] => names.map((name) => ({ name, home }));

/** Phase 10 path prefixes: a C2 allowlist entry under one of them fails the suite. */
const PHASE_10_PREFIXES = [
  "src/lib/workspace-members/",
  "src/lib/notifications/",
  "src/lib/mentions/",
  "src/app/(app)/settings/team/",
  "src/app/(app)/settings/notifications/",
  "src/app/(auth)/invite/",
  "src/app/api/notifications/",
  "src/app/api/members/",
];

const SESSION_READING_CALLS: NamedFn[] = [
  ...at(SESSION, "getCurrentSession", "requireSession", "getScopedDb", "getSessionActor"),
  ...at(FRESH, "readFreshSession"),
  ...at(PAGE_ACCESS, "requirePageAccess"),
  ...at(AUTHZ, "getActiveOrgAccess", "requireOrgAdminScope", "requireOrgAdmin", "getOrgRole"),
];

const BASE_RULES: Omit<InventoryRules, "allowlist"> = {
  gates: [
    ...at(SESSION, "getScopedDb"),
    ...at(PAGE_ACCESS, "requirePageAccess"),
    ...at(AUTHZ, "getActiveOrgAccess", "requireOrgAdminScope", "requireOrgAdmin"),
  ],
  conditionalGate: { name: "getSessionActor", home: SESSION },
  membershipReaders: [
    ...at(
      MEMBERSHIP,
      "findActiveMembership",
      "findConservativeMembership",
      "shareLockActiveMembership",
    ),
    ...at(MEMBER_RIGHTS, "readMemberRights"),
  ],
  sessionInfra: SESSION_READING_CALLS,
  // Rule E slot: plan 10-16. Entry functions under src/app/(public) and src/app/api/public have no
  // session by design (the status token or the public form is their only credential), so Rule A
  // does not apply to them; plan 10-16 adds Rule E for the status-token loaders here.
  ruleAExcludedPrefixes: ["src/app/(public)/", "src/app/api/public/"],
  sessionReadHome: { file: FRESH, function: "readFreshSession" },
  entrySessionReaders: [
    ...at(SESSION, "getCurrentSession", "requireSession"),
    ...at(FRESH, "readFreshSession"),
  ],
  sessionReadingCalls: SESSION_READING_CALLS,
  domainModels: DOMAIN_MODELS,
};

const PRE_10_17 = "plan 10-17 puts requirePageAccess first (V-27)";

/** Every allowlist entry, each with the reason written after reading the function. */
const ALLOWLIST: AllowEntry[] = [
  // Rule A: tenant-reaching entries with no gate.
  {
    rule: "A",
    file: "src/app/(app)/layout.tsx",
    function: "AppLayout",
    reason: `reads the organization name, branding, logo and saved views after requireSession only; the saved views service checks membership; ${PRE_10_17}`,
  },
  {
    rule: "A",
    file: "src/app/(app)/settings/backups/page.tsx",
    function: "BackupsSettingsPage",
    reason: `reads only the instance-wide SystemSetting backup record, and only when getOrgRole (a conservative member read) is owner or admin, so a non-member reads nothing; ${PRE_10_17}`,
  },
  {
    rule: "A",
    file: "src/app/(auth)/login/page.tsx",
    function: "LoginPage",
    reason:
      "pre-authentication: counts users to send an empty install to /setup; reads no tenant row",
  },
  {
    rule: "A",
    file: "src/app/(auth)/setup/page.tsx",
    function: "SetupPage",
    reason:
      "pre-authentication: counts users to send a set-up install to /login; reads no tenant row",
  },
  {
    rule: "A",
    file: "src/app/(auth)/setup/actions.ts",
    function: "completeSetup",
    reason:
      "creates the first owner and organization under the tenant seed lock, only while no user exists; there is no session or membership yet",
  },
  {
    rule: "A",
    file: "src/app/api/auth/[...all]/route.ts",
    function: "GET",
    reason:
      "Better Auth's own HTTP handler (sign-in, sign-out, session); its organization and admin routes are blocked in src/proxy.ts (V-03, plan 10-15)",
  },
  {
    rule: "A",
    file: "src/app/api/auth/[...all]/route.ts",
    function: "POST",
    reason:
      "Better Auth's own HTTP handler (sign-in, sign-out, session); its organization and admin routes are blocked in src/proxy.ts (V-03, plan 10-15)",
  },
  {
    rule: "A",
    file: "src/app/api/health/route.ts",
    function: "GET",
    reason:
      "health check: a database ping and the instance-wide worker heartbeat; reads no tenant row",
  },
  {
    rule: "A",
    file: "src/app/api/health/probe/route.ts",
    function: "GET",
    reason: "container health probe: the same instance-wide snapshot; reads no tenant row",
  },
  {
    rule: "A",
    file: "src/app/api/palette/tickets/route.ts",
    function: "GET",
    reason:
      "reads the session through readFreshSession and passes the actor to searchTicketsForPalette, whose service checks membership before it searches (V-05)",
  },
  {
    rule: "A",
    file: "src/app/api/tickets/picker/route.ts",
    function: "GET",
    reason:
      "reads the session through readFreshSession and passes the actor to searchTicketsForPicker, whose service checks membership before it searches (V-05)",
  },

  // Rule C: session readers and auth.api calls outside the gates.
  {
    rule: "C",
    file: "src/app/(app)/layout.tsx",
    function: "AppLayout",
    reason: `requireSession only, before the layout's organization reads; ${PRE_10_17}`,
  },
  {
    rule: "C",
    file: "src/app/api/palette/tickets/route.ts",
    function: "GET",
    reason:
      "readFreshSession from the request headers (no Next request scope in a route); its service checks membership (V-05)",
  },
  {
    rule: "C",
    file: "src/app/api/tickets/picker/route.ts",
    function: "GET",
    reason:
      "readFreshSession from the request headers (no Next request scope in a route); its service checks membership (V-05)",
  },
  {
    rule: "C",
    file: "src/app/(auth)/setup/actions.ts",
    function: "completeSetup",
    reason:
      "in-process auth.api.signUpEmail and createOrganization create the first owner under the tenant seed lock while no user exists",
  },
  {
    rule: "C",
    file: "src/lib/bootstrap.ts",
    function: "createFirstOrgAndAdmin",
    reason:
      "boot-time bootstrap from the environment: in-process sign-up and organization creation under the tenant seed lock on an empty install",
  },
  {
    rule: "C",
    file: "src/lib/demo/identities.ts",
    function: "createDemoIdentities",
    reason:
      "DEMO_MODE seed: in-process sign-up of the demo agent behind the demo guard; never runs on a real install",
  },

  // Rule D: the worker.
  {
    rule: "D",
    file: "src/lib/worker/jobs/insight-run.ts",
    function: "insightRunHandler",
    reason:
      "updates only the status of the InsightRun row it loaded by the job's own id; the row keeps its organization and no other row is touched",
  },
  {
    rule: "D",
    file: "src/lib/worker/jobs/kb-embed-article.ts",
    function: "swapChunks",
    reason:
      "raw INSERT of KbChunk rows (pgvector column) carrying the locked article's organizationId, inside the scoped transaction under the article row lock",
  },
  {
    rule: "D",
    file: "src/lib/worker/jobs/sla-flag.ts",
    function: "updateBreach",
    reason:
      "raw UPDATE of the locked ticket ids, each paired with its own organizationId through unnest; returns a count only",
  },
  {
    rule: "D",
    file: "src/lib/worker/jobs/sla-flag.ts",
    function: "updateAtRisk",
    reason:
      "raw UPDATE of the locked ticket ids, each paired with its own organizationId through unnest; returns a count only",
  },
  {
    rule: "D",
    file: "src/lib/worker/jobs/snooze-wake.ts",
    function: "wakeDueTicket",
    reason: "raw UPDATE … RETURNING of one locked ticket, filtered by id and organizationId",
  },
  {
    rule: "D",
    file: "src/lib/worker/jobs/auto-close.ts",
    function: "closeResolvedTicketIfQuiet",
    reason:
      "raw UPDATE … RETURNING of one locked ticket, filtered by id and organizationId, with the state join scoped to the same organization",
  },
];

const REAL_RULES: InventoryRules = { ...BASE_RULES, allowlist: ALLOWLIST };

function run(sources: Record<string, string>, allowlist: AllowEntry[] = []) {
  return findViolations({ ...BASE_RULES, allowlist }, new Map(Object.entries(sources)));
}

const names = (vs: Violation[]) => vs.map((v) => `${v.rule} ${v.file}#${v.function}`);

// Shared fixture modules: a src/lib helper that reaches the shared prisma client, a service that
// reads membership, and one that does not.
const LIB_THINGS = `import { prisma } from "@/lib/db";
export async function loadThings(orgId: string) {
  return prisma.ticket.findMany({ where: { organizationId: orgId } });
}
`;
const LIB_SERVICE_WITH_MEMBERSHIP = `import { prisma } from "@/lib/db";
import { findActiveMembership } from "@/lib/membership";
export async function renameThing(actor: { userId: string; orgId: string }, id: string) {
  if (!(await findActiveMembership(prisma, actor.userId, actor.orgId))) return { ok: false };
  await prisma.ticket.updateMany({ where: { id, organizationId: actor.orgId }, data: {} });
  return { ok: true };
}
`;
const LIB_SERVICE_WITHOUT_MEMBERSHIP = `import { prisma } from "@/lib/db";
export async function renameThing(actor: { userId: string; orgId: string }, id: string) {
  await prisma.ticket.updateMany({ where: { id, organizationId: actor.orgId }, data: {} });
  return { ok: true };
}
`;

describe("the real tree", () => {
  const result = findViolations(REAL_RULES, REAL);

  it("reads DOMAIN_MODELS from src/lib/scoped-db.ts", () => {
    expect(DOMAIN_MODELS).toContain("Ticket");
    expect(DOMAIN_MODELS).toContain("MemberAuditEvent");
    expect(DOMAIN_MODELS.length).toBeGreaterThan(40);
  });

  it("finds the entry functions it must judge", () => {
    const rows = result.inventory.map((r) => `${r.kind} ${r.file}#${r.function}`);
    expect(rows).toContain("route-handler src/app/api/attachments/[id]/route.ts#GET");
    expect(rows).toContain("route-handler src/app/api/tickets/[id]/messages/route.ts#POST");
    expect(rows).toContain("layout src/app/(app)/layout.tsx#AppLayout");
    expect(rows).toContain("page src/app/(app)/tickets/[id]/page.tsx#TicketDetailPage");
    expect(rows).toContain("server-action src/app/(app)/tickets/[id]/actions.ts#assignTicket");
    expect(rows.length).toBeGreaterThan(90);
  });

  it("reports zero violations", () => {
    expect(result.violations).toEqual([]);
  });

  it("has a clean allowlist: every entry exists, has a reason and suppresses a finding", () => {
    expect(result.hygiene).toEqual([]);
  });

  it("carries no C2 allowlist entry under a Phase 10 path prefix", () => {
    const bad = ALLOWLIST.filter(
      (e) => e.rule === "C2" && PHASE_10_PREFIXES.some((p) => e.file.startsWith(p)),
    );
    expect(bad).toEqual([]);
  });

  it("has exactly one auth.api.getSession call in src, in readFreshSession", () => {
    const hits = [...REAL].filter(([, text]) => text.includes("auth.api.getSession"));
    expect(hits.map(([file]) => file)).toEqual([FRESH]);
  });

  it("judges the attachment and messages routes as gated by getScopedDb", () => {
    for (const file of [
      "src/app/api/attachments/[id]/route.ts",
      "src/app/api/tickets/[id]/messages/route.ts",
    ]) {
      const row = result.inventory.find((r) => r.file === file);
      expect(row?.gates).toContain("getScopedDb");
    }
  });
});

describe("Rule A fixtures", () => {
  it("flags a helper-mediated page with no gate, and passes it with requirePageAccess", () => {
    const page = (
      gate: boolean,
    ) => `${gate ? 'import { requirePageAccess } from "@/lib/page-access";\n' : ""}import { loadThings } from "@/lib/fx/things";
export default async function ThingsPage() {
  ${gate ? "const { orgId } = await requirePageAccess();" : 'const orgId = "x";'}
  const things = await loadThings(orgId);
  return things.length;
}
`;
    const bad = run({
      "src/lib/fx/things.ts": LIB_THINGS,
      "src/app/(app)/things/page.tsx": page(false),
    });
    expect(names(bad.violations)).toEqual(["A src/app/(app)/things/page.tsx#ThingsPage"]);
    const good = run({
      "src/lib/fx/things.ts": LIB_THINGS,
      "src/app/(app)/things/page.tsx": page(true),
    });
    expect(good.violations).toEqual([]);
  });

  it("judges each exported function of a use server file on its own", () => {
    const actions = `"use server";
import { prisma } from "@/lib/db";
import { getScopedDb } from "@/lib/session";
export async function gatedAction(id: string) {
  const { db } = await getScopedDb();
  await db.tag.delete({ where: { id } });
}
export async function ungatedAction(id: string) {
  await prisma.tag.deleteMany({ where: { id } });
}
`;
    const result = run({ "src/app/(app)/things/actions.ts": actions });
    expect(names(result.violations)).toEqual(["A src/app/(app)/things/actions.ts#ungatedAction"]);
  });

  it("flags a route GET that reads the session itself and uses prisma; passes the attachment route shape", () => {
    const bad = `import { prisma } from "@/lib/db";
import { getCurrentSession } from "@/lib/session";
export async function GET() {
  const session = await getCurrentSession();
  if (!session) return new Response(null, { status: 401 });
  return Response.json(await prisma.ticket.findMany());
}
`;
    const badResult = run({ "src/app/api/things/route.ts": bad });
    expect(badResult.violations.map((v) => v.rule).sort()).toEqual(["A", "C"]);
    expect(new Set(names(badResult.violations))).toEqual(
      new Set(["A src/app/api/things/route.ts#GET", "C src/app/api/things/route.ts#GET"]),
    );

    const attachmentShape = `import { NextResponse } from "next/server";
import { AccessDeniedError } from "@/lib/membership";
import { getScopedDb } from "@/lib/session";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  let scoped: Awaited<ReturnType<typeof getScopedDb>>;
  try {
    scoped = await getScopedDb();
  } catch (err) {
    if (err instanceof AccessDeniedError) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  return NextResponse.json(await scoped.db.attachment.findFirst({ where: { id } }));
}
`;
    expect(run({ "src/app/api/things/[id]/route.ts": attachmentShape }).violations).toEqual([]);
  });

  it("accepts getSessionActor only with a service that reads membership", () => {
    const action = `"use server";
import { getSessionActor } from "@/lib/session";
import { renameThing } from "@/lib/fx/rename";
export async function renameAction(id: string) {
  const actor = await getSessionActor();
  return renameThing(actor, id);
}
`;
    const without = run({
      "src/lib/fx/rename.ts": LIB_SERVICE_WITHOUT_MEMBERSHIP,
      "src/app/(app)/things/actions.ts": action,
    });
    expect(names(without.violations)).toEqual(["A src/app/(app)/things/actions.ts#renameAction"]);
    expect(without.violations[0]?.detail).toContain("without a membership-reading service");

    const withMembership = run({
      "src/lib/fx/rename.ts": LIB_SERVICE_WITH_MEMBERSHIP,
      "src/app/(app)/things/actions.ts": action,
    });
    expect(withMembership.violations).toEqual([]);
  });

  it("does not count getOrgRole as a gate", () => {
    const page = `import { getOrgRole } from "@/lib/authz";
import { loadThings } from "@/lib/fx/things";
export default async function ThingsPage() {
  const role = await getOrgRole();
  return role ? (await loadThings("x")).length : 0;
}
`;
    const result = run({
      "src/lib/fx/things.ts": LIB_THINGS,
      "src/app/(app)/things/page.tsx": page,
    });
    expect(names(result.violations)).toEqual(["A src/app/(app)/things/page.tsx#ThingsPage"]);
  });

  it("follows a server component rendered as JSX from a page", () => {
    const panel = `import { loadThings } from "@/lib/fx/things";
export async function ThingsPanel() {
  return (await loadThings("x")).length;
}
`;
    const page = `import { ThingsPanel } from "./things-panel";
export default function ThingsPage() {
  return <ThingsPanel />;
}
`;
    const result = run({
      "src/lib/fx/things.ts": LIB_THINGS,
      "src/app/(app)/things/things-panel.tsx": panel,
      "src/app/(app)/things/page.tsx": page,
    });
    expect(names(result.violations)).toEqual(["A src/app/(app)/things/page.tsx#ThingsPage"]);
  });

  it("leaves public entries to Rule E (plan 10-16)", () => {
    const route = `import { prisma } from "@/lib/db";
export async function POST() {
  return Response.json(await prisma.ticket.count());
}
`;
    expect(run({ "src/app/api/public/things/route.ts": route }).violations).toEqual([]);
  });
});

describe("Rule C and C2 fixtures", () => {
  it("K141: an action calling requireOrgAdmin and then getScopedDb is one C2 violation", () => {
    const action = `"use server";
import { requireOrgAdmin } from "@/lib/authz";
import { getScopedDb } from "@/lib/session";
export async function twoReads(id: string) {
  await requireOrgAdmin();
  const { db } = await getScopedDb();
  await db.tag.delete({ where: { id } });
}
export async function oneRead(id: string) {
  const { db } = await getScopedDb();
  await db.tag.delete({ where: { id } });
}
`;
    const result = run({ "src/app/(app)/things/actions.ts": action });
    expect(names(result.violations)).toEqual(["C2 src/app/(app)/things/actions.ts#twoReads"]);
  });

  it("counts a session read in a same-module helper towards C2", () => {
    const action = `"use server";
import { requireOrgAdminScope } from "@/lib/authz";
import { getScopedDb } from "@/lib/session";
async function guard() {
  return requireOrgAdminScope();
}
export async function viaHelper(id: string) {
  await guard();
  const { db } = await getScopedDb();
  await db.tag.delete({ where: { id } });
}
`;
    const result = run({ "src/app/(app)/things/actions.ts": action });
    expect(names(result.violations)).toEqual(["C2 src/app/(app)/things/actions.ts#viaHelper"]);
  });

  it("flags a second auth.api.getSession function in a fresh-session-shaped file, and only that one", () => {
    const fresh = `import { auth } from "./auth";
export async function readFreshSession(requestHeaders: Headers) {
  return auth.api.getSession({ headers: requestHeaders, query: { disableCookieCache: true } });
}
export async function readCachedSession(requestHeaders: Headers) {
  return auth.api.getSession({ headers: requestHeaders });
}
`;
    const result = run({ [FRESH]: fresh });
    expect(names(result.violations)).toEqual([`C ${FRESH}#readCachedSession`]);
  });

  it("never allowlists auth.api.getSession outside readFreshSession", () => {
    const lib = `import { auth } from "@/lib/auth";
export async function sneaky(h: Headers) {
  return auth.api.getSession({ headers: h });
}
`;
    const entry: AllowEntry = {
      rule: "C",
      file: "src/lib/fx/sneaky.ts",
      function: "sneaky",
      reason: "no",
    };
    const result = run({ "src/lib/fx/sneaky.ts": lib }, [entry]);
    expect(names(result.violations)).toEqual(["C src/lib/fx/sneaky.ts#sneaky"]);
    expect(result.hygiene).toEqual(["C src/lib/fx/sneaky.ts#sneaky: suppresses no finding"]);
  });

  it("flags other auth.api calls unless their function is allowlisted", () => {
    const lib = `import { auth } from "@/lib/auth";
export async function makeUser(email: string) {
  return auth.api.signUpEmail({ body: { name: "x", email, password: "y" } });
}
`;
    expect(names(run({ "src/lib/fx/make-user.ts": lib }).violations)).toEqual([
      "C src/lib/fx/make-user.ts#makeUser",
    ]);
    const allowed = run({ "src/lib/fx/make-user.ts": lib }, [
      { rule: "C", file: "src/lib/fx/make-user.ts", function: "makeUser", reason: "fixture" },
    ]);
    expect(allowed.violations).toEqual([]);
    expect(allowed.hygiene).toEqual([]);
  });
});

describe("Rule D fixtures (worker)", () => {
  const W = "src/lib/worker/jobs/fx-job.ts";

  it("flags a worker job that imports next/headers", () => {
    const job = `import { headers } from "next/headers";
export async function fxHandler() {
  return (await headers()).get("x");
}
`;
    expect(names(run({ [W]: job }).violations)).toEqual([`D ${W}#<module>`]);
  });

  it("flags a worker job that calls auth.api", () => {
    const job = `import { auth } from "../../auth";
export async function fxHandler() {
  await auth.api.signUpEmail({ body: { name: "x", email: "x@example.test", password: "y" } });
}
`;
    const result = run({ [W]: job });
    expect(result.violations.filter((v) => v.rule === "D").map((v) => v.function)).toEqual([
      "fxHandler",
    ]);
  });

  it("flags a tenant write filtered on status only, naming the handler", () => {
    const job = `import { prisma } from "../../db";
export async function fxHandler() {
  await prisma.ticket.updateMany({ where: { isBreached: false }, data: { isAtRisk: true } });
}
`;
    expect(names(run({ [W]: job }).violations)).toEqual([`D ${W}#fxHandler`]);
  });

  it("passes the same write with organizationId in its where, and through a scopedDb client", () => {
    const withOrg = `import { prisma } from "../../db";
export async function fxHandler(data: { orgId: string }) {
  await prisma.ticket.updateMany({
    where: { isBreached: false, organizationId: data.orgId },
    data: { isAtRisk: true },
  });
}
`;
    expect(run({ [W]: withOrg }).violations).toEqual([]);
    const scoped = `import { scopedDb } from "../../scoped-db";
export async function fxHandler(data: { orgId: string }) {
  const db = scopedDb(data.orgId);
  await db.ticket.updateMany({ where: { isBreached: false }, data: { isAtRisk: true } });
  await db.$transaction(async (tx) => {
    await tx.ticket.updateMany({ where: { isBreached: false }, data: { isAtRisk: true } });
  });
}
`;
    expect(run({ [W]: scoped }).violations).toEqual([]);
  });

  it("flags a create on a tenant model whose data has no organizationId", () => {
    const job = `import { prisma } from "../../db";
export async function fxHandler(ticketId: string) {
  await prisma.message.create({ data: { ticketId, bodyMarkdown: "x" } });
}
`;
    expect(names(run({ [W]: job }).violations)).toEqual([`D ${W}#fxHandler`]);
  });

  it("does not judge writes to models outside DOMAIN_MODELS", () => {
    const job = `import { prisma } from "../../db";
export async function fxHandler() {
  await prisma.rateLimitHit.deleteMany({ where: { createdAt: { lt: new Date() } } });
}
`;
    expect(run({ [W]: job }).violations).toEqual([]);
  });

  it("flags a raw UPDATE without an allowlist entry, and not a SELECT … FOR UPDATE", () => {
    const job = `import { prisma } from "../../db";
export async function lockRows() {
  return prisma.$queryRaw\`SELECT id FROM "Ticket" ORDER BY id FOR UPDATE SKIP LOCKED\`;
}
export async function flipRows(ids: string[]) {
  return prisma.$executeRaw\`UPDATE "Ticket" SET "isAtRisk" = true WHERE id = ANY(\${ids})\`;
}
`;
    expect(names(run({ [W]: job }).violations)).toEqual([`D ${W}#flipRows`]);
    const allowed = run({ [W]: job }, [
      { rule: "D", file: W, function: "flipRows", reason: "fixture" },
    ]);
    expect(allowed.violations).toEqual([]);
  });
});

describe("allowlist hygiene", () => {
  const action = `"use server";
import { prisma } from "@/lib/db";
export async function ungated(id: string) {
  await prisma.tag.deleteMany({ where: { id } });
}
`;
  const F = "src/app/(app)/things/actions.ts";

  it("fails an entry whose function does not exist", () => {
    const result = run({ [F]: action }, [
      { rule: "A", file: F, function: "ungated", reason: "fixture" },
      { rule: "A", file: F, function: "missingFn", reason: "fixture" },
    ]);
    expect(result.violations).toEqual([]);
    expect(result.hygiene).toEqual([
      `A ${F}#missingFn: function does not exist`,
      `A ${F}#missingFn: suppresses no finding`,
    ]);
  });

  it("fails an entry with an empty reason", () => {
    const result = run({ [F]: action }, [
      { rule: "A", file: F, function: "ungated", reason: "  " },
    ]);
    expect(result.hygiene).toEqual([`A ${F}#ungated: empty reason`]);
  });

  it("fails an entry that suppresses no finding, and one naming a missing file", () => {
    const gated = `"use server";
import { getScopedDb } from "@/lib/session";
export async function gatedAction(id: string) {
  const { db } = await getScopedDb();
  await db.tag.delete({ where: { id } });
}
`;
    const result = run({ [F]: gated }, [
      { rule: "A", file: F, function: "gatedAction", reason: "fixture" },
      { rule: "D", file: "src/lib/worker/jobs/nope.ts", function: "x", reason: "fixture" },
    ]);
    expect(result.hygiene).toEqual([
      `A ${F}#gatedAction: suppresses no finding`,
      "D src/lib/worker/jobs/nope.ts#x: file does not exist",
      "D src/lib/worker/jobs/nope.ts#x: suppresses no finding",
    ]);
  });

  it("an allowlist entry never suppresses another rule's finding", () => {
    const result = run({ [F]: action }, [
      { rule: "C2", file: F, function: "ungated", reason: "fixture" },
    ]);
    expect(names(result.violations)).toEqual([`A ${F}#ungated`]);
    expect(result.hygiene).toEqual([`C2 ${F}#ungated: suppresses no finding`]);
  });
});
