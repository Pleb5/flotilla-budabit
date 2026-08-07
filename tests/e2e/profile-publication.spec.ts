import {expect, test} from "@playwright/test"
import {nip19} from "nostr-tools"
import {DEV_PUBKEY, seedDevSession} from "./helpers/dev-session"
import {MockRelay, type NostrEvent} from "./helpers/mock-relay"

const verifiedRelay = "wss://purplepag.es/"
const stalledRelays = ["wss://nos.lol/", "wss://relay.damus.io/"]

test("completes profile publication after the first verified relay", async ({page}) => {
  const publications: Array<{event: NostrEvent; relayUrl: string}> = []
  const mockRelay = new MockRelay({
    publishResponsesByRelay: {
      [verifiedRelay]: {outcome: "accept", retain: true},
      ...Object.fromEntries(stalledRelays.map(relay => [relay, {outcome: "stall" as const}])),
    },
    onPublish: (event, relayUrl) => {
      if (event.kind === 0) publications.push({event, relayUrl})
    },
  })
  const submittedName = "MockRelay Profile"
  const submittedAbout = "Verified by the first retaining relay."

  await seedDevSession(page)
  await mockRelay.setup(page)
  await page.goto(`/people/${nip19.npubEncode(DEV_PUBKEY)}`)

  await page.getByRole("button", {name: "Edit profile"}).click()
  const modal = page.getByTestId("modal-root")
  await expect(modal.getByRole("button", {name: "Save Changes"})).toBeVisible()

  const textInputs = modal.locator('input[type="text"]')
  await textInputs.first().fill(submittedName)
  await modal.locator("textarea").fill(submittedAbout)
  await modal.getByRole("button", {name: "Save Changes"}).click()

  await expect
    .poll(() => {
      const destinations = new Set(publications.map(publication => publication.relayUrl))

      return destinations.has(verifiedRelay) && stalledRelays.some(relay => destinations.has(relay))
    })
    .toBe(true)
  await expect(page.getByText("Your profile has been updated!", {exact: true})).toBeVisible()
  await expect(modal.getByRole("button", {name: /Save Changes|Saving/})).toHaveCount(0)
  await expect(page.getByRole("heading", {name: submittedName, exact: true})).toBeVisible()
  await expect(page.getByText(submittedAbout, {exact: true})).toBeVisible()

  expect(new Set(publications.map(publication => publication.event.id)).size).toBe(1)
  expect(publications).toHaveLength(
    new Set(publications.map(publication => publication.relayUrl)).size,
  )
  for (const {event} of publications) {
    expect(JSON.parse(event.content)).toMatchObject({name: submittedName, about: submittedAbout})
  }
})
