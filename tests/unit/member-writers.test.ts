// Phase 10, plan 10-03 (AIDA-43, V-26 (6), O-4 default): the static allowlist of `member` table
// writers under src. Better Auth's member table has no unique key on (organizationId, userId), so
// the duplicate-row rules of V-26 hold only while every writer follows one protocol: a new
// organization or a new user under the tenant seed lock or the demo guard, or a Phase 10 writer
// under the organization lock. A new writer anywhere else fails this suite.
//
// A writer is:
//   - a call `<receiver>.member.<create|createMany|createManyAndReturn|update|updateMany|
//     updateManyAndReturn|upsert|delete|deleteMany>(…)`;
//   - a string or template literal (raw SQL) containing INSERT INTO "member", UPDATE "member" or
//     DELETE FROM "member";
//   - an `….api.<createOrganization|addMember|removeMember|updateMemberRole|leaveOrganization|
//     acceptInvitation>(…)` call (Better Auth's in-process organization plugin endpoints).
// The allowlist is by file, each with its reason. An entry that suppresses no finding fails the
// suite, so the list cannot go stale.
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { chainOf, readSourceTree } from "../support/source-inventory";

const ROOT = path.resolve(__dirname, "../..");
const REAL = readSourceTree(ROOT);

const MEMBER_METHODS = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
  "delete",
  "deleteMany",
]);

const AUTH_API_WRITERS = new Set([
  "createOrganization",
  "addMember",
  "removeMember",
  "updateMemberRole",
  "leaveOrganization",
  "acceptInvitation",
]);

const RAW_MEMBER_WRITE = /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"member"/i;

interface Finding {
  file: string;
  line: number;
  kind: "model-call" | "raw-sql" | "auth-api";
  text: string;
}

interface WriterAllowEntry {
  file: string;
  reason: string;
}

/** Every member writer in the given sources, in file and line order. */
function findMemberWriters(sources: ReadonlyMap<string, string>): Finding[] {
  const out: Finding[] = [];
  for (const [file, text] of sources) {
    const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
    const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n)) {
        const chain = chainOf(n.expression);
        const name = chain[chain.length - 1] ?? "";
        const receiver = chain[chain.length - 2];
        if (receiver === "member" && MEMBER_METHODS.has(name)) {
          out.push({ file, line: lineOf(n), kind: "model-call", text: chain.join(".") });
        } else if (receiver === "api" && AUTH_API_WRITERS.has(name)) {
          out.push({ file, line: lineOf(n), kind: "auth-api", text: chain.join(".") });
        }
      }
      if (
        ts.isNoSubstitutionTemplateLiteral(n) ||
        ts.isTemplateExpression(n) ||
        ts.isStringLiteral(n)
      ) {
        const raw = n.getText(sf);
        if (RAW_MEMBER_WRITE.test(raw)) {
          out.push({ file, line: lineOf(n), kind: "raw-sql", text: raw.slice(0, 80) });
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
}

/** Findings outside the allowlist, and allowlist entries that are empty or suppress nothing. */
function evaluate(sources: ReadonlyMap<string, string>, allowlist: readonly WriterAllowEntry[]) {
  const findings = findMemberWriters(sources);
  const allowed = new Set(allowlist.map((e) => e.file));
  const violations = findings.filter((f) => !allowed.has(f.file));
  const badEntries = allowlist.filter(
    (e) => e.reason.trim() === "" || !findings.some((f) => f.file === e.file),
  );
  return { findings, violations, badEntries };
}

/** The allowed member writers of src, by file (V-26 (6)). Plan 10-05 adds invitations.ts. */
const ALLOWLIST: WriterAllowEntry[] = [
  {
    file: "src/lib/bootstrap.ts",
    reason:
      "auth.api.createOrganization: the first organization and its owner at boot, under the tenant seed lock on an empty install",
  },
  {
    file: "src/app/(auth)/setup/actions.ts",
    reason:
      "auth.api.createOrganization: the first organization and its owner from /setup, under the tenant seed lock while no user exists",
  },
  {
    file: "src/lib/demo/identities.ts",
    reason:
      "prisma.member.create of the demo agent, a new user, behind the DEMO_MODE guard; never runs on a real install",
  },
  {
    file: "src/lib/workspace-members/member-admin.ts",
    reason:
      "role change (updateMany of every row of the target) and deactivation (deleteMany of every row of the target), both under the organization lock (D-09, V-26 (5))",
  },
  {
    file: "src/lib/workspace-members/invitations.ts",
    reason: "accept inserts one member row under the organization lock",
  },
];

const run = (sources: Record<string, string>, allowlist: WriterAllowEntry[] = ALLOWLIST) =>
  evaluate(new Map(Object.entries(sources)), allowlist);

describe("member-table writers in the real tree (V-26 (6))", () => {
  const result = evaluate(REAL, ALLOWLIST);

  it("finds the known writers in every allowlisted file", () => {
    for (const entry of ALLOWLIST) {
      expect(
        result.findings.some((f) => f.file === entry.file),
        entry.file,
      ).toBe(true);
    }
    // The three pre-Phase-10 writers named in V-26 (6).
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: "src/lib/bootstrap.ts", kind: "auth-api" }),
        expect.objectContaining({ file: "src/app/(auth)/setup/actions.ts", kind: "auth-api" }),
        expect.objectContaining({ file: "src/lib/demo/identities.ts", kind: "model-call" }),
      ]),
    );
  });

  it("has no member writer outside the allowlist", () => {
    expect(result.violations).toEqual([]);
  });

  it("has a clean allowlist: every entry has a reason and suppresses a finding", () => {
    expect(result.badEntries).toEqual([]);
  });

  it("member-admin.ts writes only through updateMany and deleteMany", () => {
    const own = result.findings.filter(
      (f) => f.file === "src/lib/workspace-members/member-admin.ts",
    );
    expect(own.map((f) => f.text).sort()).toEqual(expect.arrayContaining(["tx.member.updateMany"]));
    for (const f of own) expect(["tx.member.updateMany", "tx.member.deleteMany"]).toContain(f.text);
  });

  it("invitations.ts writes only one tx.member.create (the accept, plan 10-05)", () => {
    const own = result.findings.filter(
      (f) => f.file === "src/lib/workspace-members/invitations.ts",
    );
    expect(own.map((f) => f.text)).toEqual(["tx.member.create"]);
  });
});

