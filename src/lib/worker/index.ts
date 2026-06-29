import { PgBoss } from "pg-boss";
import type { Job } from "pg-boss";
import { heartbeatHandler } from "./jobs/heartbeat";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required for the worker");

  const boss = new PgBoss(connectionString);
  boss.on("error", (err: Error) => console.error("[worker] pg-boss error:", err));
  await boss.start();

  // v10+ pattern: work handler receives an array — destructure the first element
  await boss.work("heartbeat", async ([job]: Job[]) => {
    await heartbeatHandler(job.data);
  });

  // idempotent upsert via schedule(); runs every minute
  await boss.schedule("heartbeat", "* * * * *", {});

  console.log("[worker] started");

  const shutdown = async () => {
    await boss.stop();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err: unknown) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
