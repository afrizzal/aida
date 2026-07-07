import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";

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

  // src/lib/crypto/secret-box.ts requires this at rest-encryption key even outside a real
  // deployment; the main vitest process doesn't load .env (only prisma.config.ts's own
  // `dotenv/config` import does, and only inside the execSync child process below), so any
  // integration test that touches encrypted Settings (email/llm) needs a key here too.
  if (!process.env.APP_ENCRYPTION_KEY) {
    process.env.APP_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  }

  execSync("pnpm prisma migrate deploy && pnpm prisma generate", {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
    cwd: PROJECT_ROOT,
  });
}

export async function teardown() {
  await container?.stop();
}
