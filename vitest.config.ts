import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const alias = {
  "@": fileURLToPath(new URL("./src", import.meta.url)),
  "server-only": fileURLToPath(new URL("./tests/support/server-only.ts", import.meta.url)),
};

export default defineConfig({
  test: {
    projects: [
      { resolve: { alias }, test: { name: "unit", include: ["tests/unit/**/*.test.ts"] } },
      { resolve: { alias }, test: {
        name: "integration",
        include: ["tests/integration/**/*.test.ts"],
        globalSetup: ["./tests/support/postgres-setup.ts"],
        fileParallelism: false,
        testTimeout: 20_000,
        hookTimeout: 60_000,
      } },
    ],
  },
});
