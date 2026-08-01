import { defineConfig } from "vitest/config";

// Separate from vitest.integration.config.ts on purpose: this suite manages its OWN Postgres
// (via docker-compose.egress-test.yml, not Testcontainers) and needs a MUCH longer budget —
// building the production image plus five real AI/email flows running end to end. Slow by
// design (07-09.1-PLAN.md: "This suite may be slow; it does not need to run on the PR path").
export default defineConfig({
  test: {
    include: ["tests/integration/egress-isolation.test.ts"],
    hookTimeout: 600_000,
    testTimeout: 300_000,
    fileParallelism: false,
  },
});
