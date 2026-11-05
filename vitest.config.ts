import path from "node:path";
import { defineConfig } from "vitest/config";

const alias = {
  "@": path.resolve(__dirname),
  // "server-only" throws outside a React Server Components bundle; tests run in plain Node.
  "server-only": path.resolve(__dirname, "tests/helpers/server-only-stub.ts"),
};

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
          setupFiles: ["tests/helpers/unit-env.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          setupFiles: ["tests/helpers/load-env.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "security",
          include: ["tests/security/**/*.test.ts"],
          environment: "node",
          setupFiles: ["tests/helpers/load-env.ts"],
          testTimeout: 30_000,
          hookTimeout: 60_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
