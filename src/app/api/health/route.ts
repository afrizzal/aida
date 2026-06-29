import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const hb = await prisma.systemSetting.findUnique({
      where: { key: "heartbeat:lastRunAt" },
    });
    return NextResponse.json({
      status: "ok",
      db: "connected",
      worker: hb?.value ? { lastRunAt: hb.value } : { status: "no heartbeat yet" },
    });
  } catch {
    return NextResponse.json({ status: "error", db: "unreachable" }, { status: 503 });
  }
}
