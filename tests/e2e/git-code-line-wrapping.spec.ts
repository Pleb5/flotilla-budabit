import {expect, test} from "@playwright/test"

import {
  BASE_TIMESTAMP,
  TEST_COMMITS,
  TEST_PUBKEYS,
  createRepoAnnouncement,
  createRepoState,
  encodeRepoNaddr,
  signTestEvent,
} from "./fixtures/events"
import {MockRelay} from "./helpers/mock-relay"

const identifier = "line-wrapping-fixture"
const owner = "budabit-tests"
const repo = "line-wrapping-fixture"
const relayUrl = "wss://line-wrapping.test"
const filename = "wrapped-lines.txt"
const longLine = Array.from({length: 80}, (_, index) => `segment-${index}`).join(" ")
const fileContent = [
  "first logical line",
  longLine,
  "third logical line",
  "fourth logical line",
].join("\n")

function githubResponse(pathname: string) {
  const repoBase = `/repos/${owner}/${repo}`

  if (pathname === repoBase) return {default_branch: "main"}
  if (pathname === `${repoBase}/branches`) {
    return [{name: "main", commit: {sha: TEST_COMMITS.initial}}]
  }
  if (pathname === `${repoBase}/tags`) return []
  if (pathname === `${repoBase}/contents/`) {
    return [
      {
        name: filename,
        path: filename,
        type: "file",
        size: fileContent.length,
        sha: TEST_COMMITS.initial,
      },
    ]
  }
  if (pathname === `${repoBase}/contents/${filename}`) {
    return {
      name: filename,
      path: filename,
      type: "file",
      size: fileContent.length,
      sha: TEST_COMMITS.initial,
      encoding: "base64",
      content: Buffer.from(fileContent).toString("base64"),
    }
  }

  return null
}

test("wraps code without changing logical selection across responsive layouts", async ({page}) => {
  test.setTimeout(90_000)

  const announcement = signTestEvent(
    createRepoAnnouncement({
      identifier,
      name: "Line wrapping fixture",
      clone: [`https://github.com/${owner}/${repo}.git`],
      relays: [relayUrl],
      pubkey: TEST_PUBKEYS.alice,
      created_at: BASE_TIMESTAMP,
    }),
  )
  const state = signTestEvent(
    createRepoState({
      identifier,
      refs: [{type: "heads", name: "main", commit: TEST_COMMITS.initial}],
      head: "main",
      pubkey: TEST_PUBKEYS.alice,
      created_at: BASE_TIMESTAMP + 1,
    }),
  )
  const mockRelay = new MockRelay({seedEvents: [announcement, state]})

  await mockRelay.setup(page)
  await page.route(`https://api.github.com/repos/${owner}/${repo}**`, async route => {
    const response = githubResponse(new URL(route.request().url()).pathname)
    await route.fulfill({
      status: response ? 200 : 404,
      contentType: "application/json",
      body: JSON.stringify(response ?? {message: "Not found"}),
    })
  })

  const naddr = encodeRepoNaddr(TEST_PUBKEYS.alice, identifier, [relayUrl])
  await page.goto(`/git/${naddr}/code?path=${encodeURIComponent(filename)}`)

  const editor = page.locator(".file-view .cm-editor")
  const content = editor.locator(".cm-content")
  const scroller = editor.locator(".cm-scroller")
  const wrapButton = page.getByRole("button", {name: "Enable line wrapping"})

  await page.getByRole("button", {name: filename}).click()
  await expect(editor).toBeVisible({timeout: 30_000})
  await expect(wrapButton).toHaveAttribute("aria-pressed", "false")
  await expect(content).not.toHaveClass(/cm-lineWrapping/)
  await expect
    .poll(() => scroller.evaluate(element => element.scrollWidth > element.clientWidth))
    .toBe(true)

  await wrapButton.click()

  await expect(page.getByRole("button", {name: "Disable line wrapping"})).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  await expect(content).toHaveClass(/cm-lineWrapping/)
  await expect
    .poll(() => scroller.evaluate(element => element.scrollWidth <= element.clientWidth + 1))
    .toBe(true)

  const lines = content.locator(".cm-line")
  await expect(lines).toHaveCount(4)
  const lineMetrics = await lines.nth(1).evaluate(element => {
    const styles = getComputedStyle(element)
    return {
      height: element.getBoundingClientRect().height,
      lineHeight: Number.parseFloat(styles.lineHeight),
    }
  })
  expect(lineMetrics.height).toBeGreaterThan(lineMetrics.lineHeight * 2)

  const secondLine = await lines.nth(1).boundingBox()
  const thirdLine = await lines.nth(2).boundingBox()
  expect(secondLine).not.toBeNull()
  expect(thirdLine).not.toBeNull()
  if (!secondLine || !thirdLine) throw new Error("Expected wrapped lines to have layout boxes")

  await page.mouse.move(
    secondLine.x + 24,
    secondLine.y + Math.min(lineMetrics.lineHeight * 1.5, secondLine.height - 2),
  )
  await page.mouse.down()
  await page.mouse.move(thirdLine.x + 24, thirdLine.y + thirdLine.height / 2, {steps: 4})
  await page.mouse.up()

  await expect.poll(() => new URL(page.url()).hash).toBe("#L2-L3")
  await expect(
    editor.locator('.cm-lineNumbers .cm-selected-gutter:not([aria-hidden="true"])'),
  ).toHaveText(["2", "3"])

  await page.getByRole("button", {name: "Disable line wrapping"}).click()
  await expect(content).not.toHaveClass(/cm-lineWrapping/)
  await expect.poll(() => new URL(page.url()).hash).toBe("#L2-L3")
  await page.getByRole("button", {name: "Enable line wrapping"}).click()

  await page.setViewportSize({width: 700, height: 800})
  await expect(page.getByRole("button", {name: "Disable line wrapping"})).toBeVisible()
  await expect
    .poll(() =>
      page
        .locator('.file-view > [role="group"]')
        .evaluate(element => element.scrollWidth <= element.clientWidth + 1),
    )
    .toBe(true)

  await page.setViewportSize({width: 375, height: 800})
  await expect(page.getByTitle("File actions")).toBeVisible()
  await page.getByTitle("File actions").click()
  const mobileWrapAction = page.getByRole("button", {name: "Unwrap lines"})
  await expect(mobileWrapAction).toHaveAttribute("aria-pressed", "true")
  await expect(page.locator(".file-view .cm-content")).toHaveClass(/cm-lineWrapping/)

  await mobileWrapAction.click()
  await expect(page.locator(".file-view .cm-content")).not.toHaveClass(/cm-lineWrapping/)

  await page.setViewportSize({width: 1024, height: 800})
  await expect(page.getByRole("button", {name: "Enable line wrapping"})).toHaveAttribute(
    "aria-pressed",
    "false",
  )
  await expect(page.locator(".file-view .cm-content")).not.toHaveClass(/cm-lineWrapping/)
})
