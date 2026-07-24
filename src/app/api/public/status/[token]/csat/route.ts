import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { prisma } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit/check-rate-limit";

export const runtime = "nodejs";

const csatSchema = z.object({
  score: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // Unauthenticated bearer-token flow — the token IS the authorization; bare prisma,
  // never scopedDb (no session/org context exists on this route).
  const ticket = await prisma.ticket.findUnique({ where: { statusToken: token } });
  if (!ticket) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // CSAT is only accepted once a ticket is RESOLVED/CLOSED (LOCKED).
  if (ticket.status !== "RESOLVED" && ticket.status !== "CLOSED") {
    return NextResponse.json({ error: "not_eligible" }, { status: 409 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "invalid_form_data" }, { status: 400 });
  }

  // Honeypot (D-20): silent-success on trip, never a distinct status/error.
  if (((form.get("company_website") as string | null) ?? "") !== "") {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!(await checkRateLimit("status-csat", ip))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
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

  // One CsatResponse per ticket — latest wins (LOCKED upsert semantics). Bare prisma with an
  // explicit organizationId on create (no scopedDb/session on a public route).
  await prisma.csatResponse.upsert({
    where: { ticketId: ticket.id },
    create: { organizationId: ticket.organizationId, ticketId: ticket.id, score, comment: comment ?? null },
    update: { score, comment: comment ?? null },
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}
