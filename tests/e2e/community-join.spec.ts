import {expect, test} from "@playwright/test"
import {finalizeEvent, getPublicKey, nip19} from "nostr-tools"
import {DEV_PUBKEY, DEV_SECRET, seedDevSession} from "./helpers/dev-session"
import {MockRelay} from "./helpers/mock-relay"

const ownerKey = new Uint8Array(32).fill(31)
const owner = getPublicKey(ownerKey)
const id = "a".repeat(64)
const relayUrl = "wss://join-fixture.example"
const address = `32222:${owner}:${id}`
const path = `/c/${nip19.naddrEncode({kind: 32222, pubkey: owner, identifier: id, relays: [relayUrl]})}`
const now = Math.floor(Date.now() / 1000) - 100
const sign = (kind: number, tags: string[][], content = "") =>
  finalizeEvent({kind, tags, content, created_at: now}, ownerKey)
const list = `30000:${owner}:${id}-general`
const authority = [
  ["h", id],
  ["a", address, relayUrl, "community"],
]
const form = sign(30168, [
  ["d", "general-application"],
  ...authority,
  ["content", "General"],
  ["name", "General application"],
  ["field", "q1", "text", "Why would you like to join?", "", '{"required":true}'],
])

for (const scenario of [
  "newcomer",
  "member",
  "pending",
  "guest",
  "missing-form",
  "duplicate",
  "legacy",
] as const) {
  test(`community home join: ${scenario}`, async ({page}) => {
    const relay = new MockRelay()
    const tags = [
      ["d", id],
      ["name", "Join fixture community"],
      ["r", relayUrl],
      ["content", "General"],
      ...(scenario === "legacy" ? [] : [["join"]]),
      ["k", "1111"],
      ["a", list, relayUrl],
      ...(scenario === "duplicate" ? [["join"]] : []),
    ]
    relay.seedEvents([
      sign(32222, tags),
      sign(30000, [["d", `${id}-general`], ...(scenario === "member" ? [["p", DEV_PUBKEY]] : [])]),
      ...(scenario === "missing-form" ? [] : [form]),
      ...(scenario === "pending"
        ? [
            finalizeEvent(
              {
                kind: 1069,
                created_at: now + 1,
                content: "",
                tags: [
                  ...authority,
                  ["a", `30168:${owner}:general-application`, "", "form"],
                  ["response", "q1", "Build together", "{}"],
                ],
              },
              Buffer.from(DEV_SECRET, "hex"),
            ),
          ]
        : []),
    ])
    await relay.setup(page)
    if (scenario !== "guest") await seedDevSession(page)
    await page.goto(path)
    const status = page.getByLabel("Community membership", {exact: true})
    if (scenario === "member") {
      await expect(status.getByRole("status")).toHaveText("Member")
      await expect(status.getByRole("button", {name: "Join", exact: true})).toHaveCount(0)
      await expect(status.getByRole("link", {name: "Join", exact: true})).toHaveCount(0)
    } else if (scenario === "pending") {
      await expect(status.getByRole("status")).toHaveText("Application pending approval")
      await expect(status.getByRole("button", {name: "Join", exact: true})).toHaveCount(0)
    } else if (scenario === "missing-form" || scenario === "duplicate") {
      await expect(status.getByRole("status")).toContainText("application unavailable")
      await expect(status.getByRole("button", {name: "Join", exact: true})).toHaveCount(0)
      await expect(status.getByRole("link", {name: "Join", exact: true})).toHaveCount(0)
    } else {
      await expect(status.getByRole("status")).toHaveText("Not joined")
      await status.getByRole("button", {name: "Join", exact: true}).click()
      if (scenario === "guest") {
        await expect(page.getByRole("button", {name: "Sign in to continue"})).toBeVisible()
        expect(relay.getPublishedEventsByKind(1069)).toHaveLength(0)
        return
      }
      if (scenario === "legacy")
        await page.getByRole("button", {name: "General", exact: true}).click()
      const application = page.getByRole("region", {name: "General publishing access"})
      await expect(
        application.getByText("Why would you like to join?", {exact: true}),
      ).toBeVisible()
      await application.locator("textarea").fill("I want to build useful things.")
      await application.getByRole("button", {name: "Review request"}).click()
      await expect(page.getByText("Review your request", {exact: true})).toBeVisible()
      await expect(page.getByRole("button", {name: "Submit request"})).toBeVisible()
      expect(relay.getPublishedEventsByKind(1069)).toHaveLength(0)
    }
    await page.setViewportSize({width: 390, height: 844})
    await page.screenshot({path: test.info().outputPath(`${scenario}-mobile.png`)})
    expect(relay.getPublishedEventsByKind(32222)).toHaveLength(0)
  })
}

test("owner sees missing setup on Home and can choose a section without publishing", async ({
  page,
}) => {
  const relay = new MockRelay()
  relay.seedEvents([
    sign(32222, [
      ["d", id],
      ["name", "Join fixture community"],
      ["r", relayUrl],
      ["content", "General"],
      ["k", "1111"],
    ]),
  ])
  await relay.setup(page)
  await page.addInitScript(
    ({pubkey, secret}) => {
      localStorage.setItem("pubkey", JSON.stringify(pubkey))
      localStorage.setItem(
        "sessions",
        JSON.stringify({[pubkey]: {method: "nip01", secret, pubkey}}),
      )
    },
    {pubkey: owner, secret: Buffer.from(ownerKey).toString("hex")},
  )
  await page.goto(path)
  const status = page.getByLabel("Community membership", {exact: true})
  await expect(status.getByRole("status")).toHaveText("Member · Owner")
  await expect(status.getByRole("button", {name: "Join", exact: true})).toHaveCount(0)
  await status
    .getByRole("link", {name: "Choose a default section for new members to join."})
    .click()
  const choice = page.getByRole("combobox", {name: "Choose a default section for new members to join.", exact: true})
  await expect(choice).toHaveValue("", {timeout: 15000})
  await choice.selectOption({label: "General"})
  await expect(
    page.getByText(
      "Set up an application form for this section in Moderation → Forms so new members can join.",
    ),
  ).toBeVisible()
  await page.setViewportSize({width: 390, height: 844})
  await choice.scrollIntoViewIfNeeded()
  await page.screenshot({path: test.info().outputPath("owner-editor-mobile.png")})
  expect(relay.getPublishedEventsByKind(32222)).toHaveLength(0)
})
