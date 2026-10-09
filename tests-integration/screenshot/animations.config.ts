import { defineConfig } from "@playwright/test";

export default defineConfig({
  timeout: 120_000,
  workers: 1,
  fullyParallel: false,
  expect: {
    timeout: 10_000,
  },
  globalSetup: "../global-setup",
  testMatch: "animations.test.ts",
});
