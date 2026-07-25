import {defineConfig, devices} from "@playwright/test"

const baseURL = "http://localhost:1848"
const webServerCommand = process.env.ATOMIC_REUSE_BUILDS
  ? "node tests/atomic-app-updates/static-server.mjs"
  : "node tests/atomic-app-updates/prepare-builds.mjs && node tests/atomic-app-updates/static-server.mjs"

export default defineConfig({
  testDir: "./tests/atomic-app-updates",
  testMatch: "**/*.e2e.ts",
  outputDir: "./test-results/playwright-atomic",
  reporter: [["html", {outputFolder: "playwright-report/atomic", open: "never"}]],
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: {timeout: 45_000},
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    command: webServerCommand,
    url: `${baseURL}/__atomic/state`,
    reuseExistingServer: false,
    timeout: 300_000,
  },
})
