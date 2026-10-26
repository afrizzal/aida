import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    // The egress suite builds images and runs only through `pnpm test:egress` (K113).
    exclude: [...configDefaults.exclude, "tests/integration/egress-isolation.test.ts"],
    globalSetup: "./tests/integration/global-setup.ts",
    hookTimeout: 120_000,
    testTimeout: 60_000,
    fileParallelism: false,
  },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
