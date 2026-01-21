import {expect, type Page} from "@playwright/test"

export const PHASE_A_LOGIN_SCREEN = "PHASE_A_LOGIN_SCREEN"
export const PHASE_B_LOGIN_SUBMIT = "PHASE_B_LOGIN_SUBMIT"
export const PHASE_C_IDENTITY_VISIBLE = "PHASE_C_IDENTITY_VISIBLE"

export type LoginPhaseHooks = {
  changePhase?: (phase: string) => void
  recordPhaseSnapshot?: (phase: string) => void
}

export type LoginStrategy = "local-dev"

type LoginOptions = {
  phaseHooks?: LoginPhaseHooks
}

const DEV_LOGIN_TOKEN = "reviewkey"

export async function login(
  page: Page,
  strategy: LoginStrategy = "local-dev",
  options: LoginOptions = {},
): Promise<string> {
  switch (strategy) {
    case "local-dev":
      return loginWithLocalDev(page, options)
    default:
      throw new Error(`Unsupported login strategy: ${strategy}`)
  }
}

export async function loginAndAssertIdentity(page: Page, options: LoginOptions = {}): Promise<string> {
  return login(page, "local-dev", options)
}

async function loginWithLocalDev(page: Page, options: LoginOptions): Promise<string> {
  const {phaseHooks} = options

  // Wait for the app to fully initialize
  await page.waitForLoadState("networkidle")

  // Clear any cached state that might cause issues
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  // Reload to ensure clean state
  await page.reload()
  await page.waitForLoadState("networkidle")

  // Wait for SvelteKit to hydrate - look for any content that indicates the app loaded
  await page.waitForFunction(() => {
    // Check if there's any rendered content (not just the loading script)
    const body = document.body
    return body && body.innerText && body.innerText.length > 50
  }, {timeout: 30000})

  // Additional wait for app to stabilize
  await page.waitForTimeout(2000)

  phaseHooks?.changePhase?.(PHASE_A_LOGIN_SCREEN)

  // Wait for Landing component with login-screen testid
  const loginScreen = page.getByTestId("login-screen")
  await expect(loginScreen).toBeVisible({timeout: 15000})
  phaseHooks?.recordPhaseSnapshot?.(PHASE_A_LOGIN_SCREEN)

  phaseHooks?.changePhase?.(PHASE_B_LOGIN_SUBMIT)

  // Click the login button
  const loginCta = page.getByTestId("identity-cta-login")
  await expect(loginCta).toBeVisible()
  await loginCta.click()

  // Wait for login modal to appear (triggered by hash change)
  await page.waitForTimeout(500)

  const loginModal = page.getByTestId("login-modal")
  await expect(loginModal).toBeVisible({timeout: 5000})

  // Click bunker/remote signer option
  const remoteSignerOption = page.getByTestId("login-option-bunker")
  await expect(remoteSignerOption).toBeVisible()
  await remoteSignerOption.click()
  await page.waitForTimeout(500)

  // Enter dev login token in bunker input
  // The app has a dev shortcut: when bunker value === "reviewkey", it auto-logs in
  const bunkerInput = page.getByTestId("login-bunker-url")
  await expect(bunkerInput).toBeVisible({timeout: 5000})

  // Type the token character by character to ensure reactivity triggers
  await bunkerInput.clear()
  await bunkerInput.type(DEV_LOGIN_TOKEN, {delay: 50})

  // Wait for the Svelte $effect to detect "reviewkey" and trigger loginWithNip01
  await page.waitForTimeout(2000)

  phaseHooks?.recordPhaseSnapshot?.(PHASE_B_LOGIN_SUBMIT)

  // Wait for login to complete - the $effect should have called loginWithNip01
  await page.waitForTimeout(5000)

  phaseHooks?.changePhase?.(PHASE_C_IDENTITY_VISIBLE)

  // Verify logged in by checking for logged-in UI content
  // PrimaryNav uses <div> not <nav>, so we check for content that only appears when logged in
  // The desktop nav has "Settings" link which only shows when user is authenticated
  const settingsLink = page.locator('a[href="/settings/profile"]')
  await expect(settingsLink).toBeVisible({timeout: 10000})
  phaseHooks?.recordPhaseSnapshot?.(PHASE_C_IDENTITY_VISIBLE)

  return "logged-in"
}