describe("member-table writer fixtures", () => {
  it("flags a prisma.member.create in a file outside the list", () => {
    const { violations } = run({
      "src/lib/fx/add-member.ts": `import { prisma } from "@/lib/db";
export async function addMember(orgId: string, userId: string) {
  await prisma.member.create({ data: { id: "m", organizationId: orgId, userId, role: "member", createdAt: new Date() } });
}
`,
    });
    expect(violations).toEqual([
      expect.objectContaining({
        file: "src/lib/fx/add-member.ts",
        kind: "model-call",
        text: "prisma.member.create",
      }),
    ]);
  });

  it("flags every write method on a transaction client and none of the reads", () => {
    const methods = [...MEMBER_METHODS];
    const body = methods.map((m) => `  await tx.member.${m}({} as never);`).join("\n");
    const { violations } = run({
      "src/lib/fx/all-writes.ts": `export async function all(tx: any) {
${body}
  await tx.member.findMany({});
  await tx.member.findFirst({});
  await tx.member.count({});
}
`,
    });
    expect(violations.map((v) => v.text.split(".").pop()).sort()).toEqual([...methods].sort());
  });

  it('flags raw INSERT, UPDATE and DELETE on "member", not a SELECT or another table', () => {
    const { violations } = run({
      "src/lib/fx/raw.ts": `export async function raw(tx: any, id: string) {
  await tx.$executeRaw\`INSERT INTO "member" (id) VALUES (\${id})\`;
  await tx.$executeRaw\`UPDATE "member" SET role = 'owner' WHERE id = \${id}\`;
  await tx.$executeRawUnsafe('DELETE FROM "member" WHERE id = $1', id);
  await tx.$queryRaw\`SELECT id FROM "member" WHERE id = \${id} FOR SHARE\`;
  await tx.$executeRaw\`UPDATE "invitation" SET status = 'canceled' WHERE id = \${id}\`;
}
`,
    });
    expect(violations.map((v) => v.kind)).toEqual(["raw-sql", "raw-sql", "raw-sql"]);
  });

  it("flags the in-process Better Auth organization writers", () => {
    const { violations } = run({
      "src/lib/fx/auth-writes.ts": `import { auth } from "@/lib/auth";
export async function w(headers: Headers) {
  await auth.api.addMember({ body: {} as never });
  await auth.api.removeMember({ body: {} as never, headers });
  await auth.api.updateMemberRole({ body: {} as never, headers });
  await auth.api.leaveOrganization({ body: {} as never, headers });
  await auth.api.acceptInvitation({ body: {} as never, headers });
  await auth.api.createOrganization({ body: {} as never });
  await auth.api.getSession({ headers });
}
`,
    });
    expect(violations.map((v) => v.text)).toEqual([
      "auth.api.addMember",
      "auth.api.removeMember",
      "auth.api.updateMemberRole",
      "auth.api.leaveOrganization",
      "auth.api.acceptInvitation",
      "auth.api.createOrganization",
    ]);
  });

  it("passes the same writer once its file is allowlisted", () => {
    const sources = {
      "src/lib/fx/add-member.ts": `export async function a(tx: any) { await tx.member.create({}); }`,
    };
    const { violations, badEntries } = run(sources, [
      { file: "src/lib/fx/add-member.ts", reason: "fixture" },
    ]);
    expect(violations).toEqual([]);
    expect(badEntries).toEqual([]);
  });

  it("fails an allowlist entry that suppresses nothing, and one with an empty reason", () => {
    const sources = {
      "src/lib/fx/reads-only.ts": `export async function r(tx: any) { return tx.member.findMany({}); }`,
      "src/lib/fx/writer.ts": `export async function w(tx: any) { await tx.member.deleteMany({}); }`,
    };
    const { badEntries } = run(sources, [
      { file: "src/lib/fx/reads-only.ts", reason: "fixture" },
      { file: "src/lib/fx/missing.ts", reason: "fixture" },
      { file: "src/lib/fx/writer.ts", reason: "  " },
    ]);
    expect(badEntries.map((e) => e.file)).toEqual([
      "src/lib/fx/reads-only.ts",
      "src/lib/fx/missing.ts",
      "src/lib/fx/writer.ts",
    ]);
  });
});
