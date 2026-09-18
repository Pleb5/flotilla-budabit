import {expect, test, type Page} from "@playwright/test"
import {
  buildCommunityDefinition,
  buildTargetedPublication,
  makeCommunityPointer,
} from "../../src/app/core/community-protocol"
import {
  BASE_TIMESTAMP,
  TEST_PUBKEYS,
  createRepoAnnouncement,
  signTestEvent,
} from "./fixtures/events"
import {DEV_SECRET} from "./helpers/dev-session"
import {MockRelay, type NostrFilter} from "./helpers/mock-relay"

const viewer = TEST_PUBKEYS.devUser
const repoRelay = "wss://collection-repos.test/"
const communityRelay = "wss://collection-community.test/"
const sourceRelay = "wss://collection-originals.test/"
const community = makeCommunityPointer({
  ownerPubkey: viewer,
  communityId: TEST_PUBKEYS.charlie,
  relayHints: [communityRelay],
})!
const announcements = Array.from({length: 40}, (_, index) =>
  signTestEvent(
    createRepoAnnouncement({
      identifier: `collection-${index}`,
      name: `Collection fixture ${String(index).padStart(2, "0")}`,
      pubkey: viewer,
      relays: [repoRelay],
      created_at: BASE_TIMESTAMP + index,
    }),
  ),
)
const reaction = (index: number, pubkey = viewer) =>
  signTestEvent({
    kind: 7,
    pubkey,
    created_at: BASE_TIMESTAMP + 100,
    tags: [
      ["a", `30617:${viewer}:collection-${index}`],
      ["e", announcements[index].id],
      ["k", "30617"],
    ],
    content: "+",
  })
const personal = reaction(0)
const referenced = reaction(1, TEST_PUBKEYS.bob)
const otherMemberStar = reaction(2, TEST_PUBKEYS.bob)
const wrapper = (event: typeof referenced, pubkey = viewer) =>
  signTestEvent({
    ...buildTargetedPublication({
      id: `collection-${event.id}`,
      kind: 7,
      communities: [community],
      source: {type: "e", value: event.id, relay: sourceRelay},
    }),
    pubkey,
    created_at: BASE_TIMESTAMP + 101,
  })
const definition = signTestEvent({
  ...buildCommunityDefinition({
    communityId: community.communityId,
    name: "Collection test community",
    relays: [communityRelay],
    sections: [
      {
        name: "Stars",
        kinds: [{kind: 7}],
        profileLists: [
          {address: `30000:${viewer}:${community.communityId}-stars`, relay: communityRelay},
        ],
      },
    ],
  }),
  pubkey: viewer,
  created_at: BASE_TIMESTAMP,
})
const writers = signTestEvent({
  kind: 30000,
  pubkey: viewer,
  created_at: BASE_TIMESTAMP,
  tags: [
    ["d", `${community.communityId}-stars`],
    ["p", viewer],
    ["p", TEST_PUBKEYS.bob],
  ],
  content: "",
})

async function openFixture(
  page: Page,
  options: {communityMode?: boolean; gate?: Promise<"eose">} = {},
) {
  const requests: Array<{filters: NostrFilter[]; relay: string}> = []
  const relay = new MockRelay({
    seedEvents: [...announcements, definition, writers],
    seedEventsByRelay: {
      [repoRelay]: [personal],
      [communityRelay]: [wrapper(referenced), wrapper(otherMemberStar, TEST_PUBKEYS.bob)],
      [sourceRelay]: [referenced, otherMemberStar],
    },
    onSubscribe: (_id, filters, relay) => requests.push({filters, relay}),
    getSubscriptionOutcome: (filters, relay) =>
      options.gate &&
      relay === communityRelay &&
      filters.some(filter => filter.kinds?.includes(30222) && filter.authors?.includes(viewer))
        ? options.gate
        : "eose",
  })
  await page.addInitScript(
    ({pubkey, secret, communityMode}) => {
      localStorage.clear()
      localStorage.setItem("pubkey", JSON.stringify(pubkey))
      localStorage.setItem(
        "sessions",
        JSON.stringify({[pubkey]: {method: "nip01", secret, pubkey}}),
      )
      localStorage.setItem(
        "git:selected-mode",
        JSON.stringify(communityMode ? "community" : "personal"),
      )
      localStorage.setItem(
        "git:selected-tab",
        JSON.stringify(communityMode ? "bookmarks" : "my-repos"),
      )
    },
    {pubkey: viewer, secret: DEV_SECRET, communityMode: options.communityMode || false},
  )
  await relay.setup(page)
  await page.route("https://**", route =>
    route.fulfill({status: 503, body: "Fixture: external services unavailable"}),
  )
  await page.goto(options.communityMode ? `/git?community=${community.naddr}` : "/git")
  return {relay, requests}
}

