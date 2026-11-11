import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { getActiveOrgAccess } from "@/lib/authz";
import { removeLogo, replaceLogo } from "@/lib/branding/logo-store";
import { LOGO_MAX_BYTES } from "@/lib/branding/logo-validate";
import { classifyGateFailure, gateFailureStatus } from "@/lib/http/gate-failure";
import { readBoundedFormData } from "@/lib/http/read-bounded-form-data";
import { isAdminRole } from "@/lib/membership";

// Logo upload, replace and remove (Phase 9 plan 09-05, AIDA-34, D-08). A route handler, not a
// server action: Next's default server-action body limit (1 MB) is below a 1 MiB file plus the
// multipart framing. Order: session (401), then a member row in the active organization (403
// membership_ended, K164), then the owner or admin role (403 not_allowed), and
// only then the body, bounded to one part; nothing is read or written for a refused caller. The
// bytes are validated by logo-validate.ts (sniffed type, size, header dimensions); the declared
// type and the file name are never used. Responses carry a code only, never raw error text.
//
// Writes files, so it runs on the Node.js runtime, never Edge.
export const runtime = "nodejs";

/** Room for the multipart boundary and part headers around a file of LOGO_MAX_BYTES. */
const MULTIPART_OVERHEAD_BYTES = 65_536;

function codeResponse(code: string, status: number) {
  return NextResponse.json({ code }, { status });
}

function errorCode(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) return code;
  }
  return "UNKNOWN";
}

function logFailure(operation: string, err: unknown): void {
  try {
    console.error(`[branding-logo] ${operation} failed: code=${errorCode(err)}`);
  } catch {
    // Logging must never replace the response.
  }
}

type AdminGate = { ok: true; orgId: string } | { ok: false; response: Response };

async function requireLogoAdmin(): Promise<AdminGate> {
  // One session read for both the organization and the role (K141): the role is the caller's role
  // in exactly the organization this request then writes. getActiveOrgAccess() redirects (a
  // thrown redirect) without a session; this fetch endpoint answers 401 JSON instead. Any other
  // throw is a failure of the gate, a 500, never "signed out" (a-IN-7).
  let access: Awaited<ReturnType<typeof getActiveOrgAccess>>;
  try {
    access = await getActiveOrgAccess();
  } catch (err) {
    const failure = classifyGateFailure("branding-logo", err);
    return { ok: false, response: codeResponse(failure, gateFailureStatus(failure)) };
  }
  const { orgId, role } = access;
  // K164: no active organization (a deactivation in a one-organization install leaves it null,
  // D-07) or no member row in it is the membership refusal, 403 membership_ended.
  if (!orgId || !role) return { ok: false, response: codeResponse("membership_ended", 403) };
  // Owner or admin of the active organization; a plain member is not allowed.
  if (!isAdminRole(role)) return { ok: false, response: codeResponse("not_allowed", 403) };
  return { ok: true, orgId };
}

function revalidateBranding(): void {
  try {
    revalidatePath("/settings/branding");
    revalidatePath("/", "layout"); // the sidebar brand block lives in the (app) layout
  } catch (err) {
    // The change is committed; a failed revalidation only delays the new logo on cached pages.
    logFailure("revalidate", err);
  }
}

export async function POST(request: Request) {
  const gate = await requireLogoAdmin();
  if (!gate.ok) return gate.response;

  const body = await readBoundedFormData(request, LOGO_MAX_BYTES + MULTIPART_OVERHEAD_BYTES, {
    maxParts: 1,
  });
  if (!body.ok) {
    if (body.reason === "too_large") return codeResponse("too_large", 413);
    return codeResponse("unreadable", 400);
  }
  const file = body.form.get("file");
  if (!(file instanceof File)) return codeResponse("unreadable", 400);

  let result: Awaited<ReturnType<typeof replaceLogo>>;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    result = await replaceLogo({ orgId: gate.orgId, bytes });
  } catch (err) {
    logFailure("replace", err);
    return codeResponse("failed", 500);
  }
  if (!result.ok) return codeResponse(result.code, 400);

  revalidateBranding();
  return NextResponse.json({ ok: true, replaced: result.replaced, version: result.version });
}

export async function DELETE() {
  const gate = await requireLogoAdmin();
  if (!gate.ok) return gate.response;

  let removed: boolean;
  try {
    ({ removed } = await removeLogo({ orgId: gate.orgId }));
  } catch (err) {
    logFailure("remove", err);
    return codeResponse("failed", 500);
  }

  revalidateBranding();
  return NextResponse.json({ ok: true, removed });
}
