import {expect, test, type Page} from "@playwright/test"
import {nip19} from "nostr-tools"
import {withRepoCommunityBinding} from "@nostr-git/core/events"
import {buildCommunityDefinition, makeCommunityPointer} from "../../src/app/core/community-protocol"
import {
  BASE_TIMESTAMP,
  TEST_PUBKEYS,
  createRepoAnnouncement,
  signTestEvent,
} from "./fixtures/events"
import {MockRelay, type MockRelayOptions, type NostrEvent} from "./helpers/mock-relay"

const community = makeCommunityPointer({
  ownerPubkey: TEST_PUBKEYS.bob,
  communityId: TEST_PUBKEYS.charlie,
  relayHints: ["wss://git-card-community.test"],
})!
const binding = {
  address: community.address,
  communityId: community.communityId,
  relay: community.relayHints[0],
}
const createCommunity = (name: string, createdAt = BASE_TIMESTAMP) =>
  signTestEvent({
    ...buildCommunityDefinition({
      communityId: community.communityId,
      name,
      relays: community.relayHints,
      sections: [{name: "Code", kinds: [{kind: 30617}], profileLists: []}],
    }),
    pubkey: community.ownerPubkey,
    created_at: createdAt,
  })

async function openCards(page: Page, options: MockRelayOptions = {}, hOnly = false) {
  const announcements = ["Community repository", "Unbound repository"].map((name, index) =>
    signTestEvent(
      (() => {
        const event = withRepoCommunityBinding(
          createRepoAnnouncement({
            identifier: `community-card-${index}`,
            name,
            description: "Repository community badge fixture.",
            pubkey: TEST_PUBKEYS.alice,
            relays: ["wss://git-card-repositories.test"],
            created_at: BASE_TIMESTAMP,
          }),
          index === 0 ? binding : undefined,
        )
        // Keep coverage of exact hints in historical announcements.
        if (index === 0 && !hOnly) event.tags.push(["a", binding.address, binding.relay])
        return event
      })(),
    ),
  )
  const relay = new MockRelay({
    ...options,
    seedEvents: [...announcements, ...(options.seedEvents || [])],
  })
  await page.addInitScript(() => localStorage.clear())
  await relay.setup(page)
  await page.route("https://**", route =>
    route.fulfill({status: 503, body: "Fixture: external services unavailable"}),
  )
  await page.goto("/git")
  await page
    .getByPlaceholder("Repo, owner, npub, or naddr")
    .fill(nip19.npubEncode(TEST_PUBKEYS.alice))
  const cards = page.getByTestId("repo-card-grid").getByTestId("repo-card")
  await expect(cards).toHaveCount(2, {timeout: 10_000})
  const card = cards.filter({has: page.getByText("Community repository", {exact: true})})
  await expect(
    cards.filter({hasText: "Unbound repository"}).getByTestId("repo-card-community-link"),
  ).toHaveCount(0)
  return {relay, card, badge: card.getByTestId("repo-card-community-link")}
}

async function cacheEvent(page: Page, event: NostrEvent) {
  await page.evaluate(async event => {
    const path = "/tests/e2e/fixtures/repository-route-identity-browser.ts"
    const fixture = await import(/* @vite-ignore */ path)
    fixture.cacheRepositoryIdentityEvent(event)
  }, event)
}

for (const viewport of [
  {name: "desktop", width: 1280, height: 900},
  {name: "mobile", width: 390, height: 844},
]) {
  test(`repo card resolves the exact community name and contains long badges (${viewport.name})`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    const pageErrors: Error[] = []
    page.on("pageerror", error => pageErrors.push(error))
    const name = "A community name longer than the repository card can display on one line"
    const definition = createCommunity(name)
    const unrelatedDefinition = signTestEvent({
      ...createCommunity("Wrong community with the same ID"),
      pubkey: TEST_PUBKEYS.alice,
    })
    const ownerProfile = signTestEvent({
      kind: 0,
      pubkey: community.ownerPubkey,
      created_at: BASE_TIMESTAMP,
      tags: [],
      content: JSON.stringify({name: "Owner profile, not the community name"}),
    })
    const {relay, card, badge} = await openCards(page, {
      seedEvents: [unrelatedDefinition, ownerProfile],
      // The correct definition is available only from the repository's community relay hint.
      seedEventsByRelay: {"wss://git-card-community.test/": [definition]},
    })
    await expect(badge).toHaveText(name)
    await expect(badge).toHaveAttribute("title", `Community: ${name}`)
    await expect(badge).toHaveAttribute("href", `/c/${community.naddr}`)
    expect(await card.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    const layout = await badge.evaluate(element => {
      const badge = element.getBoundingClientRect()
      const container = element.parentElement!.getBoundingClientRect()
      return {
        contained: badge.left >= container.left && badge.right <= container.right,
        truncated: element.scrollWidth > element.clientWidth,
      }
    })
    expect(layout).toEqual({contained: true, truncated: true})

    await cacheEvent(page, createCommunity("Renamed community", BASE_TIMESTAMP + 1))
    await expect(badge).toHaveText("Renamed community")
    await expect(badge).toHaveAttribute("title", "Community: Renamed community")
    await expect(badge).toHaveAttribute("href", `/c/${community.naddr}`)
    await badge.click()
    await expect(page).toHaveURL(`/c/${community.naddr}`)
    expect(relay.getPublishedEvents()).toEqual([])
    expect(pageErrors).toEqual([])
  })
}

test("repo card falls back until the exact community arrives and after deletion", async ({
  page,
}) => {
  const {relay, badge} = await openCards(page, {
    seedEvents: [
      signTestEvent({
        ...createCommunity("Wrong community with the same ID"),
        pubkey: TEST_PUBKEYS.alice,
      }),
    ],
  })
  const fallback = `${community.communityId.slice(0, 8)}...`
  await expect(badge).toHaveText(fallback)
  await expect(badge).toHaveAttribute("href", `/c/${community.naddr}`)

  const definition = createCommunity("Late community name")
  await cacheEvent(page, definition)
  await expect(badge).toHaveText("Late community name")

  await cacheEvent(
    page,
    signTestEvent({
      kind: 5,
      pubkey: community.ownerPubkey,
      created_at: BASE_TIMESTAMP + 1,
      tags: [["a", community.address]],
      content: "",
    }),
  )
  await expect(badge).toHaveText(fallback)
  await expect(badge).toHaveAttribute("href", `/c/${community.naddr}`)
  expect(relay.getPublishedEvents()).toEqual([])
})

test("h-only repository cards discover their community through the relay hint", async ({page}) => {
  const {relay, badge} = await openCards(
    page,
    {
      seedEventsByRelay: {"wss://git-card-community.test/": [createCommunity("BudaBit h-only")]},
    },
    true,
  )
  await expect(badge).toHaveText("BudaBit h-only")
  await expect(badge).toHaveAttribute("href", `/c/${community.naddr}`)
  expect(relay.getPublishedEvents()).toEqual([])
})

test("h-only repository cards retain an unlinked association when branches are ambiguous", async ({
  page,
}) => {
  const {relay, card, badge} = await openCards(
    page,
    {
      seedEvents: [
        createCommunity("First branch"),
        signTestEvent({
          ...createCommunity("Second branch"),
          pubkey: TEST_PUBKEYS.alice,
        }),
      ],
    },
    true,
  )
  await expect(card.getByTestId("repo-card-community-label")).toHaveText(
    `${community.communityId.slice(0, 8)}...`,
  )
  await expect(badge).toHaveCount(0)
  expect(relay.getPublishedEvents()).toEqual([])
})