const card = (page: Page, index: number) =>
  page.getByTestId("repo-card").filter({
    has: page.getByText(`Collection fixture ${String(index).padStart(2, "0")}`, {exact: true}),
  })
const starButton = (page: Page, index: number) =>
  card(page, index).locator("[data-collection-status]")

test("resolves unknown stars and reuses layout reads across pagination and repository navigation", async ({
  page,
}, testInfo) => {
  const errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  let release!: (outcome: "eose") => void
  const gate = new Promise<"eose">(resolve => {
    release = resolve
  })
  const {relay, requests} = await openFixture(page, {gate})
  await expect(starButton(page, 0)).toHaveAttribute("data-collection-status", "collected", {
    timeout: 15_000,
  })
  await expect
    .poll(
      () =>
        requests.filter(
          request =>
            request.relay === communityRelay &&
            request.filters.some(
              filter => filter.kinds?.includes(30222) && filter.authors?.includes(viewer),
            ),
        ).length,
    )
    .toBe(1)
  await expect(starButton(page, 2)).toHaveAttribute("data-collection-status", "indeterminate")
  release("eose")
  await expect(starButton(page, 1)).toHaveAttribute("data-collection-status", "collected")
  await expect(starButton(page, 2)).toHaveAttribute("data-collection-status", "uncollected")
  await expect(page.locator('[data-collection-status="indeterminate"]')).toHaveCount(0)
  const ownTargetReads = () =>
    requests.filter(request =>
      request.filters.some(
        filter => filter.kinds?.includes(30222) && filter.authors?.includes(viewer),
      ),
    ).length
  const ownRepoReads = () =>
    requests.filter(
      request =>
        request.relay === repoRelay &&
        request.filters.some(
          filter => filter.kinds?.includes(7) && filter.authors?.includes(viewer),
        ),
    ).length
  const baseline = {targets: ownTargetReads(), stars: ownRepoReads()}

  await page.getByRole("button", {name: "Show more repositories", exact: true}).click()
  await expect(page.getByTestId("repo-card")).toHaveCount(36)
  await page.getByRole("button", {name: "Show more repositories", exact: true}).click()
  await expect(page.getByTestId("repo-card")).toHaveCount(40)
  await expect(starButton(page, 39)).toHaveAttribute("data-collection-status", "uncollected")
  expect({targets: ownTargetReads(), stars: ownRepoReads()}).toEqual(baseline)

  await card(page, 2).getByText("Collection fixture 02", {exact: true}).click()
  await expect(page).toHaveURL(/\/git\/naddr/)
  await expect(page.locator('[data-collection-status="uncollected"]')).toHaveCount(1)
  await page.goBack()
  await expect(starButton(page, 2)).toHaveAttribute("data-collection-status", "uncollected")
  expect({targets: ownTargetReads(), stars: ownRepoReads()}).toEqual(baseline)
  await page.screenshot({path: testInfo.outputPath("resolved-stars.png")})
  expect(relay.getPublishedEvents()).toEqual([])
  expect(errors).toEqual([])
})

test("community Starred preserves other members and stargazer avatars with cold and warm caches", async ({
  page,
}) => {
  const {relay, requests} = await openFixture(page, {communityMode: true})
  await expect(card(page, 2)).toBeVisible({timeout: 15_000})
  await expect(card(page, 1)).toBeVisible()
  await expect(starButton(page, 2)).toHaveAttribute("data-collection-status", "uncollected")
  await expect(starButton(page, 1)).toHaveAttribute("data-collection-status", "collected")
  await expect(
    card(page, 2).getByRole("button", {name: "View community stargazer profile"}),
  ).toBeVisible()
  expect(
    requests.some(request =>
      request.filters.some(filter => filter.kinds?.includes(30222) && !filter.authors),
    ),
  ).toBe(true)
  await page.reload()
  await expect(starButton(page, 2)).toHaveAttribute("data-collection-status", "uncollected")
  await expect(starButton(page, 1)).toHaveAttribute("data-collection-status", "collected")
  await expect(
    card(page, 2).getByRole("button", {name: "View community stargazer profile"}),
  ).toBeVisible()
  expect(relay.getPublishedEvents()).toEqual([])
})
