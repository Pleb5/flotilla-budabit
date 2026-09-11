import {defineConfig} from "@playwright/test"

// Requires the intended full Budabit development stack. Deliberately excludes
// global account/auth setup and unrelated artifact cleanup from the main suite.
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "extension-storage-concurrency.spec.ts",
  fullyParallel: true,
  reporter: "list",
  outputDir: process.env.BUDABIT_STORAGE_TEST_OUTPUT || "test-results/extension-storage",
  use: {
    baseURL: process.env.BUDABIT_STORAGE_TEST_URL || "http://localhost:1847",
    browserName: "chromium",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? {executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}
      : {},
  },
})
