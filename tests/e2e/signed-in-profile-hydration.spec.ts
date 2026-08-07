import {expect, test} from "@playwright/test"
import {finalizeEvent, getPublicKey} from "nostr-tools"
import {DEV_PUBKEY, seedDevSession} from "./helpers/dev-session"
import {MockRelay, type NostrFilter} from "./helpers/mock-relay"

type PhysicalRequest = {
  relayUrl: string
  filters: NostrFilter[]
}

const communitySecret = Uint8Array.from({length: 32}, (_, index) => index + 1)
const listSecret = Uint8Array.from({length: 32}, (_, index) => index + 33)
const communityPubkey = getPublicKey(communitySecret)
const listPubkey = getPublicKey(listSecret)
const discoveryRelay = "wss://profile-hydration-discovery.example/"
const initialCommunityRelays = Array.from(
  {length: 6},
  (_, index) => `wss://profile-hydration-${index + 1}.example/`,
)
const updatedCommunityRelays = [
  "wss://profile-hydration-updated.example/",
  "wss://profile-hydration-updated-fallback.example/",
]
const profileListAddress = `30000:${listPubkey}:General`

const makeDefinition = (createdAt: number, relays: string[]) =>
  finalizeEvent(
    {
      kind: 10222,
      created_at: createdAt,
      content: "",
      tags: [
        ["alt", "BudaBit community definition"],
        ...relays.map(relay => ["r", relay]),
        ["content", "General"],
        ["k", "1111"],
        ["a", profileListAddress, discoveryRelay],
      ],
    },
    communitySecret,
  )

const membership = finalizeEvent(
  {
    kind: 30000,
    created_at: 1,
    content: "",
    tags: [
      ["d", "General"],
      ["p", DEV_PUBKEY],
    ],
  },
  listSecret,
)

const isExactProfileFilter = (filter: NostrFilter, author: string) =>
  JSON.stringify(filter) === JSON.stringify({kinds: [0], authors: [author], limit: 1})

test("bounds signed-in kind-0 hydration to one physical community-relay attempt", async ({
  page,
}) => {
  const requests: PhysicalRequest[] = []
  const mockRelay = new MockRelay({
    seedEvents: [makeDefinition(1, initialCommunityRelays), membership],
    responseLatencyByKind: {10222: 500, 30000: 500},
    onSubscribe: (_subscriptionId, filters, relayUrl) => {
      requests.push({relayUrl, filters})
    },
  })

  await seedDevSession(page)
  await page.addInitScript(
    ({communityPubkey, relay}) => {
      localStorage.setItem(
        "budabit/community-session",
        JSON.stringify({communityPubkey, communityRelayHints: [relay]}),
      )
    },
    {communityPubkey, relay: discoveryRelay},
  )
  await mockRelay.setup(page)
  await page.goto("/explore")

  await expect
    .poll(() =>
      requests.some(request =>
        request.filters.some(
          filter => filter.kinds?.includes(30000) && filter["#p"]?.includes(DEV_PUBKEY),
        ),
      ),
    )
    .toBe(true)

  await expect(page.getByText("Member", {exact: true})).toBeVisible({timeout: 15_000})
  await expect
    .poll(
      () =>
        requests
          .filter(request => initialCommunityRelays.includes(request.relayUrl))
          .filter(request =>
            request.filters.some(filter => isExactProfileFilter(filter, DEV_PUBKEY)),
          ).length,
      {timeout: 10_000},
    )
    .toBeGreaterThan(0)

  const signedInProfileRequests = requests
    .filter(request => initialCommunityRelays.includes(request.relayUrl))
    .filter(request => request.filters.some(filter => isExactProfileFilter(filter, DEV_PUBKEY)))
  const destinations = new Set(signedInProfileRequests.map(request => request.relayUrl))

  expect(destinations.size).toBeGreaterThan(0)
  expect(destinations.size).toBeLessThanOrEqual(4)
  expect([...destinations].every(relay => initialCommunityRelays.includes(relay))).toBe(true)
  expect(signedInProfileRequests).toHaveLength(destinations.size)
  for (const request of signedInProfileRequests) {
    expect(request.filters).toEqual([{kinds: [0], authors: [DEV_PUBKEY], limit: 1}])
  }

  const initialRequestCount = signedInProfileRequests.length
  await mockRelay.injectEvents([makeDefinition(2, updatedCommunityRelays), membership])

  await expect
    .poll(
      () =>
        requests.some(
          request =>
            request.relayUrl === updatedCommunityRelays[0] &&
            request.filters.some(filter => isExactProfileFilter(filter, communityPubkey)),
        ),
      {timeout: 10_000},
    )
    .toBe(true)

  expect(
    requests
      .filter(request =>
        [...initialCommunityRelays, ...updatedCommunityRelays].includes(request.relayUrl),
      )
      .filter(request => request.filters.some(filter => isExactProfileFilter(filter, DEV_PUBKEY))),
  ).toHaveLength(initialRequestCount)
})
