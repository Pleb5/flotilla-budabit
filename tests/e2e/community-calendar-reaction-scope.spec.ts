import {expect, test} from "@playwright/test"
import {finalizeEvent, getPublicKey, nip19} from "nostr-tools"
import {DEV_PUBKEY, DEV_SECRET, seedDevSession} from "./helpers/dev-session"
import {MockRelay} from "./helpers/mock-relay"

const communityRelay = "wss://calendar-community.example"
const personalOutboxRelay = "wss://calendar-outbox.example"
const communityRelayConnection = `${communityRelay}/`
const communitySecret = Uint8Array.from(
  DEV_SECRET.match(/.{2}/g)?.map(byte => Number.parseInt(byte, 16)) || [],
)
const communityId = getPublicKey(new Uint8Array(32).fill(2))
const profileListIdentifier = `${communityId}-calendar`
const profileListAddress = `30000:${DEV_PUBKEY}:${profileListIdentifier}`

const definition = finalizeEvent(
  {
    kind: 32222,
    created_at: 1,
    content: "",
    tags: [
      ["d", communityId],
      ["name", "Calendar Reaction Community"],
      ["description", "Community calendar reaction scope test fixture"],
      ["r", communityRelay],
      ["content", "Calendar-event-creator"],
      ["k", "31922"],
      ["k", "31923"],
      ["a", profileListAddress, communityRelay],
      ["content", "General"],
      ["k", "1111"],
      ["k", "7"],
      ["k", "1984"],
      ["k", "1985"],
      ["a", profileListAddress, communityRelay],
    ],
  },
  communitySecret,
)

const relayList = finalizeEvent(
  {
    kind: 10002,
    created_at: 2,
    content: "",
    tags: [["r", personalOutboxRelay, "write"]],
  },
  communitySecret,
)

const profileList = finalizeEvent(
  {
    kind: 30000,
    created_at: 2,
    content: "",
    tags: [
      ["d", profileListIdentifier],
      ["p", DEV_PUBKEY],
    ],
  },
  communitySecret,
)

const calendarEvent = finalizeEvent(
  {
    kind: 31922,
    created_at: 3,
    content: "Strict community reaction transport",
    tags: [
      ["d", "calendar-reaction-scope"],
      ["h", communityId],
      ["title", "Calendar reaction scope"],
      ["start", "2099-01-01"],
    ],
  },
  communitySecret,
)

const calendarEventReplacement = finalizeEvent(
  {
    kind: 31922,
    created_at: 5,
    content: "Replacement with stable reaction projection",
    tags: [
      ["d", "calendar-reaction-scope"],
      ["h", communityId],
      ["title", "Calendar reaction scope replacement"],
      ["start", "2099-01-01"],
    ],
  },
  communitySecret,
)

const seededReaction = finalizeEvent(
  {
    kind: 7,
    created_at: 4,
    content: "🔥",
    tags: [
      ["h", communityId],
      ["k", String(calendarEvent.kind)],
      ["e", calendarEvent.id, communityRelay],
      [
        "a",
        `${calendarEvent.kind}:${calendarEvent.pubkey}:calendar-reaction-scope`,
        communityRelay,
      ],
    ],
  },
  communitySecret,
)

const communityNaddr = nip19.naddrEncode({
  kind: 32222,
  pubkey: DEV_PUBKEY,
  identifier: communityId,
  relays: [communityRelay],
})
const eventPath = `/c/${communityNaddr}/calendar/calendar-reaction-scope`

