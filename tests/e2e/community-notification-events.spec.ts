import {expect, test, type Page} from "@playwright/test"
import {finalizeEvent, getPublicKey, nip19} from "nostr-tools"
import {DEV_PUBKEY, DEV_SECRET, seedDevSession} from "./helpers/dev-session"
import {MockRelay} from "./helpers/mock-relay"

const ownerSecret = new Uint8Array(32).fill(12)
const owner = getPublicKey(ownerSecret)
const otherSecret = new Uint8Array(32).fill(13)
const other = getPublicKey(otherSecret)
const communityId = getPublicKey(new Uint8Array(32).fill(14))
const relayUrl = "wss://community-notification-events.example"
const createdAt = Math.floor(Date.now() / 1000)
const communityAddress = `32222:${owner}:${communityId}`
const listIdentifier = `${communityId}-general`
const listAddress = `30000:${owner}:${listIdentifier}`
const authorityTags = [
  ["h", communityId],
  ["a", communityAddress, relayUrl, "community"],
]
const definition = finalizeEvent(
  {
    kind: 32222,
    created_at: createdAt - 100,
    content: "",
    tags: [
      ["d", communityId],
      ["name", "Notification Events Community"],
      ["r", relayUrl],
      ["content", "General"],
      ["k", "1111"],
      ["k", "7"],
      ["k", "1984"],
      ["k", "1985"],
      ["a", listAddress, relayUrl],
    ],
  },
  ownerSecret,
)
const profileList = (timestamp: number, members: string[]) =>
  finalizeEvent(
    {
      kind: 30000,
      created_at: timestamp,
      content: "",
      tags: [["d", listIdentifier], ["a", listAddress], ...members.map(member => ["p", member])],
    },
    ownerSecret,
  )
const badgeDefinition = (name: string, timestamp: number) =>
  finalizeEvent(
    {
      kind: 30009,
      created_at: timestamp,
      content: "",
      tags: [
        ...authorityTags,
        ["d", `budabit-${communityId}-${name.toLowerCase()}`],
        ["name", name],
      ],
    },
    ownerSecret,
  )
const helperBadge = badgeDefinition("Helper", createdAt - 90)
const helperAddress = `30009:${owner}:${helperBadge.tags.find(tag => tag[0] === "d")![1]}`
const badgeAward = (timestamp: number, recipient = DEV_PUBKEY) =>
  finalizeEvent(
    {
      kind: 8,
      created_at: timestamp,
      content: "",
      tags: [...authorityTags, ["a", helperAddress, "", "badge"], ["p", recipient]],
    },
    ownerSecret,
  )
const communityPath = `/c/${nip19.naddrEncode({kind: 32222, pubkey: owner, identifier: communityId, relays: [relayUrl]})}`
const bell = (page: Page) => page.getByRole("button", {name: "Notifications", exact: true})
const indicator = (page: Page) => bell(page).locator(".absolute.rounded-full.bg-primary")
const dialog = (page: Page) => page.getByRole("dialog", {name: "Notifications", exact: true})
const closeNotifications = async (page: Page) => {
  await dialog(page).getByRole("button", {name: "Close notifications"}).click()
  await expect(indicator(page)).toHaveCount(0)
}

test.beforeEach(async ({page}) => {
  await seedDevSession(page)
  await page.emulateMedia({colorScheme: "dark"})
})

test("badge awards notify a non-member recipient, stay read on reload, and update live", async ({
  page,
}, info) => {
  const award = badgeAward(createdAt - 30)
  const relay = new MockRelay({
    seedEvents: [definition, profileList(createdAt - 90, []), helperBadge, award],
  })
  await relay.setup(page)
  await page.goto(communityPath)
  await expect(indicator(page)).toBeVisible({timeout: 15_000})
  await bell(page).click()
  await expect(dialog(page).getByText("awarded you a badge", {exact: true})).toBeVisible()
  await expect(dialog(page).getByRole("heading", {name: "New", exact: true})).toBeVisible()
  await expect(dialog(page).getByText("Helper", {exact: true})).toBeVisible()
  await page.screenshot({
    path: info.outputPath("community-badge-notification-desktop.png"),
    animations: "disabled",
  })
  await closeNotifications(page)

  await page.reload()
  await bell(page).click()
  await expect(dialog(page).getByText("awarded you a badge", {exact: true})).toBeVisible()
  await expect(dialog(page).getByRole("heading", {name: "New", exact: true})).toHaveCount(0)
  await closeNotifications(page)

  const next = badgeAward(Math.floor(Date.now() / 1000))
  await relay.injectEvents([badgeAward(next.created_at, other), next])
  await expect(indicator(page)).toBeVisible({timeout: 10_000})
  await bell(page).click()
  await expect(dialog(page).getByText("awarded you a badge", {exact: true})).toHaveCount(2)
  await expect(dialog(page).getByRole("heading", {name: "New", exact: true})).toBeVisible()
  // Navigating an award opens the community's badge-management page.
  await dialog(page).getByRole("button").filter({hasText: "awarded you a badge"}).first().click()
  await expect(page).toHaveURL(`${communityPath}/badges`)
  await expect(
    page
      .getByRole("article")
      .filter({hasText: "Helper"})
      .first()
      .getByRole("button", {name: "Accept badge", exact: true}),
  ).toBeVisible()
})

