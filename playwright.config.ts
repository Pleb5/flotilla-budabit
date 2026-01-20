import {defineConfig, devices} from "@playwright/test"

const baseURL = "http://localhost:1847"

// Storage state file path - must match auth.setup.ts
const STORAGE_STATE = "./test-results/.auth/user.json"

/**
 * Playwright configuration with multiple test projects:
 * - setup: Performs authentication and saves storage state
 * - smoke: Quick smoke tests (no auth required)
 * - identity: Identity bootstrap and persistence tests
 * - git: Git feature tests with extended timeouts
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

    // Git feature tests - extended timeouts for git operations
    {
      name: "git",
      testDir: "./tests/e2e/git",
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        // Reuse authenticated state from setup
        storageState: STORAGE_STATE,
        // Extended timeout for git operations (60 seconds per action)
        actionTimeout: 60_000,
      },
      // Extended test timeout for git operations (120 seconds per test)
      timeout: 120_000,
    },

    // Default chromium project for backward compatibility
    {
      name: "chromium",
      testIgnore: [/.*\.setup\.ts/, /git\//],
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],
})
