// ---------------------------------------------------------------------------
// scripts/check-database-url.ts: the migrate service's pre-step (Phase 9, D-12(4), AIDA-35).
//
// Runs the same guard as the app (src/instrumentation.ts) and the worker before
// `prisma migrate deploy`: compose passes the POSTGRES_* values as AIDA_EXPECT_DB_*, and a
// DATABASE_URL whose decoded user, password or database differs, or that does not parse, stops
// migrate with exit 1 and one fixed line naming the component, never a value. Inactive (exit 0)
// when AIDA_EXPECT_DB_PASSWORD is empty. Prints nothing on success.
//
// docker-compose.yml calls it through node, as the builder stage's non-root `node` user, with no
// registry or network access:
//   node node_modules/tsx/dist/cli.mjs scripts/check-database-url.ts
// ---------------------------------------------------------------------------
import { checkDatabaseUrlConsistency, DatabaseUrlMismatchError } from "../src/lib/db-url";

const result = checkDatabaseUrlConsistency(process.env);
if (!result.ok) {
  console.error(`[migrate] ${new DatabaseUrlMismatchError(result.component).message}`);
  process.exit(1);
}