test("a withdrawn unread badge award clears the bell", async ({page}) => {
  const award = badgeAward(createdAt - 30)
  const relay = new MockRelay({
    seedEvents: [definition, profileList(createdAt - 90, []), helperBadge, award],
  })
  await relay.setup(page)
  await page.goto(communityPath)
  await expect(indicator(page)).toBeVisible({timeout: 15_000})
  await relay.injectEvents([
    finalizeEvent(
      {
        kind: 5,
        created_at: Math.floor(Date.now() / 1000),
        content: "",
        tags: [
          ["h", communityId],
          ["e", award.id],
          ["k", "8"],
        ],
      },
      ownerSecret,
    ),
  ])
  await expect(indicator(page)).toHaveCount(0)
  await bell(page).click()
  await expect(dialog(page).getByText("No notifications found", {exact: true})).toBeVisible()
})

test("membership ignores unrelated edits and notifies loss and restoration of the last grant", async ({
  page,
}, info) => {
  const relay = new MockRelay({seedEvents: [definition, profileList(createdAt - 90, [DEV_PUBKEY])]})
  await relay.setup(page)
  await page.goto(communityPath)
  await expect(indicator(page)).toBeVisible({timeout: 15_000})
  await bell(page).click()
  await expect(
    dialog(page).getByText("granted you publishing access in", {exact: true}),
  ).toBeVisible()
  await closeNotifications(page)

  const unrelated = profileList(createdAt - 80, [DEV_PUBKEY, other])
  await relay.injectEvents([unrelated])
  await expect
    .poll(() =>
      page.evaluate(
        ({viewer, eventId}) => {
          const state = JSON.parse(
            localStorage.getItem("notificationCenter.communityMembership") || "{}",
          )
          return Object.values(state[viewer]?.observations || {}).some(
            (observation: any) => observation.id === eventId,
          )
        },
        {viewer: DEV_PUBKEY, eventId: unrelated.id},
      ),
    )
    .toBe(true)
  await expect(indicator(page)).toHaveCount(0)

  await relay.injectEvents([profileList(createdAt - 70, [other])])
  await expect(indicator(page)).toBeVisible({timeout: 10_000})
  await bell(page).click()
  await expect(
    dialog(page).getByText("removed your publishing grant in", {exact: true}),
  ).toBeVisible()
  await expect(dialog(page).getByRole("heading", {name: "New", exact: true})).toBeVisible()
  await page.screenshot({
    path: info.outputPath("community-grant-removal.png"),
    animations: "disabled",
  })
  await closeNotifications(page)
  await relay.injectEvents([profileList(createdAt - 60, [DEV_PUBKEY, other])])
  await expect(indicator(page)).toBeVisible({timeout: 10_000})
  await bell(page).click()
  await expect(
    dialog(page).getByText("granted you publishing access in", {exact: true}),
  ).toHaveCount(2)
  await closeNotifications(page)
})

test("membership removal while away is detected from the saved grant after reopening", async ({
  page,
  context,
}) => {
  await new MockRelay({seedEvents: [definition, profileList(createdAt - 90, [DEV_PUBKEY])]}).setup(
    page,
  )
  await page.goto(communityPath)
  await expect(indicator(page)).toBeVisible({timeout: 15_000})
  await bell(page).click()
  await expect(
    dialog(page).getByText("granted you publishing access in", {exact: true}),
  ).toBeVisible()
  await closeNotifications(page)
  await page.close()
  const reopened = await context.newPage()
  try {
    await new MockRelay({seedEvents: [definition, profileList(createdAt - 60, [])]}).setup(reopened)
    await reopened.goto(communityPath)
    await expect(indicator(reopened)).toBeVisible({timeout: 15_000})
    await bell(reopened).click()
    await expect(
      dialog(reopened).getByText("removed your publishing grant in", {exact: true}),
    ).toBeVisible()
    await expect(dialog(reopened).getByRole("heading", {name: "New", exact: true})).toBeVisible()
    await closeNotifications(reopened)
  } finally {
    await reopened.close()
  }
})

