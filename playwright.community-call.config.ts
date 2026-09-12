import {defineConfig, devices} from "@playwright/test"

const baseURL = process.env.COMMUNITY_CALL_HOST_URL || "http://localhost:1847"

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "community-call-layout.spec.ts",
  outputDir: "./test-results/community-call-layout",
  reporter: "list",
  timeout: 60_000,
  use: {baseURL, trace: "retain-on-failure"},
  webServer:
    baseURL === "http://localhost:1847"
      ? {
          command: "pnpm dev",
          url: "http://localhost:1847",
          reuseExistingServer: true,
          timeout: 120_000,
        }
      : undefined,
  projects: [
    {name: "desktop", use: {...devices["Desktop Chrome"]}},
    {name: "mobile", use: {...devices["Pixel 7"]}},
  ],
})
