import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { CSAT_MAX_BODY_BYTES } from "@/lib/attachments/constants";
import { readBoundedFormData } from "@/lib/http/read-bounded-form-data";
import { consumeRateLimit } from "@/lib/rate-limit/check-rate-limit";
import { getRateLimitIdentity } from "@/lib/rate-limit/client-ip";
import { PUBLIC_RATE_LIMITS, rateLimitedResponse } from "@/lib/rate-limit/public-limits";
import { recordCsat } from "@/lib/tickets/record-csat";
import { findTicketByStatusToken } from "@/lib/tickets/status-page-data";

export const runtime = "nodejs";

const csatSchema = z.object({
  score: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // Limit before the token lookup and the body parse, so tokens cannot be probed at full
  // speed and bodies cost nothing once over quota; honeypot hits count toward it (D-22).
  const { scope, max, windowMs } = PUBLIC_RATE_LIMITS.csat;
  const limit = await consumeRateLimit(scope, getRateLimitIdentity(request), { max, windowMs });
  if (!limit.allowed) {
    return rateLimitedResponse(limit.retryAfterSeconds);
  }

  // Unauthenticated bearer-token flow — the token IS the authorization, and only that ticket's
  // data is reachable: the one lookup helper (V-11), never scopedDb (no session/org context).
  const ticket = await findTicketByStatusToken(token);
  if (!ticket) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // CSAT is only accepted once the ticket's state is in group RESOLVED or CLOSED, admin-created
  // states of those groups included (Phase 12.1, D-11 CSAT row, D-02).
  const group = ticket.state.group;
  if (group !== "RESOLVED" && group !== "CLOSED") {
    return NextResponse.json({ error: "not_eligible" }, { status: 409 });
  }

  // Bounded on the bytes actually received, like intake and follow-up (review b-IN-b3).
  const body = await readBoundedFormData(request, CSAT_MAX_BODY_BYTES);
  if (!body.ok) {
    return body.reason === "too_large"
      ? NextResponse.json({ error: "payload_too_large" }, { status: 413 })
      : NextResponse.json({ error: "invalid_form_data" }, { status: 400 });
  }
  const form = body.form;

  // Honeypot (D-20): silent-success on trip, never a distinct status/error.
  if (((form.get("company_website") as string | null) ?? "") !== "") {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const rawScore = form.get("score");
  const rawComment = form.get("comment");
  const parsed = csatSchema.safeParse({
    score: rawScore == null ? Number.NaN : Number(rawScore),
    comment: typeof rawComment === "string" && rawComment.trim() !== "" ? rawComment : undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { score, comment } = parsed.data;

  // One CsatResponse per ticket — latest wins. The write locks the ticket row and checks the
  // group again in its own transaction, so a reopen that commits after the check above is
  // still seen (Codex diff critique D3).
  const result = await recordCsat(ticket.id, { score, comment: comment ?? null });
  if (result === "not_found") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (result === "not_eligible") {
    return NextResponse.json({ error: "not_eligible" }, { status: 409 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
