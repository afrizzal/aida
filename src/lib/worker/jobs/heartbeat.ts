import { prisma } from "../../db";

export async function heartbeatHandler(_data?: unknown): Promise<void> {
  const now = new Date().toISOString();
  await prisma.systemSetting.upsert({
    where: { key: "heartbeat:lastRunAt" },
    update: { value: now },
    create: { key: "heartbeat:lastRunAt", value: now },
  });
}
