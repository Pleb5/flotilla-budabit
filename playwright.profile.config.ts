import {defineConfig, devices} from "@playwright/test"

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /profile-(identity|publication)\.spec\.ts/,
  outputDir: "./test-results/profile-identity",
  reporter: [["list"]],
  use: {baseURL: "http://localhost:1847", ...devices["Desktop Chrome"]},
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:1847",
    reuseExistingServer: true,
    timeout: 120000,
  },
})
