import {expect, test} from "@playwright/test"
import {finalizeEvent, getPublicKey, nip19} from "nostr-tools"
import {DEV_PUBKEY, DEV_SECRET, seedDevSession} from "./helpers/dev-session"
import {MockRelay} from "./helpers/mock-relay"
import {
  createOverviewMetadataAnnouncement,
  overviewMetadataPath,
  overviewMetadata,
} from "./fixtures/repo-overview-metadata"

const devSecret = Uint8Array.from(Buffer.from(DEV_SECRET, "hex"))
const otherSecret = new Uint8Array(32).fill(7)
const communityId = getPublicKey(new Uint8Array(32).fill(8))
const communityRelay = "wss://routing-community.example"
const applicantRelay = "wss://routing-applicant.example"
const now = Math.floor(Date.now() / 1000)

function fixtures(applicantIsViewer = false, granted = false) {
  const ownerSecret = applicantIsViewer ? otherSecret : devSecret
  const applicantSecret = applicantIsViewer ? devSecret : otherSecret
  const owner = getPublicKey(ownerSecret)
  const applicant = getPublicKey(applicantSecret)
  const address = `32222:${owner}:${communityId}`
  const formAddress = `30168:${owner}:routing-application`
  const authority = [
    ["h", communityId],
    ["a", address, communityRelay, "community"],
  ]
  const definition = finalizeEvent(
    {
      kind: 32222,
      created_at: now - 100,
      content: "",
      tags: [
        ["d", communityId],
        ["name", "Routing Community"],
        ["r", communityRelay],
        ["content", "General"],
        ["k", "1111"],
        ["k", "7"],
        ["k", "1984"],
        ["k", "1985"],
        ["a", `30000:${owner}:${communityId}-general`, communityRelay],
      ],
    },
    ownerSecret,
  )
  const list = finalizeEvent(
    {
      kind: 30000,
      created_at: now - 100,
      content: "",
      tags: [["d", `${communityId}-general`], ...(granted ? [["p", applicant]] : [])],
    },
    ownerSecret,
  )
  const form = finalizeEvent(
    {
      kind: 30168,
      created_at: now - 90,
      content: "",
      tags: [
        ["d", "routing-application"],
        ...authority,
        ["content", "General"],
        ["name", "Routing application"],
        ["field", "q1", "text", "Why join?"],
      ],
    },
    ownerSecret,
  )
  const response = finalizeEvent(
    {
      kind: 1069,
      created_at: now - 60,
      content: "",
      tags: [...authority, ["a", formAddress, "", "form"], ["response", "q1", "To participate."]],
    },
    applicantSecret,
  )
  const relayList = finalizeEvent(
    {kind: 10002, created_at: now - 100, content: "", tags: [["r", applicantRelay]]},
    applicantSecret,
  )
  const review = (content: "+" | "-", createdAt = now - 10) =>
    finalizeEvent(
      {
        kind: 7,
        created_at: createdAt,
        content,
        tags: [
          ...authority,
          ["e", response.id, "", "", "response"],
          ["p", applicant],
          ["k", "1069"],
          ["a", formAddress, "", "form"],
          ["content", "General"],
          ["relay", communityRelay],
        ],
      },
      ownerSecret,
    )
  const path = `/c/${nip19.naddrEncode({kind: 32222, pubkey: owner, identifier: communityId, relays: [communityRelay]})}`
  return {address, path, definition, list, form, response, relayList, review}
}

for (const action of ["Grant", "Reject", "Revoke"] as const) {
  test(`${action} publishes the decision only to definition relays`, async ({page}) => {
    const fixture = fixtures(false, action === "Revoke")
    const destinations: string[] = []
    await seedDevSession(page)
    const relay = new MockRelay({
      seedEvents: [
        fixture.definition,
        fixture.list,
        fixture.form,
        fixture.response,
        fixture.relayList,
        ...(action === "Revoke" ? [fixture.review("+", now - 30)] : []),
      ],
      onPublish: (event, relay) => {
        if (event.kind === 7) destinations.push(relay)
      },
    })
    await relay.setup(page)
    await page.goto(`${fixture.path}/moderation`)
    if (action === "Revoke") await page.locator("summary").filter({hasText: "Granted"}).click()
    await page.getByRole("button", {name: action, exact: true}).click()
    await page
      .getByRole("dialog")
      .getByRole("button", {name: action === "Revoke" ? "Revoke access" : action, exact: true})
      .click()
    const decision = await relay.waitForEvent(7)
    expect(decision.content).toBe(action === "Grant" ? "+" : "-")
    await expect.poll(() => destinations).toEqual([`${communityRelay}/`])
  })
}

