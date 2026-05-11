import {defineConfig, devices} from "@playwright/test"

const baseURL = "http://localhost:1847"

// Storage state file path - must match auth.setup.ts
const STORAGE_STATE = "./test-results/.auth/user.json"

/**
 * Playwright configuration with multiple test projects:
 * - setup: Performs authentication and saves storage state
 * - smoke: Quick smoke tests (no auth required)
 * - identity: Identity bootstrap and persistence tests
 */
export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./test-results/playwright",
  reporter: [["html", {outputFolder: "playwright-report", open: "never"}]],

  // Global setup and teardown
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",

  // Global defaults
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
    // Setup project - performs authentication and saves state
    {
      name: "setup",
      testMatch: /.*\.setup\.ts/,
      use: {
        ...devices["Desktop Chrome"],
      },
    },

    // Smoke tests - basic app functionality, no auth required
    {
      name: "smoke",
      testMatch: /smoke\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
      },
    },

    // Identity tests - bootstrap and persistence
    {
      name: "identity",
      testMatch: /identity\..*\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
      },
    },

    // Widget tests - require auth to access /settings/extensions
    {
      name: "widget",
      testMatch: /widget-(acceptance|interop)\.spec\.ts/,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        storageState: STORAGE_STATE,
      },
    },

    // Default chromium project for backward compatibility
    {
      name: "chromium",
      testIgnore: [/.*\.setup\.ts/, /widget-(acceptance|interop)\.spec\.ts/],
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],
})
