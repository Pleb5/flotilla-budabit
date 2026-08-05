import {devices, expect, test} from "@playwright/test"
import {MockRelay} from "./helpers/mock-relay"

test.use({...devices["Pixel 5"]})

test.describe("NIP-46 login", () => {
  test("shows nostrconnect first and keeps bunker links as the fallback", async ({page}) => {
    const relay = new MockRelay()
    await relay.setup(page)
    await page.goto("/")

    const login = page
      .getByTestId("identity-cta-login")
      .or(page.getByRole("button", {name: "Log in", exact: true}))
    await expect(login).toBeVisible({timeout: 15_000})
    await login.click()
    await expect(page.getByTestId("login-modal")).toBeVisible()
    await expect(page.getByTestId("login-option-signup")).toBeVisible()
    await page.getByTestId("login-option-bunker").click()

    const fallback = page.getByTestId("login-bunker-fallback")
    const openSigner = page.getByTestId("login-bunker-open-signer")
    await expect(fallback).toBeVisible()
    await expect(page.getByTestId("login-bunker-url")).not.toBeVisible()
    await expect(openSigner).toBeVisible()
    await expect(openSigner).toHaveAttribute("href", /^nostrconnect:\/\//)

    await fallback.click()
    await expect(page.getByTestId("login-bunker-url")).toBeVisible()
    await expect(page.getByTestId("login-bunker-submit")).toBeVisible()

    await page.getByRole("button", {name: "Go back"}).click()
    await expect(fallback).toBeVisible()
    await expect(page.getByTestId("login-bunker-url")).not.toBeVisible()
  })
})
