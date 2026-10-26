import {defineConfig} from "@playwright/test"

export default defineConfig({
  testDir: "./e2e",
  testMatch: "featured-calendar-protocol.spec.ts",
  workers: 1,
  reporter: "list",
  outputDir: "../test-results/featured-calendar",
  use: {
    headless: true,
    launchOptions: {executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium"},
  },
})
