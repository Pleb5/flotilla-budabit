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

  phaseHooks?.changePhase?.(PHASE_A_LOGIN_SCREEN)
  const loginScreen = page.getByTestId("login-screen")
  await expect(loginScreen).toBeVisible()
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

  await expect(loginModal).toBeHidden()

  phaseHooks?.changePhase?.(PHASE_C_IDENTITY_VISIBLE)
  const identityStatus = page.getByTestId("identity-status")
  await expect(identityStatus).toBeVisible()
  const identityText = (await identityStatus.innerText()).trim()
  await expect(identityStatus).toContainText("npub")
  phaseHooks?.recordPhaseSnapshot?.(PHASE_C_IDENTITY_VISIBLE)

  return identityText
}
