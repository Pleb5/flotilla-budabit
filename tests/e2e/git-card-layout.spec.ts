import {expect, test} from "@playwright/test"
import {nip19} from "nostr-tools"
import {TEST_PUBKEYS, createRepoAnnouncement, signTestEvent} from "./fixtures/events"
import {MockRelay} from "./helpers/mock-relay"

for (const viewport of [
  {name: "desktop", width: 1280, height: 900},
  {name: "mobile", width: 390, height: 844},
]) {
  test(`keeps missing descriptions inside repository card backgrounds (${viewport.name})`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    const pageErrors: Error[] = []
    page.on("pageerror", error => pageErrors.push(error))
    const announcements = ["missing", "empty", "present"].map(description => {
      const event = createRepoAnnouncement({
        identifier: `description-${description}`,
        name: `Description ${description}`,
        pubkey: TEST_PUBKEYS.alice,
        relays: ["wss://git-card-layout.test"],
      })
      if (description !== "missing") {
        event.tags.push(["description", description === "empty" ? "" : "A repository description."])
      }
      return signTestEvent(event)
    })
    const relay = new MockRelay({seedEvents: announcements})
    await relay.setup(page)
    await page.addInitScript(() => localStorage.clear())
    await page.goto("/git")
    await page
      .getByPlaceholder("Repo, owner, npub, or naddr")
      .fill(nip19.npubEncode(TEST_PUBKEYS.alice))

    const cards = page.getByTestId("repo-card-grid").getByTestId("repo-card")
    await expect(cards).toHaveCount(3, {timeout: 10_000})
    for (const description of ["missing", "empty"]) {
      const card = cards.filter({has: page.getByText(`Description ${description}`, {exact: true})})
      const placeholder = card.getByText("Description missing!", {exact: true})
      await expect(placeholder).toBeVisible()
      const layout = await placeholder.evaluate(element => {
        const background = element.closest(".card2")!.getBoundingClientRect()
        const title = element.closest(".card2")!.querySelector("a p")!.getBoundingClientRect()
        // Measure painted text, not just the paragraph: a zero-height paragraph can overflow.
        const range = document.createRange()
        range.selectNodeContents(element)
        const text = range.getBoundingClientRect()
        return {
          height: element.getBoundingClientRect().height,
          textHeight: text.height,
          leftInset: text.left - background.left,
          rightInset: background.right - text.right,
          bottomInset: background.bottom - text.bottom,
          titleOffset: text.left - title.left,
        }
      })
      expect(layout.height).toBeGreaterThanOrEqual(layout.textHeight)
      expect(layout.leftInset).toBeGreaterThanOrEqual(8)
      expect(layout.rightInset).toBeGreaterThanOrEqual(8)
      expect(layout.bottomInset).toBeGreaterThanOrEqual(8)
      expect(Math.abs(layout.titleOffset)).toBeLessThanOrEqual(1)
    }
    const describedCard = cards.filter({hasText: "Description present"})
    await expect(describedCard.getByText("A repository description.", {exact: true})).toBeVisible()
    await expect(describedCard.getByText("Description missing!", {exact: true})).toHaveCount(0)
    expect(relay.getPublishedEvents()).toEqual([])
    expect(pageErrors).toEqual([])
  })
}
