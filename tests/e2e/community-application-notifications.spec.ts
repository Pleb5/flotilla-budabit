import {expect, test} from "@playwright/test"
import {finalizeEvent, getPublicKey, nip19} from "nostr-tools"
import {DEV_PUBKEY, DEV_SECRET, seedDevSession} from "./helpers/dev-session"
import {MockRelay} from "./helpers/mock-relay"

const ownerSecret = Uint8Array.from(Buffer.from(DEV_SECRET, "hex"))
const applicantSecret = new Uint8Array(32).fill(7)
const communityId = getPublicKey(new Uint8Array(32).fill(8))
const relayUrl = "wss://application-notifications.example"
const communityAddress = `32222:${DEV_PUBKEY}:${communityId}`
const formAddress = `30168:${DEV_PUBKEY}:general-application`
const createdAt = Math.floor(Date.now() / 1000)
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
      ["name", "Application Notifications Community"],
      ["r", relayUrl],
      ["content", "General"],
      ["k", "1111"],
      ["k", "7"],
      ["k", "1984"],
      ["k", "1985"],
      ["a", `30000:${DEV_PUBKEY}:${communityId}-general`, relayUrl],
    ],
  },
  ownerSecret,
)
const profileList = finalizeEvent(
  {kind: 30000, created_at: createdAt - 100, content: "", tags: [["d", `${communityId}-general`]]},
  ownerSecret,
)
const form = finalizeEvent(
  {
    kind: 30168,
    created_at: createdAt - 90,
    content: "",
    tags: [
      ["d", "general-application"],
      ...authorityTags,
      ["content", "General"],
      ["name", "General application"],
      ["field", "q1", "text", "Why would you like to join?"],
    ],
  },
  ownerSecret,
)
const makeApplication = (secret: Uint8Array, timestamp: number) =>
  finalizeEvent(
    {
      kind: 1069,
      created_at: timestamp,
      content: "",
      tags: [
        ...authorityTags,
        ["a", formAddress, "", "form"],
        ["response", "q1", "I would like to participate."],
      ],
    },
    secret,
  )
const application = makeApplication(applicantSecret, createdAt - 60)
const community = nip19.naddrEncode({
  kind: 32222,
  pubkey: DEV_PUBKEY,
  identifier: communityId,
  relays: [relayUrl],
})
const communityPath = `/c/${community}`

test.beforeEach(async ({page}) => {
  await page.emulateMedia({colorScheme: "dark"})
})

test("owner bell discovers applications before opening notifications and updates after reading", async ({
  page,
}, info) => {
  await seedDevSession(page)
  const relay = new MockRelay({seedEvents: [definition, profileList, form, application]})
  await relay.setup(page)
  await page.goto(communityPath)

  const moderation = page.getByRole("link", {name: "Moderation 1 pending", exact: true})
  await expect(moderation).toBeVisible({timeout: 15_000})
  const bell = page.getByRole("button", {name: "Notifications", exact: true})
  const indicator = bell.locator(".absolute.rounded-full.bg-primary")
  await expect(indicator).toBeVisible({timeout: 15_000})
  await expect(moderation.locator(".absolute.rounded-full.bg-primary")).toHaveCount(0)
  await page.screenshot({path: info.outputPath("owner-application-bell-desktop.png")})

  await bell.click()
  const dialog = page.getByRole("dialog", {name: "Notifications", exact: true})
  await expect(dialog.getByText("requested to publish in", {exact: true})).toHaveCount(1)
  await expect(dialog.getByText("New", {exact: true})).toBeVisible()
  await dialog.getByRole("button", {name: "Close notifications"}).click()
  await expect(indicator).toHaveCount(0)
  await expect(moderation).toBeVisible()

  // A later request must light the bell again while the center remains closed.
  await relay.injectEvents([
    makeApplication(new Uint8Array(32).fill(9), Math.floor(Date.now() / 1000)),
  ])
  await expect(indicator).toBeVisible({timeout: 10_000})
  await bell.click()
  await expect(dialog.getByText("requested to publish in", {exact: true})).toHaveCount(2)
  await dialog.getByRole("button", {name: "Close notifications"}).click()
  await expect(indicator).toHaveCount(0)

  // Reading persists across a fresh page load; pending moderation is still actionable.
  await page.reload()
  await expect(moderation).toBeVisible({timeout: 15_000})
  await bell.click()
  await expect(dialog.getByText("requested to publish in", {exact: true})).toHaveCount(1)
  await expect(dialog.getByText("New", {exact: true})).toHaveCount(0)
  await dialog.getByRole("button", {name: "Close notifications"}).click()
  await expect(indicator).toHaveCount(0)
})

