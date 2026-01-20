import {test as setup, expect} from "@playwright/test"
import {loginAndAssertIdentity} from "./helpers/auth"

/**
 * Authentication Setup for E2E Tests
 *
 * This setup project runs once before all other test projects,
 * authenticating a user and saving the browser state to a file.
 * Other test projects can then reuse this authenticated state,
 * avoiding the need to log in for each test.
 */

// Storage state file path - must match playwright.config.ts
const STORAGE_STATE = "./test-results/.auth/user.json"

setup("authenticate and save state", async ({page}) => {
  // Navigate to the app's home page
  await page.goto("/")

  // Perform login using the dev login flow
  await loginAndAssertIdentity(page)

  // Wait for the app to stabilize after login
  // This ensures all localStorage/sessionStorage/indexedDB writes complete
  await page.waitForTimeout(2000)

  // Verify login succeeded by checking localStorage for pubkey
  const pubkey = await page.evaluate(() => {
    // Check various storage keys that might contain the pubkey
    return (
      localStorage.getItem("pubkey") ||
      localStorage.getItem("welshman:pubkey") ||
      sessionStorage.getItem("pubkey") ||
      "unknown"
    )
  })
  console.log(`Logged in with pubkey: ${pubkey}`)

  // Save the authenticated state
  // This includes cookies, localStorage, and sessionStorage
  await page.context().storageState({path: STORAGE_STATE})

  console.log(`Auth state saved to ${STORAGE_STATE}`)
})