test.describe("calendar edit return navigation", () => {
  test.beforeEach(async ({page}) => {
    // Keep HTTP resources local as well as intercepting all relay WebSockets.
    await page.route("**/*", route =>
      new URL(route.request().url()).hostname === "localhost" ? route.continue() : route.abort(),
    )
  })

  test.afterEach(async ({page}, testInfo) => {
    const errors = await page.pageErrors()
    await testInfo.attach("page-errors", {
      body: JSON.stringify(errors.map(error => error.message)),
      contentType: "application/json",
    })
    const consoleErrors = (await page.consoleMessages())
      .filter(message => message.type() === "error")
      .map(message => message.text())
    await testInfo.attach("console-errors", {
      body: JSON.stringify(consoleErrors),
      contentType: "application/json",
    })
    // Offline third-party resource requests can reject outside the calendar UI.
    expect(errors.filter(error => error.message !== "Failed to fetch")).toEqual([])
  })

  test("mobile list edit returns to the list with the replacement link", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({width: 390, height: 844})
    const mockRelay = new MockRelay({
      seedEvents: [definition, relayList, profileList, calendarEvent],
    })
    await seedDevSession(page)
    await mockRelay.setup(page)
    const listPath = `/c/${communityNaddr}/calendar?view=calendar`
    await page.goto(listPath)
    await page.getByRole("button", {name: "Open event actions", exact: true}).click()
    await page.getByRole("button", {name: "Edit Event", exact: true}).click()
    const modal = page.getByRole("dialog")
    await modal.locator('input[type="text"]').first().fill("Edited from mobile list")
    await modal.getByRole("button", {name: "Save Event", exact: true}).click()
    await expect(modal).toBeHidden()
    await expect(page).toHaveURL(listPath)
    const replacement = mockRelay.getPublishedEvents().find(event => event.kind === 31922)!
    const card = page.locator(`[data-event="${replacement.id}"]`)
    await expect(card.getByText("Edited from mobile list", {exact: true})).toBeVisible()
    await expect(card.locator("a").first()).toHaveAttribute(
      "href",
      `/c/${communityNaddr}/calendar/${replacement.id}`,
    )
    await expect(page.locator('[role="dialog"]')).toHaveCount(0)
    await page.screenshot({path: testInfo.outputPath("edited-mobile-list.png")})
  })

  for (const kind of [31922, 31923]) {
    test(`opens the acknowledged replacement after editing kind ${kind}`, async ({
      page,
    }, testInfo) => {
      const original = finalizeEvent(
        {
          ...calendarEvent,
          kind,
          tags: calendarEvent.tags
            .map(tag => (tag[0] === "start" && kind === 31923 ? ["start", "4070908800"] : tag))
            .concat(kind === 31923 ? [["end", "4070912400"]] : []),
        },
        communitySecret,
      )
      const mockRelay = new MockRelay({
        seedEvents: [definition, relayList, profileList, original],
        getPublishResponse: event => (event.kind === kind ? {latency: 800} : undefined),
      })
      await seedDevSession(page)
      await mockRelay.setup(page)
      const originalPath = `/c/${communityNaddr}/calendar/${original.id}?view=calendar`
      await page.goto(originalPath)
      await page.getByRole("button", {name: "Open event actions", exact: true}).click()
      await page.getByRole("button", {name: "Edit Event", exact: true}).click()
      const modal = page.getByRole("dialog")
      await modal.locator('input[type="text"]').first().fill("Edited calendar event")
      await modal.getByRole("button", {name: "Save Event", exact: true}).click()
      await expect(modal.getByRole("button", {name: "Save Event", exact: true})).toBeDisabled()
      expect(new URL(page.url()).pathname).toBe(new URL(originalPath, "http://localhost").pathname)
      await expect(modal).toBeHidden()
      const replacement = mockRelay.getPublishedEvents().find(event => event.kind === kind)!
      expect(replacement.id).not.toBe(original.id)
      await expect(page).toHaveURL(`/c/${communityNaddr}/calendar/${replacement.id}?view=calendar`)
      await expect(
        page.getByRole("article").getByText("Edited calendar event", {exact: true}),
      ).toBeVisible()
      await page.screenshot({path: testInfo.outputPath(`edited-${kind}.png`)})
      // The reused detail actions must edit the replacement on a second edit.
      await page.getByRole("button", {name: "Open event actions", exact: true}).click()
      await page.getByRole("button", {name: "Edit Event", exact: true}).click()
      await expect(modal.locator('input[type="text"]').first()).toHaveValue("Edited calendar event")
      await modal.getByRole("button", {name: "Go back", exact: true}).click()
      await expect(modal).toBeHidden()
      await expect(page).toHaveURL(`/c/${communityNaddr}/calendar/${replacement.id}?view=calendar`)
    })
  }

  test("rejected edit stays in the form and cancel restores the original context", async ({
    page,
  }) => {
    const mockRelay = new MockRelay({
      seedEvents: [definition, relayList, profileList, calendarEvent],
      getPublishResponse: event =>
        event.kind === 31922
          ? {outcome: "reject", message: "Calendar edit rejected for test"}
          : undefined,
    })
    await seedDevSession(page)
    await mockRelay.setup(page)
    const originalPath = `/c/${communityNaddr}/calendar/${calendarEvent.id}?view=calendar`
    await page.goto(originalPath)
    await page.getByRole("button", {name: "Open event actions", exact: true}).click()
    await page.getByRole("button", {name: "Edit Event", exact: true}).click()
    const modal = page.getByRole("dialog")
    await modal.locator('input[type="text"]').first().fill("Rejected edit")
    await modal.getByRole("button", {name: "Save Event", exact: true}).click()
    await expect(page.getByText("Calendar edit rejected for test", {exact: false})).toBeVisible()
    await expect(modal.locator('input[type="text"]').first()).toHaveValue("Rejected edit")
    await modal.getByRole("button", {name: "Go back", exact: true}).click()
    await expect(modal).toBeHidden()
    await expect(page).toHaveURL(originalPath)
    await expect(
      page.getByRole("article").getByText("Calendar reaction scope", {exact: true}),
    ).toBeVisible()
  })

  for (const departure of ["query", "community", "reopen"] as const) {
    test(`late edit ACK retains publication without navigating after ${departure}`, async ({
      page,
    }) => {
      const otherCommunityId = getPublicKey(new Uint8Array(32).fill(3))
      const otherDefinition = finalizeEvent(
        {
          ...definition,
          tags: definition.tags.map(tag => (tag[0] === "d" ? ["d", otherCommunityId] : tag)),
        },
        communitySecret,
      )
      const otherCommunityNaddr = nip19.naddrEncode({
        kind: 32222,
        pubkey: DEV_PUBKEY,
        identifier: otherCommunityId,
        relays: [communityRelay],
      })
      const mockRelay = new MockRelay({
        seedEvents: [definition, otherDefinition, relayList, profileList, calendarEvent],
      })
      let releaseAck!: () => void
      const ackGate = new Promise<void>(resolve => {
        releaseAck = resolve
      })
      await page.exposeFunction("__calendarAckGate", () => ackGate)
      await seedDevSession(page)
      await mockRelay.setup(page)
      const originalPath = `/c/${communityNaddr}/calendar/${calendarEvent.id}?view=calendar`
      await page.goto(originalPath)
      // Hold the fixture's publication response until the departure is complete,
      // so slow CI cannot accidentally ACK before exercising the lifecycle race.
      await page.evaluate(() => {
        const fixture = window as unknown as {
          __mockRelayPublish: (event: {kind: number}, relay: string) => Promise<unknown>
          __calendarAckGate: () => Promise<void>
        }
        const publish = fixture.__mockRelayPublish
        fixture.__mockRelayPublish = async (event, relay) => {
          const response = await publish(event, relay)
          if (event.kind === 31922) await fixture.__calendarAckGate()
          return response
        }
      })
      await page.getByRole("button", {name: "Open event actions", exact: true}).click()
      await page.getByRole("button", {name: "Edit Event", exact: true}).click()
      const modal = page.getByRole("dialog")
      await modal.locator('input[type="text"]').first().fill("Acknowledged after departure")
      await modal.getByRole("button", {name: "Save Event", exact: true}).click()
      await expect
        .poll(() => mockRelay.getPublishedEvents().filter(event => event.kind === 31922).length)
        .toBe(1)
      await expect(modal.getByRole("button", {name: "Save Event", exact: true})).toBeDisabled()

      // Exercise the SvelteKit client router, not a reload that destroys the
      // pending publication. Fixture links make query/community departures exact.
      const followFixtureLink = async (path: string) => {
        await page.evaluate(href => {
          const link = document.createElement("a")
          link.href = href
          link.textContent = "Calendar fixture destination"
          ;(document.querySelector('[role="dialog"]') || document.body).append(link)
        }, path)
        await page.getByRole("link", {name: "Calendar fixture destination", exact: true}).click()
      }

      let destination: string
      if (departure === "reopen") {
        await modal.getByRole("button", {name: "Go back", exact: true}).click()
        await expect(modal).toBeHidden()
        await page.getByRole("button", {name: "Open event actions", exact: true}).click()
        await page.getByRole("button", {name: "Edit Event", exact: true}).click()
        await modal.locator('input[type="text"]').first().fill("Separate unsaved draft")
        destination = page.url()
      } else {
        destination =
          departure === "query"
            ? originalPath.replace("view=calendar", "view=list&returnTo=https%3A%2F%2Fexample.com")
            : `/c/${otherCommunityNaddr}/calendar?view=list`
        await followFixtureLink(destination)
        await expect(page).toHaveURL(destination)
        await expect(modal).toBeHidden()
      }

      // The completion toast is emitted only after ACK and repository retention.
      releaseAck()
      await expect(page.getByText("Your event has been saved!", {exact: true})).toBeVisible({
        timeout: 10000,
      })
      await expect(page).toHaveURL(destination)
      const publications = mockRelay.getPublishedEvents().filter(event => event.kind === 31922)
      expect(publications).toHaveLength(1)
      const replacement = publications[0]
      expect(replacement.id).not.toBe(calendarEvent.id)
      expect(replacement.tags).toContainEqual(["h", communityId])
      if (departure === "reopen") {
        await expect(modal.locator('input[type="text"]').first()).toHaveValue(
          "Separate unsaved draft",
        )
        await modal.getByRole("button", {name: "Go back", exact: true}).click()
        await expect(modal).toBeHidden()
      }
      // The mock does not echo or retain the replacement: this checks that ACK
      // completion still put it in the app repository after the old form left.
      await followFixtureLink(`/c/${communityNaddr}/calendar/${replacement.id}?view=calendar`)
      await expect(
        page.getByRole("article").getByText("Acknowledged after departure", {exact: true}),
      ).toBeVisible()
    })
  }
})