test("withdrawing an unread application clears the owner bell and pending badge", async ({
  page,
}) => {
  await seedDevSession(page)
  const withdrawal = finalizeEvent(
    {
      kind: 5,
      created_at: createdAt - 50,
      content: "",
      tags: [
        ["h", communityId],
        ["e", application.id],
        ["k", "1069"],
      ],
    },
    applicantSecret,
  )
  const relay = new MockRelay({seedEvents: [definition, profileList, form, application]})
  await relay.setup(page)
  await page.goto(communityPath)
  const bell = page.getByRole("button", {name: "Notifications", exact: true})
  const indicator = bell.locator(".absolute.rounded-full.bg-primary")
  await expect(indicator).toBeVisible({timeout: 15_000})
  // The notification source must retrieve decision evidence for the exact community.
  await expect
    .poll(async () =>
      (await relay.getTelemetry()).some(
        entry =>
          entry.type === "req" &&
          entry.filters?.some(
            filter =>
              filter.kinds?.includes(5) &&
              filter.kinds?.includes(7) &&
              filter["#e"]?.includes(application.id),
          ),
      ),
    )
    .toBe(true)
  await relay.injectEvents([withdrawal])
  await expect(indicator).toHaveCount(0)
  await expect(page.getByRole("link", {name: "Moderation", exact: true})).toBeVisible()
  await bell.click()
  const dialog = page.getByRole("dialog", {name: "Notifications", exact: true})
  await expect(dialog.getByText("No notifications found", {exact: true})).toBeVisible()
  await expect(dialog.getByText("requested to publish in", {exact: true})).toHaveCount(0)
  await dialog.getByRole("button", {name: "Close notifications"}).click()
  await expect(bell.locator(".absolute.rounded-full.bg-primary")).toHaveCount(0)
})

test.describe("mobile application indicators", () => {
  test.use({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true})

  test("shows the unread bell and one unobstructed pending badge in the drawer", async ({
    page,
  }, info) => {
    await seedDevSession(page)
    await new MockRelay({seedEvents: [definition, profileList, form, application]}).setup(page)
    await page.goto(communityPath)
    const bell = page.getByRole("button", {name: "Notifications", exact: true})
    await expect(bell.locator(".absolute.rounded-full.bg-primary")).toBeVisible({timeout: 15_000})
    await page.getByRole("button", {name: "Open community menu", exact: true}).click()
    const moderation = page.getByRole("link", {name: "Moderation 1 pending", exact: true})
    await expect(moderation).toBeVisible()
    await expect(moderation.locator(".absolute.rounded-full.bg-primary")).toHaveCount(0)
    // Measure together: the drawer slides between separate browser round trips.
    const {row, label, badge} = await moderation.evaluate(element => ({
      row: element.getBoundingClientRect().toJSON(),
      label: Array.from(element.querySelectorAll("span"))
        .find(span => span.textContent?.trim() === "Moderation")!
        .getBoundingClientRect()
        .toJSON(),
      badge: Array.from(element.querySelectorAll("span"))
        .find(span => span.textContent?.trim() === "1 pending")!
        .getBoundingClientRect()
        .toJSON(),
    }))
    expect(label.width).toBeGreaterThan(0)
    expect(badge.width).toBeGreaterThan(0)
    expect(label.right).toBeLessThan(badge.left)
    expect(badge.right).toBeLessThan(row.right)
    await page.screenshot({
      path: info.outputPath("owner-application-menu-mobile.png"),
      animations: "disabled",
    })
  })
})
