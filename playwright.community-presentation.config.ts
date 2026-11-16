import {defineConfig, devices} from "@playwright/test"

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "community-presentation.spec.ts",
  use: {baseURL: "http://localhost:5188", trace: "retain-on-failure"},
  webServer: {
    command: "node ../budabit-community-stream/tests/server.mjs",
    url: "http://localhost:5188/tests/player.html",
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {name: "desktop", use: {...devices["Desktop Chrome"]}},
    {name: "mobile", use: {...devices["Pixel 7"]}},
  ],
})
