import {defineConfig} from "@playwright/test"

// Controlled relay/signer fixtures; no saved account or shared setup/teardown.
export default defineConfig({
  testDir: ".",
  testMatch: "private-community.spec.ts",
  outputDir: process.env.PRIVATE_TEST_OUTPUT || "../../test-results/private-community",
  reporter: "list",
  timeout: 60000,
  expect: {timeout: 15000},
  use: {
    baseURL: process.env.PRIVATE_TEST_BASE_URL || "http://localhost:1847",
    browserName: "chromium",
    trace: "off",
    screenshot: "only-on-failure",
  },
})
