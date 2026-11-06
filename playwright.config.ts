import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/setup.ts",
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: { browserName: "chromium", viewport: { width: 1280, height: 800 }, trace: "retain-on-failure" },
});
