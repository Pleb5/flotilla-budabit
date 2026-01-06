import {defineConfig, devices} from "@playwright/test"

const baseURL = "http://localhost:1847"

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./test-results/playwright",
  reporter: [["html", {outputFolder: "playwright-report", open: "never"}]],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    command: "pnpm dev -- --host localhost --port 1847",
    url: baseURL,
    reuseExistingServer: process.env.CI ? false : true,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],
})