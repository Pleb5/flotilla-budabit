import {expect, test} from "@playwright/test"

import {
  BASE_TIMESTAMP,
  TEST_COMMITS,
  TEST_PUBKEYS,
  createRepoAnnouncement,
  encodeRepoNaddr,
  signTestEvent,
} from "./fixtures/events"
import {MockRelay} from "./helpers/mock-relay"

const identifier = "delayed-content-availability"
const owner = "budabit-tests"
const repo = "delayed-content-availability"
const relayUrl = "wss://delayed-content-availability.test"
const readme = "# Delayed repository content"

function githubResponse(pathname: string) {
  const repoBase = `/repos/${owner}/${repo}`

  if (pathname === repoBase) return {default_branch: "main"}
  if (pathname === `${repoBase}/branches`) {
    return [{name: "main", commit: {sha: TEST_COMMITS.initial}}]
  }
  if (pathname === `${repoBase}/tags`) return []
  if (pathname === `${repoBase}/commits`) return []
  if (pathname === `${repoBase}/contents/README.md`) {
    return {
      name: "README.md",
      path: "README.md",
      type: "file",
      size: readme.length,
      sha: TEST_COMMITS.initial,
      encoding: "base64",
      content: Buffer.from(readme).toString("base64"),
    }
  }

  return null
}

test("does not flash unavailable before delayed repository content loads", async ({page}) => {
  const announcement = signTestEvent(
    createRepoAnnouncement({
      identifier,
      name: "Delayed content fixture",
      clone: [`https://github.com/${owner}/${repo}.git`],
      relays: [relayUrl],
      pubkey: TEST_PUBKEYS.alice,
      created_at: BASE_TIMESTAMP,
    }),
  )
  const mockRelay = new MockRelay({
    seedEvents: [announcement],
    responseLatencyByKind: {30617: 1_000},
  })

  await page.addInitScript(() => {
    const sightings: number[] = []
    ;(window as any).__repoUnavailableSightings = sightings
    new MutationObserver(() => {
      if (document.body?.textContent?.includes("Repository content unavailable")) {
        sightings.push(performance.now())
      }
    }).observe(document, {subtree: true, childList: true, characterData: true})
  })
  await mockRelay.setup(page)
  await page.route(`https://github.com/${owner}/${repo}.git**`, route => route.abort("failed"))
  await page.route(`https://corsproxy.budabit.club/github.com/${owner}/${repo}.git**`, route =>
    route.abort("failed"),
  )
  await page.route(`https://api.github.com/repos/${owner}/${repo}**`, route => {
    const response = githubResponse(new URL(route.request().url()).pathname)
    return route.fulfill({
      status: response ? 200 : 404,
      contentType: "application/json",
      body: JSON.stringify(response ?? {message: "Not found"}),
    })
  })

  const naddr = encodeRepoNaddr(TEST_PUBKEYS.alice, identifier, [relayUrl])
  await page.goto(`/git/${naddr}`)

  await expect(page.getByRole("heading", {name: "Delayed repository content"})).toBeVisible({
    timeout: 30_000,
  })
  expect(await page.evaluate(() => (window as any).__repoUnavailableSightings as number[])).toEqual(
    [],
  )
})
