import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Project root: tests/integration/ is 2 levels deep
const PROJECT_ROOT = path.resolve(__dirname, "../..");

let container: StartedPostgreSqlContainer;

export async function setup() {
  container = await new PostgreSqlContainer("pgvector/pgvector:pg16")
    .withDatabase("aida_test")
    .withUsername("test")
    .withPassword("test")
    .start();

  const url = container.getConnectionUri();
  process.env.DATABASE_URL = url;

  execSync("pnpm prisma migrate deploy && pnpm prisma generate", {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
    cwd: PROJECT_ROOT,
  });
}

export async function teardown() {
  await container?.stop();
}
