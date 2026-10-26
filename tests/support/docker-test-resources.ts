// Postgres test containers that follow run charter rule J (run decisions K109 and K110 in
// .planning/run-loop/J1-RENCANA.md). Every Testcontainers caller in this repo starts its
// database through startLabeledPostgres().
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { recordResource, testLabels, testResourceName, testRunId } from "./docker-test-labels";

// Ryuk, the Testcontainers reaper, is itself a container without the rule J label and name, so
// it is off in every process that imports this module (K110). Testcontainers reads the variable
// when it first creates the reaper (testcontainers/build/reaper/reaper.js), so setting it here,
// before any container starts, is enough. Each caller stops its container in teardown;
// scripts/test-docker-cleanup.ts removes what a crashed run leaves behind.
process.env.TESTCONTAINERS_RYUK_DISABLED = "true";

export const POSTGRES_TEST_IMAGE = "pgvector/pgvector:pg16";

// The image declares `VOLUME /var/lib/postgresql/data`. Without a mount there, Docker creates an
// anonymous volume with no label for every container. A tmpfs mount takes its place (K109).
const POSTGRES_DATA_DIR = "/var/lib/postgresql/data";

export interface LabeledPostgresOptions {
  /** Short lowercase word for the container name, e.g. "integration". */
  kind: string;
  database: string;
  username: string;
  password: string;
}

export function labeledPostgres(options: LabeledPostgresOptions): PostgreSqlContainer {
  const runId = testRunId();
  const name = testResourceName(options.kind, runId);
  recordResource(runId, { type: "container", name, state: "planned" });
  return new PostgreSqlContainer(POSTGRES_TEST_IMAGE)
    .withName(name)
    .withLabels(testLabels(runId))
    .withTmpFs({ [POSTGRES_DATA_DIR]: "rw" })
    .withDatabase(options.database)
    .withUsername(options.username)
    .withPassword(options.password);
}

export async function startLabeledPostgres(
  options: LabeledPostgresOptions,
): Promise<StartedPostgreSqlContainer> {
  const started = await labeledPostgres(options).start();
  recordResource(testRunId(), {
    type: "container",
    name: started.getName().replace(/^\//, ""),
    id: started.getId(),
    state: "created",
  });
  return started;
}