const openCalendarEvent = async (
  page: Parameters<typeof seedDevSession>[0],
  mockRelay: MockRelay,
  title = "Calendar reaction scope",
) => {
  await seedDevSession(page)
  await mockRelay.setup(page)
  await page.goto(eventPath)
  await expect(page.getByRole("article").getByText(title, {exact: true})).toBeVisible({
    timeout: 20_000,
  })
}

test.describe("calendar date display", () => {
  test.use({locale: "en-US", timezoneId: "America/Los_Angeles"})

  test("preserves all-day dates and adapts to the available width", async ({page}, testInfo) => {
    await page.setViewportSize({width: 1280, height: 900})
    await openCalendarEvent(
      page,
      new MockRelay({seedEvents: [definition, relayList, profileList, calendarEvent]}),
    )
    const schedule = page.getByRole("article").locator(".calendar-schedule").first()
    await expect(schedule.getByText("Thursday, 1 January 2099", {exact: true})).toBeVisible()
    await expect(schedule.getByText("All day", {exact: true})).toBeVisible()
    await expect(schedule).not.toContainText("UTC")
    await page.screenshot({path: testInfo.outputPath("calendar-date-desktop.png")})

    await page.setViewportSize({width: 320, height: 844})
    await expect(schedule.getByText("Thu, 1 Jan 2099", {exact: true})).toBeVisible()
    expect(await schedule.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
    await page.screenshot({path: testInfo.outputPath("calendar-date-mobile.png")})
  })

  test("shows local event-date offsets and the organizer's timezone", async ({page}) => {
    const timedEvent = finalizeEvent(
      {
        kind: 31923,
        created_at: 3,
        content: "Timezone display fixture",
        tags: [
          ["d", "calendar-reaction-scope"],
          ["h", communityId],
          ["title", "Calendar reaction scope"],
          ["start", String(Date.parse("2026-11-01T08:30:00Z") / 1000)],
          ["end", String(Date.parse("2026-11-01T09:30:00Z") / 1000)],
          ["start_tzid", "Europe/Berlin"],
        ],
      },
      communitySecret,
    )
    await openCalendarEvent(
      page,
      new MockRelay({seedEvents: [definition, relayList, profileList, timedEvent]}),
    )
    const schedule = page.getByRole("article").locator(".calendar-schedule").first()
    await expect(schedule).toContainText("01:30 UTC-07:00")
    await expect(schedule).toContainText("UTC-08:00")
    await schedule.locator("summary").click()
    await expect(schedule).toContainText("Starts 1 November 2026 at 09:30 · UTC+01:00")
    await expect(schedule).toContainText("Ends 1 November 2026 at 10:30 · UTC+01:00")
  })
})

test("publishes calendar reaction additions only to community relays", async ({page}) => {
  const destinations: string[] = []
  const mockRelay = new MockRelay({
    seedEvents: [definition, relayList, profileList, calendarEvent],
    publishResponsesByRelay: {
      [communityRelay]: {outcome: "accept", latency: 250},
      [personalOutboxRelay]: {outcome: "accept", latency: 250},
    },
    onPublish: (event, relay) => {
      if (event.kind === 7) destinations.push(relay)
    },
  })

  await openCalendarEvent(page, mockRelay)
  await page.getByRole("button", {name: "Add reaction"}).click()
  const picker = page.locator("emoji-picker")
  await expect(picker).toBeVisible()
  await picker.evaluate(element => {
    element.dispatchEvent(
      new CustomEvent("emoji-click", {
        detail: {emoji: {unicode: "🔥"}, unicode: "🔥"},
      }),
    )
  })

  await mockRelay.waitForEvent(7)
  await expect.poll(() => destinations).toEqual([communityRelayConnection])
})

test("publishes calendar reaction deletes only to community relays", async ({page}) => {
  const destinations: string[] = []
  const mockRelay = new MockRelay({
    seedEvents: [definition, relayList, profileList, calendarEvent, seededReaction],
    publishResponsesByRelay: {
      [communityRelay]: {outcome: "accept", latency: 250},
      [personalOutboxRelay]: {outcome: "accept", latency: 250},
    },
    onPublish: (event, relay) => {
      if (event.kind === 5) destinations.push(relay)
    },
  })

  await openCalendarEvent(page, mockRelay)
  const reaction = page.getByRole("button", {name: /Click to remove your reaction/})
  await expect(reaction).toBeVisible({timeout: 10_000})
  await reaction.click()

  const deletion = await mockRelay.waitForEvent(5)
  await expect.poll(() => destinations).toEqual([communityRelayConnection])
  expect(deletion.created_at).toBeGreaterThan(seededReaction.created_at)
})

test("projects a replaced calendar reaction delete during rejection and retry", async ({page}) => {
  const destinations: string[] = []
  const mockRelay = new MockRelay({
    seedEvents: [
      definition,
      relayList,
      profileList,
      calendarEvent,
      calendarEventReplacement,
      seededReaction,
    ],
    publishResponsesByRelay: {
      [communityRelay]: {outcome: "reject", latency: 2_000, message: "rejected for test"},
      [personalOutboxRelay]: {outcome: "accept", latency: 250},
    },
    onPublish: (event, relay) => {
      if (event.kind === 5) destinations.push(relay)
    },
  })

  await openCalendarEvent(page, mockRelay, "Calendar reaction scope replacement")
  const reaction = page.getByRole("button", {name: /Click to remove your reaction/})
  await expect(reaction).toBeVisible({timeout: 10_000})

  await reaction.click()
  await expect(reaction).toHaveCount(0, {timeout: 1_000})
  const deletion = await mockRelay.waitForEvent(5)
  await expect(reaction).toBeVisible({timeout: 5_000})

  const recoveryToast = page.getByRole("alert").filter({hasText: "Remove reaction"})
  await recoveryToast.getByRole("button", {name: "Retry", exact: true}).click()
  await expect(reaction).toHaveCount(0, {timeout: 1_000})
  await expect
    .poll(() => mockRelay.getPublishedEvents().filter(event => event.kind === 5).length)
    .toBe(2)
  await expect(reaction).toBeVisible({timeout: 5_000})

  expect(deletion.created_at).toBeGreaterThan(seededReaction.created_at)
  expect(destinations).toEqual([communityRelayConnection, communityRelayConnection])
})
