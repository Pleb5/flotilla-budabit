import {expect, test} from "@playwright/test"
import {DEV_SECRET, seedDevSession} from "./helpers/dev-session"
import {MockRelay} from "./helpers/mock-relay"
import {moderationApplicationsFixture} from "./helpers/moderation-applications"

const fixture = moderationApplicationsFixture(Uint8Array.from(Buffer.from(DEV_SECRET, "hex")))

test("same-author profiles stay consistent across decisions, modal, hidden and restored applications", async ({
  page,
}, info) => {
  const errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  await page.route(/^https:\/\//, route => route.fulfill({json: {}}))
  await seedDevSession(page)
  const relay = new MockRelay({
    seedEvents: [...fixture.events, fixture.profile],
    responseLatencyByKind: {0: 1500},
  })
  await relay.setup(page)
  await page.goto(fixture.path)
  const group = (label: string) =>
    page
      .locator("details")
      .filter({has: page.locator(":scope > summary h3", {hasText: new RegExp(`^${label}$`)})})
  try {
    await expect(group("New").locator("article")).toHaveCount(1, {timeout: 20_000})
  } catch (error) {
    await page.screenshot({path: info.outputPath("moderation-load-failure.png")})
    console.log({errors, body: await page.locator("body").innerText()})
    throw error
  }
  await group("Granted").locator(":scope > summary").click()
  await group("Rejected").locator(":scope > summary").click()
  await expect(group("Granted").locator("article")).toHaveCount(1)
  await expect(group("Rejected").locator("article")).toHaveCount(1)
  // All rows are mounted before metadata arrives, as with a delayed relay response.
  for (const label of ["New", "Granted", "Rejected"]) {
    await expect(
      group(label).getByRole("button", {name: "@Shared Applicant", exact: true}),
    ).toBeVisible()
  }
  await group("Granted").getByRole("button", {name: "@Shared Applicant", exact: true}).click()
  await expect(page.getByText("One author, three applications", {exact: true})).toBeVisible()
  await page
    .getByTestId("modal-root")
    .evaluate(element =>
      Promise.all(element.getAnimations({subtree: true}).map(animation => animation.finished)),
    )
  await page.screenshot({path: info.outputPath("moderation-profile-modal.png")})
  await page.getByRole("button", {name: "Go back", exact: true}).click()
  await expect(page.getByTestId("modal-root").locator(":scope > div")).toHaveCount(0)
  await group("New").getByRole("button", {name: "Hide", exact: true}).click()
  await expect(group("New").locator("article")).toHaveCount(0)
  await expect(group("Granted").locator("article")).toHaveCount(1)
  await expect(group("Rejected").locator("article")).toHaveCount(1)
  await group("Hidden").locator(":scope > summary").click()
  await expect(
    group("Hidden").getByRole("button", {name: "@Shared Applicant", exact: true}),
  ).toBeVisible()
  await group("Hidden").getByRole("button", {name: "@Shared Applicant", exact: true}).click()
  await expect(page.getByText("One author, three applications", {exact: true})).toBeVisible()
  await page.getByRole("button", {name: "Go back", exact: true}).click()
  await expect(page.getByTestId("modal-root").locator(":scope > div")).toHaveCount(0)
  await group("Hidden").getByRole("button", {name: "Restore", exact: true}).scrollIntoViewIfNeeded()
  await page.screenshot({path: info.outputPath("moderation-hidden.png")})
  await page.reload()
  await expect(group("New").locator("article")).toHaveCount(0)
  await expect(group("Hidden").locator("article")).toHaveCount(1, {timeout: 20_000})
  // A later community decision does not unhide it. Restore follows its current status.
  await relay.injectEvents([fixture.review(0, true, 10)])
  await group("Hidden").locator(":scope > summary").click()
  await expect(group("Hidden").locator("article")).toContainText("granted")
  await group("Hidden").getByRole("button", {name: "Restore", exact: true}).click()
  await expect(group("Hidden").locator("article")).toHaveCount(0)
  await expect(group("Granted").locator("article")).toHaveCount(2)
  await group("Granted").locator(":scope > summary").click()
  await expect(
    group("Granted").getByRole("button", {name: "@Shared Applicant", exact: true}),
  ).toHaveCount(2)
  expect(relay.getPublishedEvents()).toHaveLength(0)
  expect(errors).toEqual([])
  await page.screenshot({path: info.outputPath("moderation-restored.png")})
  await page.setViewportSize({width: 390, height: 844})
  const hide = group("Granted").getByRole("button", {name: "Hide", exact: true}).first()
  await hide.focus()
  await hide.press("Enter")
  await expect(group("Granted").locator("article")).toHaveCount(1)
  await expect(group("Hidden").locator("article")).toHaveCount(1)
  await group("Hidden").getByRole("button", {name: "Restore", exact: true}).scrollIntoViewIfNeeded()
  await page.screenshot({path: info.outputPath("moderation-hidden-mobile.png")})
  expect(relay.getPublishedEvents()).toHaveLength(0)
})

test("opening a profile retries an empty community metadata read after cooldown", async ({
  page,
}) => {
  await page.route(/^https:\/\//, route => route.fulfill({json: {}}))
  await seedDevSession(page)
  const communityRelay = "wss://moderation-applications.example/"
  const relay = new MockRelay({
    seedEvents: fixture.events,
    getSubscriptionOutcome: (filters, url) =>
      url !== communityRelay && filters.some(filter => filter.kinds?.includes(0))
        ? "denied"
        : undefined,
  })
  await relay.setup(page)
  await page.goto(fixture.path)
  const group = (label: string) =>
    page
      .locator("details")
      .filter({has: page.locator(":scope > summary h3", {hasText: new RegExp(`^${label}$`)})})
  await expect(group("New").locator("article")).toHaveCount(1, {timeout: 20_000})
  const profileRequests = async () =>
    (await relay.getTelemetry()).filter(
      entry =>
        entry.type === "req" &&
        entry.relayUrl === communityRelay &&
        entry.filters?.some(
          filter => filter.kinds?.includes(0) && filter.authors?.includes(fixture.applicant),
        ),
    )
  await expect.poll(async () => (await profileRequests()).length).toBeGreaterThan(0)
  await expect
    .poll(async () => {
      const telemetry = await relay.getTelemetry()
      return (await profileRequests()).every(request =>
        telemetry.some(entry => entry.type === "close" && entry.subId === request.subId),
      )
    })
    .toBe(true)
  const initialCount = (await profileRequests()).length
  await relay.retainEvents([fixture.profile])
  await page.evaluate(() => {
    const now = Date.now.bind(Date)
    Date.now = () => now() + 61_000
  })
  await group("New").locator("article button").first().click()
  await expect(page.getByText("One author, three applications", {exact: true})).toBeVisible()
  await expect.poll(async () => (await profileRequests()).length).toBeGreaterThan(initialCount)
  await page.getByRole("button", {name: "Go back", exact: true}).click()
  for (const label of ["New", "Granted", "Rejected"]) {
    if (label !== "New") await group(label).locator(":scope > summary").click()
    await expect(
      group(label).getByRole("button", {name: "@Shared Applicant", exact: true}),
    ).toBeVisible()
  }
  expect(relay.getPublishedEvents()).toHaveLength(0)
})