test("a second moderator request on the same admin route appears as new", async ({page}) => {
  await page.addInitScript(
    ({pubkey, secret}) => {
      localStorage.setItem("pubkey", JSON.stringify(pubkey))
      localStorage.setItem(
        "sessions",
        JSON.stringify({[pubkey]: {method: "nip01", secret, pubkey}}),
      )
    },
    {pubkey: owner, secret: Buffer.from(ownerSecret).toString("hex")},
  )
  const request = (secret: Uint8Array, timestamp: number) =>
    finalizeEvent(
      {
        kind: 30000,
        created_at: timestamp,
        content: "",
        tags: [
          ["d", listIdentifier],
          ...authorityTags,
          ["role", "moderator-request"],
          ["content", "General"],
        ],
      },
      secret,
    )
  const first = request(otherSecret, createdAt - 30)
  const relay = new MockRelay({seedEvents: [definition, profileList(createdAt - 90, []), first]})
  await relay.setup(page)
  await page.goto(communityPath)
  await expect(indicator(page)).toBeVisible({timeout: 15_000})
  await bell(page).click()
  await expect(dialog(page).getByRole("heading", {name: "New", exact: true})).toBeVisible()
  await closeNotifications(page)
  await relay.injectEvents([request(new Uint8Array(32).fill(15), Math.floor(Date.now() / 1000))])
  await expect(indicator(page)).toBeVisible({timeout: 10_000})
  await bell(page).click()
  await expect(dialog(page).getByRole("heading", {name: "New", exact: true})).toBeVisible()
  await closeNotifications(page)
})

test("a later moderator decision on the same access route is new and remains visible after reading", async ({
  page,
}) => {
  const request = finalizeEvent(
    {
      kind: 30000,
      created_at: createdAt - 50,
      content: "",
      tags: [
        ["d", listIdentifier],
        ...authorityTags,
        ["role", "moderator-request"],
        ["content", "General"],
      ],
    },
    Buffer.from(DEV_SECRET, "hex"),
  )
  const decision = (content: string, timestamp: number) =>
    finalizeEvent(
      {
        kind: 7,
        created_at: timestamp,
        content,
        tags: [
          ...authorityTags,
          ["e", request.id],
          ["p", DEV_PUBKEY],
          ["k", "30000"],
          ["content", "General"],
        ],
      },
      ownerSecret,
    )
  const relay = new MockRelay({
    seedEvents: [
      definition,
      profileList(createdAt - 90, []),
      request,
      decision("-", createdAt - 30),
    ],
  })
  await relay.setup(page)
  await page.goto(communityPath)
  await expect(indicator(page)).toBeVisible({timeout: 15_000})
  await bell(page).click()
  await expect(dialog(page).getByText("denied your request for", {exact: true})).toBeVisible()
  await closeNotifications(page)
  await bell(page).click()
  await expect(dialog(page).getByText("denied your request for", {exact: true})).toBeVisible()
  await expect(dialog(page).getByRole("heading", {name: "New", exact: true})).toHaveCount(0)
  await closeNotifications(page)
  const timestamp = Math.floor(Date.now() / 1000)
  await relay.injectEvents([
    decision("+", timestamp),
    finalizeEvent(
      {
        kind: 32222,
        created_at: timestamp,
        content: "",
        tags: [...definition.tags, ["a", `30000:${DEV_PUBKEY}:${listIdentifier}`, relayUrl]],
      },
      ownerSecret,
    ),
  ])
  await expect(indicator(page)).toBeVisible({timeout: 10_000})
  await bell(page).click()
  await expect(dialog(page).getByText("approved your request for", {exact: true})).toBeVisible()
  await expect(dialog(page).getByRole("heading", {name: "New", exact: true})).toBeVisible()
  await closeNotifications(page)
})

test.describe("mobile badges", () => {
  test.use({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true})
  test("shows the badge notification and read state", async ({page}, info) => {
    await new MockRelay({
      seedEvents: [
        definition,
        profileList(createdAt - 90, []),
        helperBadge,
        badgeAward(createdAt - 30),
      ],
    }).setup(page)
    await page.goto(communityPath)
    await expect(indicator(page)).toBeVisible({timeout: 15_000})
    await bell(page).click()
    await expect(dialog(page).getByText("awarded you a badge", {exact: true})).toBeVisible()
    await page.screenshot({
      path: info.outputPath("community-badge-notification-mobile.png"),
      animations: "disabled",
    })
    await closeNotifications(page)
  })
})
