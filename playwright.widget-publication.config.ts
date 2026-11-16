import {defineConfig, devices} from "@playwright/test"

// Isolated focused checks; no shared auth setup or stale-artifact cleanup.
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch:
    /(widget-visibility|community-classifieds-messaging|community-freelance-quicklink)\.spec\.ts/,
  outputDir: "./test-results/widget-publication",
  reporter: "list",
  use: {baseURL: "http://localhost:1847", trace: "retain-on-failure"},
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:1847",
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [{name: "chromium", use: devices["Desktop Chrome"]}],
})
