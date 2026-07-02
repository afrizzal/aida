import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";

const PEPPER = process.env.RATE_LIMIT_PEPPER ?? "aida-default-pepper";

function hashIp(ip: string) {
  return createHash("sha256").update(ip + PEPPER).digest("hex");
}

export async function checkRateLimit(
  scope: string,
  ip: string,
  opts?: { max?: number; windowMs?: number },
): Promise<boolean> {
  const max = opts?.max ?? 5;
  const windowMs = opts?.windowMs ?? 60 * 60 * 1000;
  const ipHash = hashIp(ip);
  const windowStart = new Date(Date.now() - windowMs);
  const recent = await prisma.rateLimitHit.count({
    where: { scope, ipHash, createdAt: { gte: windowStart } },
  });
  if (recent >= max) return false;
  await prisma.rateLimitHit.create({ data: { scope, ipHash } });
  return true;
}
