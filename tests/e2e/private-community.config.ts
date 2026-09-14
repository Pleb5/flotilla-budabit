import {defineConfig} from "@playwright/test"

// Isolated cold contexts, no saved account, no setup that deletes other runs.
export default defineConfig({
  testDir: ".",
  testMatch: "private-community.spec.ts",
  outputDir: process.env.PRIVATE_TEST_OUTPUT || "../../test-results/private-community",
  reporter: "list",
  timeout: 45000,
  use: {
    baseURL: "http://localhost:1847",
    browserName: "chromium",
    trace: "off",
    screenshot: "only-on-failure",
  },
})
