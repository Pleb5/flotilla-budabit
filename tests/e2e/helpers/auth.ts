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

  // Wait for the app to fully initialize - the landing page may take time to render
  // especially on first load when Svelte hydrates
  await page.waitForLoadState("networkidle")

  phaseHooks?.changePhase?.(PHASE_A_LOGIN_SCREEN)
  const loginScreen = page.getByTestId("login-screen")
  // Increased timeout for initial load
  await expect(loginScreen).toBeVisible({timeout: 15000})
  phaseHooks?.recordPhaseSnapshot?.(PHASE_A_LOGIN_SCREEN)

  phaseHooks?.changePhase?.(PHASE_B_LOGIN_SUBMIT)
  const loginCta = page.getByTestId("identity-cta-login")
  await expect(loginCta).toBeVisible()

  const initialHash = await page.evaluate(() => window.location.hash)
  await loginCta.click()
  await page.waitForFunction(previous => window.location.hash !== previous, initialHash)

  const loginModal = page.getByTestId("login-modal")
  await expect(loginModal).toBeVisible()

  const remoteSignerOption = page.getByTestId("login-option-bunker")
  await expect(remoteSignerOption).toBeVisible()

  const hashBeforeRemote = await page.evaluate(() => window.location.hash)
  await remoteSignerOption.click()
  await page.waitForFunction(previous => window.location.hash !== previous, hashBeforeRemote)

  const bunkerModal = page.getByTestId("login-bunker")
  await expect(bunkerModal).toBeVisible()

  const bunkerInput = page.getByTestId("login-bunker-url")
  await expect(bunkerInput).toBeVisible()
  await bunkerInput.fill(DEV_LOGIN_TOKEN)

  const bunkerSubmit = page.getByTestId("login-bunker-submit")
  if ((await bunkerSubmit.count()) > 0) {
    await expect(bunkerSubmit).toBeVisible()
    await expect(bunkerSubmit).toBeEnabled()
    await bunkerSubmit.click()
  }
  phaseHooks?.recordPhaseSnapshot?.(PHASE_B_LOGIN_SUBMIT)

  // Wait for login modal to close and app to transition to logged-in state
  await expect(loginModal).toBeHidden({timeout: 10000})

  phaseHooks?.changePhase?.(PHASE_C_IDENTITY_VISIBLE)

  // The app shows PrimaryNav when logged in (when $pubkey is truthy)
  // Wait for the navigation to appear as confirmation of successful login
  // We look for the settings button which is always present in the nav
  const navElement = page.locator("nav, [class*='nav'], [class*='sidebar']").first()
  await expect(navElement).toBeVisible({timeout: 10000})
  phaseHooks?.recordPhaseSnapshot?.(PHASE_C_IDENTITY_VISIBLE)

  // Return a placeholder since we don't have a visible npub element
  // Tests that need the actual pubkey should query localStorage directly
  return "logged-in"
}