test("a first application persists outcome context before membership exists", async ({page}) => {
  const fixture = fixtures(true)
  const destinations: string[] = []
  await seedDevSession(page)
  const relay = new MockRelay({
    seedEvents: [fixture.definition, fixture.list, fixture.form, fixture.relayList],
    onPublish: (event, relay) => {
      if (event.kind === 1069) destinations.push(relay)
    },
  })
  await relay.setup(page)
  await page.goto(`${fixture.path}/access`)
  await page.locator("form textarea").fill("I would like to participate.")
  await page.getByRole("button", {name: "Submit application", exact: true}).click()
  await relay.waitForEvent(1069)
  expect(destinations).toEqual([`${communityRelay}/`])
  const retained = () =>
    page.evaluate(
      account =>
        JSON.parse(localStorage.getItem("community.applicationOutcomeContexts") || "{}")[account],
      DEV_PUBKEY,
    )
  expect(await retained()).toEqual([{address: fixture.address, relays: [`${communityRelay}/`]}])
  await page.goto("/git")
  await page.reload()
  expect(await retained()).toEqual([{address: fixture.address, relays: [`${communityRelay}/`]}])
})

for (const outcome of ["denied", "revoked"] as const) {
  test(`discovers community-only ${outcome} outcome after refresh without membership`, async ({
    page,
  }, info) => {
    const fixture = fixtures(true)
    await seedDevSession(page)
    await page.addInitScript(
      ({account, address, relay}) => {
        if (!localStorage.getItem("community.applicationOutcomeContexts")) {
          localStorage.setItem(
            "community.applicationOutcomeContexts",
            JSON.stringify({[account]: [{address, relays: [relay]}]}),
          )
        }
      },
      {account: DEV_PUBKEY, address: fixture.address, relay: communityRelay},
    )
    const relay = new MockRelay({
      seedEvents: [fixture.relayList],
      seedEventsByRelay: {
        [communityRelay]: [
          fixture.definition,
          fixture.list,
          fixture.form,
          fixture.response,
          ...(outcome === "revoked" ? [fixture.review("+", now - 30)] : []),
          fixture.review("-"),
        ],
      },
    })
    await relay.setup(page)
    await page.goto("/git")
    const bell = page.getByRole("button", {name: "Notifications", exact: true})
    await bell.click()
    const dialog = page.getByRole("dialog", {name: "Notifications", exact: true})
    const result = dialog.getByText(
      outcome === "revoked"
        ? "revoked your access to publish in"
        : "denied your request to publish in",
      {exact: true},
    )
    await expect(result).toBeVisible({timeout: 20_000})
    await page.reload()
    await bell.click()
    await expect(result).toBeVisible({timeout: 20_000})
    await page.screenshot({path: info.outputPath(`community-only-${outcome}.png`)})
    expect(relay.getPublishedEvents()).toEqual([])
  })
}

for (const selection of ["personal", "community", "both"] as const) {
  test(`repository details preserve ${selection} star selection and removal destinations`, async ({
    page,
  }, info) => {
    const fixture = fixtures()
    const published: Array<{kind: number; relay: string}> = []
    await seedDevSession(page)
    if (selection === "community") await page.setViewportSize({width: 390, height: 844})
    const relay = new MockRelay({
      seedEvents: [createOverviewMetadataAnnouncement(), fixture.definition, fixture.list],
      onPublish: (event, relay) => {
        published.push({kind: event.kind, relay})
      },
    })
    await relay.setup(page)
    await page.route("https://**", route =>
      route.fulfill({status: 503, body: "External fixture services unavailable"}),
    )
    await page.goto(overviewMetadataPath)
    const collect = page.locator("button[data-collection-status]")
    await expect(collect).toHaveAttribute("data-collection-status", "uncollected", {
      timeout: 20_000,
    })
    await collect.click()
    const personal = page.getByRole("checkbox", {name: "Personal", exact: true})
    const community = page.getByRole("checkbox", {name: "Routing Community", exact: true})
    await expect(community).toBeEnabled()
    if (selection !== "community") await personal.check()
    if (selection !== "personal") await community.check()
    await page.getByRole("button", {name: "Update", exact: true}).click()
    await expect(page.getByRole("heading", {name: "Edit collections"})).toHaveCount(0)
    const stars = selection === "both" ? 2 : 1
    const targets = selection === "personal" ? 0 : 1
    await expect.poll(() => published.filter(item => item.kind === 7).length).toBe(stars)
    expect(published.filter(item => item.kind === 7).map(item => item.relay)).toEqual(
      Array(stars).fill(overviewMetadata.relays[0]),
    )
    expect(published.filter(item => item.kind === 30222).map(item => item.relay)).toEqual(
      Array(targets).fill(`${communityRelay}/`),
    )
    await expect(collect).toHaveAttribute("data-collection-status", "collected")
    await collect.click()
    await expect(personal).toBeChecked({checked: selection !== "community"})
    await expect(community).toBeChecked({checked: selection !== "personal"})
    await expect(page.getByRole("button", {name: "Update", exact: true})).toBeDisabled()
    await page.screenshot({
      path: info.outputPath(`repo-collection-${selection}.png`),
      animations: "disabled",
    })
    await personal.uncheck()
    await community.uncheck()
    await page.getByRole("button", {name: "Update", exact: true}).click()
    await expect.poll(() => published.filter(item => item.kind === 5).length).toBe(stars + targets)
    expect(
      published
        .filter(item => item.kind === 5)
        .map(item => item.relay)
        .sort(),
    ).toEqual(
      [
        ...Array(stars).fill(overviewMetadata.relays[0]),
        ...Array(targets).fill(`${communityRelay}/`),
      ].sort(),
    )
    await expect(collect).toHaveAttribute("data-collection-status", "uncollected")
  })
}
