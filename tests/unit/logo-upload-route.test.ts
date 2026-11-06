// Phase 9 plan 09-05 (AIDA-34, D-08): the authenticated logo route's order and codes. The session,
// the role and the store are replaced; the bounded body reader and isAdminRole are the real ones.
// Order under test: session (401), then the owner or admin role (403 not_allowed), and only then
// the body; a refused caller's body is never read and nothing is written. The real session and
// member paths through the UI are plan 09-07's E2E.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/authz", () => ({ getActiveOrgAccess: vi.fn() }));
vi.mock("@/lib/branding/logo-store", () => ({ replaceLogo: vi.fn(), removeLogo: vi.fn() }));

import { revalidatePath } from "next/cache";
import { DELETE, POST } from "../../src/app/api/settings/branding/logo/route";
import { getActiveOrgAccess } from "../../src/lib/authz";
import { removeLogo, replaceLogo } from "../../src/lib/branding/logo-store";
import { LOGO_MAX_BYTES } from "../../src/lib/branding/logo-validate";
import { pngBytes } from "../support/logo-images";

const URL = "http://localhost/api/settings/branding/logo";
const ORG_ID = "org-logo-route";

function nextRedirect(): Error {
  return Object.assign(new Error("NEXT_REDIRECT"), {
    digest: "NEXT_REDIRECT;replace;/login;307;",
  });
}

function signedInAs(role: string | null) {
  vi.mocked(getActiveOrgAccess).mockResolvedValue({
    orgId: ORG_ID,
    role,
  } as unknown as Awaited<ReturnType<typeof getActiveOrgAccess>>);
}

function upload(parts: Record<string, Blob | string>): Request {
  const form = new FormData();
  for (const [name, value] of Object.entries(parts)) {
    if (typeof value === "string") form.append(name, value);
    else form.append(name, value, "logo.png");
  }
  return new Request(URL, { method: "POST", body: form });
}

function pngFile(bytes = pngBytes(32, 32), type = "image/png"): Blob {
  return new Blob([new Uint8Array(bytes)], { type });
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe("logo route gate", () => {
  it("POST without a session answers 401 and reads no body", async () => {
    vi.mocked(getActiveOrgAccess).mockRejectedValue(nextRedirect());
    const request = upload({ file: pngFile() });

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: "unauthorized" });
    expect(request.bodyUsed).toBe(false);
    expect(replaceLogo).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("POST by a member answers 403 not_allowed, reads no body and writes nothing", async () => {
    signedInAs("member");
    const request = upload({ file: pngFile() });

    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: "not_allowed" });
    expect(request.bodyUsed).toBe(false);
    expect(replaceLogo).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("POST with no member row in the active organization (role null) answers 403 not_allowed", async () => {
    signedInAs(null);
    expect((await POST(upload({ file: pngFile() }))).status).toBe(403);
    expect(replaceLogo).not.toHaveBeenCalled();
  });

  it("POST with a combined role string is refused (isAdminRole is exact)", async () => {
    signedInAs("member,admin");
    expect((await POST(upload({ file: pngFile() }))).status).toBe(403);
  });

  it("DELETE without a session answers 401 and by a member 403 not_allowed; nothing is removed", async () => {
    vi.mocked(getActiveOrgAccess).mockRejectedValue(nextRedirect());
    const anonymous = await DELETE();
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toEqual({ code: "unauthorized" });

    signedInAs("member");
    const member = await DELETE();
    expect(member.status).toBe(403);
    expect(await member.json()).toEqual({ code: "not_allowed" });
    expect(removeLogo).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("logo route upload and remove", () => {
  it("an admin's upload passes the received bytes to replaceLogo and revalidates the settings page and the layout", async () => {
    signedInAs("admin");
    vi.mocked(replaceLogo).mockResolvedValue({
      ok: true,
      replaced: false,
      version: "0123456789ab",
    });
    const bytes = pngBytes(48, 24);
    // The declared type is not used for anything: the store sniffs the bytes.
    const response = await POST(upload({ file: pngFile(bytes, "image/svg+xml") }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, replaced: false, version: "0123456789ab" });
    expect(replaceLogo).toHaveBeenCalledOnce();
    const input = vi.mocked(replaceLogo).mock.calls[0]?.[0];
    expect(input?.orgId).toBe(ORG_ID);
    expect(Buffer.compare(Buffer.from(input?.bytes ?? []), bytes)).toBe(0);
    expect(revalidatePath).toHaveBeenCalledWith("/settings/branding");
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("an owner's replace answers replaced: true", async () => {
    signedInAs("owner");
    vi.mocked(replaceLogo).mockResolvedValue({ ok: true, replaced: true, version: "aaaaaaaaaaaa" });
    expect(await (await POST(upload({ file: pngFile() }))).json()).toEqual({
      ok: true,
      replaced: true,
      version: "aaaaaaaaaaaa",
    });
  });

  it("a body above the bound answers 413 too_large without calling the store", async () => {
    signedInAs("admin");
    const big = new Blob([new Uint8Array(LOGO_MAX_BYTES + 65_537)], { type: "image/png" });
    const response = await POST(upload({ file: big }));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ code: "too_large" });
    expect(replaceLogo).not.toHaveBeenCalled();
  });

  it("a second part, a missing file field or a non-form body answers 400 unreadable", async () => {
    signedInAs("admin");
    for (const request of [
      upload({ file: pngFile(), extra: "x" }),
      upload({ other: pngFile() }),
      upload({ file: "not a file" }),
      new Request(URL, {
        method: "POST",
        body: "{}",
        headers: { "content-type": "application/json" },
      }),
    ]) {
      const response = await POST(request);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ code: "unreadable" });
    }
    expect(replaceLogo).not.toHaveBeenCalled();
  });

  it("a validation refusal answers 400 with its code and revalidates nothing", async () => {
    signedInAs("admin");
    for (const code of [
      "svg",
      "too_large",
      "too_many_pixels",
      "unreadable",
      "not_image",
    ] as const) {
      vi.mocked(replaceLogo).mockResolvedValueOnce({ ok: false, code });
      const response = await POST(upload({ file: pngFile() }));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ code });
    }
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("a thrown store error answers 500 failed with no raw text, and logs a code only", async () => {
    signedInAs("admin");
    vi.mocked(replaceLogo).mockRejectedValue(
      Object.assign(new Error("connection to secret-host refused"), { code: "ECONNREFUSED" }),
    );
    const response = await POST(upload({ file: pngFile() }));
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ code: "failed" });
    expect(text).not.toContain("secret-host");
    expect(vi.mocked(console.error).mock.calls).toEqual([
      ["[branding-logo] replace failed: code=ECONNREFUSED"],
    ]);
  });

  it("an admin's DELETE removes and revalidates; a thrown error answers 500 failed", async () => {
    signedInAs("admin");
    vi.mocked(removeLogo).mockResolvedValueOnce({ removed: true });
    const response = await DELETE();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, removed: true });
    expect(removeLogo).toHaveBeenCalledWith({ orgId: ORG_ID });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");

    vi.mocked(removeLogo).mockRejectedValueOnce(new Error("boom"));
    const failed = await DELETE();
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ code: "failed" });
  });
});
