import {expect, test} from "@playwright/test"
import {finalizeEvent, getPublicKey, nip19} from "nostr-tools"
import {DEV_PUBKEY, DEV_SECRET, seedDevSession} from "./helpers/dev-session"
import {MockRelay} from "./helpers/mock-relay"

test("a sent attachment keeps its parent and retries the same file event after reload", async ({
  page,
}) => {
  page.on("pageerror", error => console.error("Attachment browser error:", error.message))
  const secret = Uint8Array.from(Buffer.from(DEV_SECRET, "hex"))
  const id = getPublicKey(new Uint8Array(32).fill(9))
  const relay = "wss://attachment-publication.example"
  const hash = "b".repeat(64)
  const url = `https://attachment-blossom.example/${hash}.pdf`
  const authority = [
    ["h", id],
    ["a", `32222:${DEV_PUBKEY}:${id}`, relay, "community"],
  ]
  const definition = finalizeEvent(
    {
      kind: 32222,
      created_at: 1,
      content: "",
      tags: [
        ["d", id],
        ["name", "Attachment fixture"],
        ["r", relay],
        ["content", "Room-creator"],
        ["k", "11", "room"],
        ["k", "9", "room-message"],
        ["a", `30000:${DEV_PUBKEY}:${id}-general`, relay],
        ["content", "General"],
        ["k", "1111"],
        ["a", `30000:${DEV_PUBKEY}:${id}-general`, relay],
      ],
    },
    secret,
  )
  const room = finalizeEvent(
    {
      kind: 11,
      created_at: 2,
      content: "Synthetic attachment acceptance",
      tags: [...authority, ["room"], ["title", "Attachment room"]],
    },
    secret,
  )
  let rejectFile = true
  const destinations: string[] = []
  const mock = new MockRelay({
    seedEvents: [definition, room],
    getPublishResponse: event =>
      event.kind === 1063 && rejectFile
        ? {outcome: "reject", message: "synthetic temporary failure"}
        : undefined,
    onPublish: (event, destination) => {
      if ([9, 1063].includes(event.kind)) destinations.push(destination)
    },
  })
  await seedDevSession(page)
  await page.addInitScript(
    ({url, hash, owner}) => {
      const key = "budabit/file-publications:v1"
      if (!localStorage.getItem(key))
        localStorage.setItem(
          key,
          JSON.stringify({
            jobs: [],
            uploads: [
              {
                owner,
                url,
                sha256: hash,
                originalSha256: "c".repeat(64),
                size: 3,
                type: "application/pdf",
                name: "Synthetic attachment.pdf",
              },
            ],
          }),
        )
    },
    {url, hash, owner: DEV_PUBKEY},
  )
  await mock.setup(page)
  await page.route("https://attachment-blossom.example/**", route =>
    route.fulfill({status: 200, contentType: "application/pdf", body: "pdf"}),
  )
  const path = `/c/${nip19.naddrEncode({kind: 32222, pubkey: DEV_PUBKEY, identifier: id, relays: [relay]})}/rooms/${room.id}`
  await page.goto(path)
  const composer = page.locator('.chat__compose [contenteditable="true"]')
  try {
    await expect(composer).toBeVisible({timeout: 10000})
  } catch (error) {
    console.error((await page.locator("body").innerText()).slice(0, 2500))
    console.error(
      "Mock relay trace:",
      JSON.stringify((await mock.getTelemetry()).filter(entry => entry.relayUrl === `${relay}/`)),
    )
    await page.screenshot({path: "test-results/attachment-publication-failure.png"})
    throw error
  }
  await composer.fill(`Synthetic file send\n${url}`)
  expect(mock.getPublishedEvents().filter(e => e.kind === 1063)).toHaveLength(0)
  await page.getByRole("button", {name: "Send message", exact: true}).click()
  const parent = await mock.waitForEvent(9)
  const file = await mock.waitForEvent(1063)
  expect(file.tags).toContainEqual(["x", hash])
  expect(file.tags).toContainEqual(["ox", "c".repeat(64)])
  expect(file.tags).toContainEqual(["h", id])
  await expect(page.locator(`[data-event="${parent.id}"]`)).toBeVisible()
  const retained = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem("budabit/file-publications:v1")!).jobs)
  await expect.poll(async () => (await retained())[0]?.state).toBe("pending")
  await page.reload()
  await expect(composer).toBeVisible()
  await page.getByRole("button", {name: "Notifications", exact: true}).click()
  await page.getByRole("button", {name: "Open publication recovery with 1 item"}).click()
  await expect(page.getByRole("heading", {name: "Publication recovery"})).toBeVisible()
  await expect(page.getByText("File metadata · Synthetic attachment.pdf")).toBeVisible()
  await page.screenshot({
    path: "test-results/attachment-publication-pending.png",
    animations: "disabled",
  })
  rejectFile = false
  await page.getByRole("button", {name: "Retry file metadata", exact: true}).click()
  await expect.poll(async () => (await retained())[0]?.state).toBe("published")
  expect(
    new Set(
      mock
        .getPublishedEvents()
        .filter(e => e.kind === 1063)
        .map(e => e.id),
    ),
  ).toEqual(new Set([file.id]))
  expect(new Set(destinations)).toEqual(new Set([`${relay}/`]))
  await expect(page.getByText("No publications currently need attention.")).toBeVisible()
  await page.screenshot({
    path: "test-results/attachment-publication-recovered.png",
    animations: "disabled",
  })
})
