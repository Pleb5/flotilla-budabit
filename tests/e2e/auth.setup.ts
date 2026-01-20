import {test as setup, expect} from "@playwright/test"
import {loginAndAssertIdentity} from "./helpers/auth"

/**
 * Authentication Setup for E2E Tests
 *
 * This setup project runs once before all other test projects,
 * authenticating a user and saving the browser state to a file.
 * Other test projects can then reuse this authenticated state,
 * avoiding the need to log in for each test.
 *
 * Usage in playwright.config.ts:
 * ```typescript
 * projects: [
 *   { name: 'setup', testMatch: /auth\.setup\.ts/ },
 *   {
 *     name: 'chromium',
 *     use: { storageState: STORAGE_STATE },
 *     dependencies: ['setup'],
 *   },
 * ]
 * ```
 */

// Storage state file path - exported for use in playwright.config.ts
export const STORAGE_STATE = "./test-results/.auth/user.json"

setup.describe("authentication setup", () => {
  setup("authenticate and save state", async ({page}) => {
    // Navigate to the app's home page
    await page.goto("/")

    // Perform login using the dev login flow
    const identityText = await loginAndAssertIdentity(page)

    // Verify we got a valid identity
    expect(identityText).toContain("npub")

    // Wait for the app to stabilize after login
    // This ensures all localStorage/sessionStorage/indexedDB writes complete
    await page.waitForTimeout(1000)

    // Verify the user is still logged in
    const identityStatus = page.getByTestId("identity-status")
    await expect(identityStatus).toBeVisible()
    await expect(identityStatus).toContainText("npub")

    // Save the authenticated state
    // This includes cookies, localStorage, and sessionStorage
    await page.context().storageState({path: STORAGE_STATE})

    console.log(`Auth state saved to ${STORAGE_STATE}`)
  })
})
