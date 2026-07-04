import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, "../.auth/env.json");

const raw = JSON.parse(fs.readFileSync(envPath, "utf-8")) as {
  databaseUrl: string;
  orgId: string;
  baseURL: string;
};

// Must be the first import wherever `@/lib/db` gets pulled in transitively (e.g. via
// support/db.ts -> src/lib/tickets/create-ticket): src/lib/db.ts reads DATABASE_URL from
// process.env at module-load time, so this side effect has to run before that import
// evaluates or seeding would silently hit whatever DB is ambient in the shell.
process.env.DATABASE_URL = raw.databaseUrl;

export const databaseUrl = raw.databaseUrl;
export const orgId = raw.orgId;
export const baseURL = raw.baseURL;
