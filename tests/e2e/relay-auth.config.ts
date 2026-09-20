import {defineConfig} from "@playwright/test"

// Disposable identities and intercepted relay traffic; no saved user sessions.
// Requires the full pnpm dev stack on the intended checkout.
export default defineConfig({
  testDir: ".",
  testMatch: ["git-collection-state.spec.ts", "private-community.spec.ts"],
  outputDir: process.env.RELAY_AUTH_TEST_OUTPUT || "../../test-results/relay-auth",
  reporter: "list",
  timeout: 60_000,
  expect: {timeout: 15_000},
  use: {
    baseURL: process.env.PRIVATE_TEST_BASE_URL || "http://localhost:1847",
    browserName: "chromium",
    trace: "off",
    screenshot: "only-on-failure",
  },
})
