// Prisma config ONLY for tests/integration/ticket-states-deploy.test.ts (review C2); never for a
// real database. The schema path, the migrations directory and the datasource URL all come from the
// environment, so the real `prisma migrate deploy` can deploy a copy of the migrations up to a given
// folder into a test database of the harness container. The test passes absolute paths in
// AIDA_TEST_SCHEMA and AIDA_TEST_MIGRATIONS_DIR, so no relative-path rule of the config loader is
// relied on, and it sets DATABASE_URL to its own test database.
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: env("AIDA_TEST_SCHEMA"),
  migrations: { path: env("AIDA_TEST_MIGRATIONS_DIR") },
  datasource: { url: env("DATABASE_URL") },
});
