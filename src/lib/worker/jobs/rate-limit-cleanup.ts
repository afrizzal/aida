import { prisma } from "../../db";

export async function rateLimitCleanupHandler(): Promise<void> {
  await prisma.rateLimitHit.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - 48 * 3600 * 1000) } },
  });
}
