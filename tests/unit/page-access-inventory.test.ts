// Phase 10, plan 10-17 Task 3 (AIDA-43, D-08, C6, V-27): Rule B, the page helper on every
// protected render entry. The (app) layout and its page render in parallel (C6), so the layout's
// check does not stop a page from reading tenant data: each render entry runs the gate itself.
//
// Rule B, as checked by findPageAccessViolations (tests/support/source-inventory.ts):
//   Render entries: every page.tsx under src/app/(app) (always, found from the file system); the
//   (app) layout (always); every other layout.tsx under src/app/(app), and every exported
//   function of a server component module there (a .tsx file that is not "use client" or
//   "use server"), when it reaches tenant data (it, or a same-module function it calls,
//   references a binding of a src/lib module that reaches the shared prisma client, calls
//   scopedDb( or uses raw SQL).
//   For each, the first statement of the function's body awaits requirePageAccess
//   (src/lib/page-access.ts), as a declaration initializer or an expression, and no call to
//   requirePageAccess sits inside a try (redirect() throws; a catch would swallow it).
//   No such file calls or imports getScopedDb (src/lib/session.ts), which throws instead of
//   redirecting; the helper hands out the scoped client.
//   The number of (app) pages found must equal the number checked: a page whose default export
//   the rule cannot read fails the suite instead of being skipped.
//
// The redirect is not authorization (D-08): server actions and API routes keep their own checks,
// which tests/unit/membership-inventory.test.ts judges.
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  findPageAccessViolations,
  type PageAccessRules,
  type PageAccessViolation,
  readSourceTree,
} from "../support/source-inventory";

const ROOT = path.resolve(__dirname, "../..");
const REAL = readSourceTree(ROOT);

const RULES: PageAccessRules = {
  appPrefix: "src/app/(app)/",
  rootLayout: "src/app/(app)/layout.tsx",
  helper: { name: "requirePageAccess", home: "src/lib/page-access.ts" },
  forbidden: [{ name: "getScopedDb", home: "src/lib/session.ts" }],
};

/** The 18 pages of src/app/(app) at plan 10-17 (`git ls-files 'src/app/(app)/**\/page.tsx'`). */
const PAGES_AT_10_17 = [
  "src/app/(app)/contacts/[id]/page.tsx",
  "src/app/(app)/contacts/page.tsx",
  "src/app/(app)/insights/page.tsx",
  "src/app/(app)/kb/[id]/page.tsx",
  "src/app/(app)/kb/new/page.tsx",
  "src/app/(app)/kb/page.tsx",
  "src/app/(app)/kb/proposals/[id]/page.tsx",
  "src/app/(app)/kb/proposals/page.tsx",
  "src/app/(app)/settings/backups/page.tsx",
  "src/app/(app)/settings/branding/page.tsx",
  "src/app/(app)/settings/custom-fields/page.tsx",
  "src/app/(app)/settings/email/page.tsx",
  "src/app/(app)/settings/page.tsx",
  "src/app/(app)/settings/sla/page.tsx",
  "src/app/(app)/settings/statuses/page.tsx",
  "src/app/(app)/settings/tags/page.tsx",
  "src/app/(app)/tickets/[id]/page.tsx",
  "src/app/(app)/tickets/page.tsx",
];

// Shared fixture modules: the helper, the throwing gate, the shared client and a tenant loader.
const LIB = {
  "src/lib/page-access.ts": `import { prisma } from "@/lib/db";
import { scopedDb } from "@/lib/scoped-db";
export async function requirePageAccess() {
  const member = await prisma.member.findFirst({ where: {} });
  return { member, db: scopedDb("o") };
}
`,
  "src/lib/session.ts": `import { scopedDb } from "@/lib/scoped-db";
export async function getScopedDb() {
  return { db: scopedDb("o"), orgId: "o" };
}
`,
  "src/lib/db.ts": "export const prisma = {} as never;\n",
  "src/lib/scoped-db.ts": "export function scopedDb(orgId: string) { return orgId as never; }\n",
  "src/lib/things.ts": `import { prisma } from "@/lib/db";
export async function loadThings(orgId: string) {
  return prisma.ticket.findMany({ where: { organizationId: orgId } });
}
`,
  "src/lib/testing/e2e-fault.ts":
    "export async function e2eFault(point: string) { return point; }\n",
};

