import { afterEach, describe, expect, it, vi } from "vitest";

// addTag authorizes before it validates (D-28, AIDA-32, F-11). The session gate is
// getSessionActor -> requireSession -> redirect("/login"), the same gate as getScopedDb; the tag
// name is validated afterwards, inside the ticket mutation service. An unauthenticated call with
// an empty name must therefore be rejected by the gate, not answered by the validation.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ getScopedDb: vi.fn(), getSessionActor: vi.fn() }));
vi.mock("@/lib/queue/boss-client", () => ({ getBoss: vi.fn() }));
vi.mock("@/lib/rag/generate-draft", () => ({ generateDraftReply: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: { $transaction: vi.fn(), $executeRaw: vi.fn(), $queryRaw: vi.fn() },
}));

import { addTag } from "../../src/app/(app)/tickets/[id]/actions";
import { prisma } from "../../src/lib/db";
import { getScopedDb, getSessionActor } from "../../src/lib/session";

/** What next/navigation's redirect() throws (digest format NEXT_REDIRECT;<type>;<url>;<status>;). */
function nextRedirect(): Error {
  return Object.assign(new Error("NEXT_REDIRECT"), {
    digest: "NEXT_REDIRECT;replace;/login;307;",
  });
}

afterEach(() => {
  vi.resetAllMocks();
});

describe("addTag gate ordering (D-28, F-11)", () => {
  it("rejects an unauthenticated call with an empty name through the gate (D-28, F-11)", async () => {
    const redirect = nextRedirect();
    vi.mocked(getSessionActor).mockRejectedValueOnce(redirect);

    await expect(addTag("t1", "   ")).rejects.toBe(redirect);
    expect(getSessionActor).toHaveBeenCalledOnce();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(getScopedDb).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated call with a valid name through the gate (D-28, F-11)", async () => {
    const redirect = nextRedirect();
    vi.mocked(getSessionActor).mockRejectedValueOnce(redirect);

    await expect(addTag("t1", "billing")).rejects.toBe(redirect);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("returns { ok: false } for an empty name once the gate passes, touching no db method (D-28, F-11)", async () => {
    vi.mocked(getSessionActor).mockResolvedValueOnce({ userId: "u1", orgId: "org1" });

    await expect(addTag("t1", "   ")).resolves.toEqual({ ok: false, error: "INVALID" });
    expect(getSessionActor).toHaveBeenCalledOnce();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
