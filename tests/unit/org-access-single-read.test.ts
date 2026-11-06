// K141 (Phase 9 review c-CR-01): an admin gate reads the session ONCE and takes the role from the
// organization it then writes. Only the lowest layers are replaced (Better Auth's getSession, the
// member lookup, scopedDb and the stores), so the real gate code in src/lib/session.ts,
// src/lib/authz.ts, the logo route and the server actions runs. The active organization switches
// between the first and any later session read, the way a concurrent organization/set-active
// would: the user is an admin of ORG_ADMIN and a plain member of ORG_MEMBER.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getSession: vi.fn(),
  memberFindFirst: vi.fn(),
  scopedDb: vi.fn(),
  tagDelete: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: h.getSession } } }));
vi.mock("@/lib/db", () => ({ prisma: { member: { findFirst: h.memberFindFirst } } }));
vi.mock("@/lib/scoped-db", () => ({ scopedDb: h.scopedDb }));
vi.mock("@/lib/branding/logo-store", () => ({ replaceLogo: vi.fn(), removeLogo: vi.fn() }));
vi.mock("@/lib/kb/create-article", () => ({
  createKbArticle: vi.fn(async () => ({ id: "kb-1" })),
  updateKbArticle: vi.fn(),
}));

import { createKbArticleAction } from "../../src/app/(app)/kb/actions";
import { deleteTag } from "../../src/app/(app)/settings/tags/actions";
import { DELETE } from "../../src/app/api/settings/branding/logo/route";
import { removeLogo } from "../../src/lib/branding/logo-store";
import { createKbArticle } from "../../src/lib/kb/create-article";

const ORG_ADMIN = "org-where-admin";
const ORG_MEMBER = "org-where-member";

function sessionIn(orgId: string) {
  return { user: { id: "user-1" }, session: { activeOrganizationId: orgId } };
}

/** The first session read sees `first`; every later read sees `then` (the switch committed). */
function activeOrgSwitches(first: string, then: string): void {
  h.getSession.mockResolvedValueOnce(sessionIn(first)).mockResolvedValue(sessionIn(then));
}

beforeEach(() => {
  h.memberFindFirst.mockImplementation(
    async (args: { where: { userId: string; organizationId: string } }) => {
      if (args.where.organizationId === ORG_ADMIN) return { role: "admin" };
      if (args.where.organizationId === ORG_MEMBER) return { role: "member" };
      return null;
    },
  );
  h.scopedDb.mockImplementation((orgId: string) => ({
    orgId,
    tag: { delete: (args: unknown) => h.tagDelete(orgId, args) },
  }));
  vi.mocked(removeLogo).mockResolvedValue({ removed: true });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe("logo route admin gate (K141)", () => {
  it("refuses a member whose active organization switches to an admin one mid-request", async () => {
    activeOrgSwitches(ORG_MEMBER, ORG_ADMIN);

    const response = await DELETE();

    expect(response.status).toBe(403);
    expect(removeLogo).not.toHaveBeenCalled();
    expect(h.getSession).toHaveBeenCalledTimes(1);
  });

  it("writes only to the organization whose role it checked", async () => {
    activeOrgSwitches(ORG_ADMIN, ORG_MEMBER);

    const response = await DELETE();

    expect(response.status).toBe(200);
    expect(removeLogo).toHaveBeenCalledTimes(1);
    expect(removeLogo).toHaveBeenCalledWith({ orgId: ORG_ADMIN });
    expect(h.getSession).toHaveBeenCalledTimes(1);
  });
});

describe("server action admin gate (K141)", () => {
  it("deleteTag never writes to an organization whose role was not checked", async () => {
    activeOrgSwitches(ORG_ADMIN, ORG_MEMBER);

    await deleteTag("tag-1");

    expect(h.tagDelete).toHaveBeenCalledTimes(1);
    expect(h.tagDelete).toHaveBeenCalledWith(ORG_ADMIN, { where: { id: "tag-1" } });
    expect(h.scopedDb).not.toHaveBeenCalledWith(ORG_MEMBER);
    expect(h.getSession).toHaveBeenCalledTimes(1);
  });

  it("createKbArticleAction refuses a member whose organization switches mid-request", async () => {
    activeOrgSwitches(ORG_MEMBER, ORG_ADMIN);

    await expect(createKbArticleAction({ title: "T", bodyMarkdown: "B" })).rejects.toThrow(
      /Forbidden/,
    );
    expect(createKbArticle).not.toHaveBeenCalled();
  });

  it("createKbArticleAction creates in the organization whose role it checked", async () => {
    activeOrgSwitches(ORG_ADMIN, ORG_MEMBER);

    await createKbArticleAction({ title: "T", bodyMarkdown: "B" });

    expect(createKbArticle).toHaveBeenCalledWith(ORG_ADMIN, { title: "T", bodyMarkdown: "B" });
    expect(h.getSession).toHaveBeenCalledTimes(1);
  });
});