/** A compliant (app) layout, so a fixture tree has its always-checked root layout. */
const ROOT_LAYOUT = `import { requirePageAccess } from "@/lib/page-access";
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requirePageAccess();
  return <div>{children}</div>;
}
`;

function run(files: Record<string, string>) {
  return findPageAccessViolations(
    RULES,
    new Map(Object.entries({ ...LIB, "src/app/(app)/layout.tsx": ROOT_LAYOUT, ...files })),
  );
}

const labels = (vs: readonly PageAccessViolation[]) => vs.map((v) => `${v.file}#${v.function}`);
const details = (vs: readonly PageAccessViolation[]) => vs.map((v) => v.detail).join("\n");

const PAGE = "src/app/(app)/things/page.tsx";

describe("Rule B fixtures", () => {
  it("control: a page whose first statement awaits requirePageAccess and then reads data reports none", () => {
    const result = run({
      [PAGE]: `import { requirePageAccess } from "@/lib/page-access";
import { loadThings } from "@/lib/things";
export default async function ThingsPage() {
  const { db, orgId } = await requirePageAccess();
  const things = await loadThings(orgId);
  return <ul>{things.length}{String(db)}</ul>;
}
`,
    });
    expect(result.violations).toEqual([]);
    expect(result.checked.map((c) => `${c.kind} ${c.file}#${c.function}`)).toEqual([
      "layout src/app/(app)/layout.tsx#AppLayout",
      `page ${PAGE}#ThingsPage`,
    ]);
  });

  it("control: the bare expression form `await requirePageAccess();` reports none", () => {
    const result = run({
      [PAGE]: `import { requirePageAccess } from "@/lib/page-access";
export default async function ThingsPage() {
  await requirePageAccess();
  return <p>Things</p>;
}
`,
    });
    expect(result.violations).toEqual([]);
  });

  it("flags a page that calls getScopedDb", () => {
    const result = run({
      [PAGE]: `import { getScopedDb } from "@/lib/session";
export default async function ThingsPage() {
  const { db } = await getScopedDb();
  return <p>{String(db)}</p>;
}
`,
    });
    expect(labels(result.violations)).toContain(`${PAGE}#ThingsPage`);
    expect(details(result.violations)).toMatch(/getScopedDb/);
    // Two findings: the first statement is not the helper, and getScopedDb is called.
    expect(result.violations).toHaveLength(2);
  });

  it("flags getScopedDb even after the helper, and under an alias", () => {
    const after = run({
      [PAGE]: `import { requirePageAccess } from "@/lib/page-access";
import { getScopedDb } from "@/lib/session";
export default async function ThingsPage() {
  await requirePageAccess();
  const { db } = await getScopedDb();
  return <p>{String(db)}</p>;
}
`,
    });
    expect(after.violations).toHaveLength(1);
    expect(after.violations[0].detail).toMatch(/getScopedDb/);

    const aliased = run({
      [PAGE]: `import { requirePageAccess } from "@/lib/page-access";
import { getScopedDb as scoped } from "@/lib/session";
export default async function ThingsPage() {
  await requirePageAccess();
  const { db } = await scoped();
  return <p>{String(db)}</p>;
}
`,
    });
    expect(aliased.violations).toHaveLength(1);
    expect(aliased.violations[0].detail).toMatch(/getScopedDb/);
  });

  it("flags a page that calls requirePageAccess inside a try", () => {
    const result = run({
      [PAGE]: `import { requirePageAccess } from "@/lib/page-access";
export default async function ThingsPage() {
  try {
    await requirePageAccess();
  } catch {
    return <p>Oops</p>;
  }
  return <p>Things</p>;
}
`,
    });
    expect(labels(result.violations)).toEqual([`${PAGE}#ThingsPage`, `${PAGE}#ThingsPage`]);
    expect(details(result.violations)).toMatch(/inside a try/);
  });

  it("flags a helper call inside a later try even when the first statement is the helper", () => {
    const result = run({
      [PAGE]: `import { requirePageAccess } from "@/lib/page-access";
export default async function ThingsPage() {
  await requirePageAccess();
  try {
    const again = await requirePageAccess();
    return <p>{String(again)}</p>;
  } finally {
    console.log("done");
  }
}
`,
    });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].detail).toMatch(/inside a try/);
  });

  it("flags a page whose first awaited statement is another call", () => {
    const result = run({
      [PAGE]: `import { requirePageAccess } from "@/lib/page-access";
import { e2eFault } from "@/lib/testing/e2e-fault";
export default async function ThingsPage() {
  await e2eFault("things-page");
  await requirePageAccess();
  return <p>Things</p>;
}
`,
    });
    expect(labels(result.violations)).toEqual([`${PAGE}#ThingsPage`]);
    expect(result.violations[0].detail).toMatch(/first statement/);
  });

  it("flags a page whose first statement reads params before the helper", () => {
    const result = run({
      [PAGE]: `import { requirePageAccess } from "@/lib/page-access";
export default async function ThingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePageAccess();
  return <p>{id}</p>;
}
`,
    });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].detail).toMatch(/first statement/);
  });

  it("flags a sync page with no helper, even one that reads nothing", () => {
    const result = run({
      [PAGE]: `export default function ThingsPage() {
  return <p>Things</p>;
}
`,
    });
    expect(labels(result.violations)).toEqual([`${PAGE}#ThingsPage`]);
  });

  it("does not take a requirePageAccess of another module for the helper", () => {
    const result = run({
      "src/app/(app)/things/local-gate.ts":
        "export async function requirePageAccess() { return {}; }\n",
      [PAGE]: `import { requirePageAccess } from "./local-gate";
export default async function ThingsPage() {
  await requirePageAccess();
  return <p>Things</p>;
}
`,
    });
    expect(labels(result.violations)).toEqual([`${PAGE}#ThingsPage`]);
  });

  it("flags a default-exported async server component, imported by a page, that reads prisma without the helper", () => {
    const COMPONENT = "src/app/(app)/things/thing-panel.tsx";
    const page = `import { requirePageAccess } from "@/lib/page-access";
import ThingPanel from "./thing-panel";
export default async function ThingsPage() {
  await requirePageAccess();
  return <ThingPanel />;
}
`;
    const flagged = run({
      [PAGE]: page,
      [COMPONENT]: `import { prisma } from "@/lib/db";
export default async function ThingPanel() {
  const rows = await prisma.ticket.findMany({ where: {} });
  return <ul>{rows.length}</ul>;
}
`,
    });
    expect(labels(flagged.violations)).toEqual([`${COMPONENT}#ThingPanel`]);
    expect(flagged.checked.map((c) => `${c.kind} ${c.file}#${c.function}`)).toContain(
      `component ${COMPONENT}#ThingPanel`,
    );

    const passed = run({
      [PAGE]: page,
      [COMPONENT]: `import { prisma } from "@/lib/db";
import { requirePageAccess } from "@/lib/page-access";
export default async function ThingPanel() {
  const { orgId } = await requirePageAccess();
  const rows = await prisma.ticket.findMany({ where: { organizationId: orgId } });
  return <ul>{rows.length}</ul>;
}
`,
    });
    expect(passed.violations).toEqual([]);
  });

  it("flags a named-export server component that reaches tenant data through a same-module helper", () => {
    const COMPONENT = "src/app/(app)/things/thing-list.tsx";
    const result = run({
      [PAGE]: `import { requirePageAccess } from "@/lib/page-access";
import { ThingList } from "./thing-list";
export default async function ThingsPage() {
  await requirePageAccess();
  return <ThingList />;
}
`,
      [COMPONENT]: `import { loadThings } from "@/lib/things";
async function rows() {
  return loadThings("o");
}
export async function ThingList() {
  const list = await rows();
  return <ul>{list.length}</ul>;
}
`,
    });
    expect(labels(result.violations)).toEqual([`${COMPONENT}#ThingList`]);
  });

  it("does not judge client components or server components that reach no tenant data", () => {
    const result = run({
      [PAGE]: `import { requirePageAccess } from "@/lib/page-access";
export default async function ThingsPage() {
  await requirePageAccess();
  return <p>Things</p>;
}
`,
      "src/app/(app)/things/thing-form.tsx": `"use client";
import { loadThings } from "@/lib/things";
export function ThingForm() {
  void loadThings;
  return <form />;
}
`,
      "src/app/(app)/things/thing-row.tsx": `export function ThingRow({ name }: { name: string }) {
  return <li>{name}</li>;
}
`,
    });
    expect(result.violations).toEqual([]);
    expect(result.checked.map((c) => c.file)).not.toContain("src/app/(app)/things/thing-form.tsx");
    expect(result.checked.map((c) => c.file)).not.toContain("src/app/(app)/things/thing-row.tsx");
  });

  it("checks a nested layout that reaches tenant data, and skips one that reaches none", () => {
    const NESTED = "src/app/(app)/things/layout.tsx";
    const reaching = run({
      [NESTED]: `import { loadThings } from "@/lib/things";
export default async function ThingsLayout({ children }: { children: React.ReactNode }) {
  const list = await loadThings("o");
  return <section data-count={list.length}>{children}</section>;
}
`,
    });
    expect(labels(reaching.violations)).toEqual([`${NESTED}#ThingsLayout`]);

    const plain = run({
      [NESTED]: `export default function ThingsLayout({ children }: { children: React.ReactNode }) {
  return <section>{children}</section>;
}
`,
    });
    expect(plain.violations).toEqual([]);
    expect(plain.checked.map((c) => c.file)).not.toContain(NESTED);
  });

  it("always checks the (app) layout, and flags it without the helper", () => {
    const result = findPageAccessViolations(
      RULES,
      new Map(
        Object.entries({
          ...LIB,
          "src/app/(app)/layout.tsx": `export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>;
}
`,
        }),
      ),
    );
    expect(labels(result.violations)).toEqual(["src/app/(app)/layout.tsx#AppLayout"]);
  });

  it("fails when a page's default export cannot be read (pages found differ from pages checked)", () => {
    const result = run({
      [PAGE]: `import { requirePageAccess } from "@/lib/page-access";
import { wrap } from "./wrap";
export default wrap(async function ThingsPage() {
  await requirePageAccess();
  return <p>Things</p>;
});
`,
      "src/app/(app)/things/wrap.ts": "export const wrap = <T,>(f: T) => f;\n",
    });
    expect(result.pagesFound).toEqual([PAGE]);
    expect(result.pagesChecked).toEqual([]);
    expect(details(result.violations)).toMatch(/1 page\(s\) found, 0 checked/);
  });

  it("fails when the (app) layout is missing from the tree", () => {
    const result = findPageAccessViolations(RULES, new Map(Object.entries(LIB)));
    expect(details(result.violations)).toMatch(/layout/);
  });
});

describe("Rule B on the real tree", () => {
  const result = findPageAccessViolations(RULES, REAL);

  it("reports zero violations", () => {
    expect(result.violations).toEqual([]);
  });

  it("finds every (app) page on disk and checks each of them", () => {
    expect(result.pagesFound.length).toBeGreaterThanOrEqual(PAGES_AT_10_17.length);
    expect(result.pagesChecked).toEqual(result.pagesFound);
    for (const page of PAGES_AT_10_17) expect(result.pagesFound).toContain(page);
  });

  it("checks the (app) layout and the ticket list panel", () => {
    const checked = result.checked.map((c) => `${c.kind} ${c.file}#${c.function}`);
    expect(checked).toContain("layout src/app/(app)/layout.tsx#AppLayout");
    expect(checked).toContain(
      "component src/app/(app)/tickets/ticket-list-panel.tsx#TicketListPanel",
    );
  });

  it("skips the nested layouts that reach no tenant data", () => {
    const checked = result.checked.map((c) => c.file);
    expect(checked).not.toContain("src/app/(app)/settings/layout.tsx");
    expect(checked).not.toContain("src/app/(app)/tickets/layout.tsx");
  });
});
