import {test, expect} from "@playwright/test"
import {finalizeEvent, getPublicKey, nip19} from "nostr-tools"
import {MockRelay} from "./helpers/mock-relay"

const key = new Uint8Array(32).fill(27),
  pubkey = getPublicKey(key)
const community = "d".repeat(64),
  relay = "wss://private-browser.test/"
const branch = `32222:${pubkey}:${community}`
const memberKey = new Uint8Array(32).fill(40),
  member = getPublicKey(memberKey)
const naddr = nip19.naddrEncode({
  pubkey,
  kind: 32222,
  identifier: community,
  relays: [relay.slice(0, -1)],
})
const invite = `/c/${naddr}?read-access=members`
const definition = finalizeEvent(
  {
    kind: 32222,
    created_at: 100,
    content: "",
    tags: [
      ["d", community],
      ["name", "Private browser fixture"],
      ["r", relay.slice(0, -1)],
      ["read-access", "members"],
      ["content", "General"],
      ["k", "1"],
      ["a", `30000:${pubkey}:${community}-general`],
    ],
  },
  key,
)
const note = finalizeEvent(
  {
    kind: 1,
    created_at: 101,
    content: "Retained private fixture history",
    tags: [
      ["h", community],
      ["a", branch],
    ],
  },
  key,
)
const memberNote = finalizeEvent(
  {
    kind: 1,
    created_at: 102,
    content: "Granted member text fixture",
    tags: [
      ["h", community],
      ["a", branch],
    ],
  },
  memberKey,
)
const wrongBranch = finalizeEvent(
  {
    kind: 1,
    created_at: 103,
    content: "Wrong branch fixture",
    tags: [
      ["h", community],
      ["a", `32222:${member}:${community}`],
    ],
  },
  key,
)
const unsupported = finalizeEvent(
  {
    kind: 11,
    created_at: 104,
    content: "Unsupported kind fixture",
    tags: [
      ["h", community],
      ["a", branch],
    ],
  },
  key,
)

test("cold invitation, consent, denied reader, grant retry without another AUTH, reload and revoke", async ({
  page,
}, info) => {
  const errors: string[] = [],
    signed: number[] = []
  page.on("pageerror", error => errors.push(error.stack || error.message))
  // Do not contact public providers. MockRelay intercepts all remote WebSockets;
  // HTTP requests outside the intended frontend are blocked too.
  await page.route("**/*", route =>
    new URL(route.request().url()).origin === "http://localhost:1847"
      ? route.continue()
      : route.abort(),
  )
  let capability = true,
    maxLimit = 2
  await page.route("https://private-browser.test/**", route =>
    route.fulfill({
      json: {
        limitation: {auth_required: true, max_limit: maxLimit},
        ...(capability
          ? {
              budabit: {
                read_control: {
                  version: 1,
                  mode: "members",
                  scope: "relay",
                  unfiltered_kinds: [1, 5, 1984, 30000, 32222],
                },
              },
            }
          : {}),
      },
    }),
  )
  let granted = false
  const mock = new MockRelay({
    authRequiredRelays: [relay],
    seedEventsByRelay: {[relay]: [definition, note, memberNote, wrongBranch, unsupported]},
    getSubscriptionOutcome: (_filters, url) => (url === relay && !granted ? "denied" : "eose"),
  })
  await mock.setup(page)
  await page.exposeFunction("__privateTestSign", (event: Parameters<typeof finalizeEvent>[0]) => {
    const auth =
      event.kind === 22242 && event.tags.some(tag => tag[0] === "relay" && tag[1] === relay)
    const fixturePost =
      event.kind === 1 &&
      event.content === "Controlled private publication" &&
      event.tags.some(tag => tag[0] === "h" && tag[1] === community)
    if (!auth && !fixturePost) throw Error("Test signer refuses non-fixture operations")
    signed.push(event.kind)
    return finalizeEvent(event, key)
  })
  await page.addInitScript(
    ({pubkey}) => {
      Object.defineProperty(window, "nostr", {
        value: {
          getPublicKey: async () => pubkey,
          signEvent: (event: unknown) => (window as any).__privateTestSign(event),
        },
        configurable: true,
      })
    },
    {pubkey},
  )
  await page.goto(invite)
  const shell = page.getByTestId("private-community-access")
  await expect(shell.getByRole("heading", {name: "Sign in to this private community"})).toBeVisible(
    {timeout: 25000},
  )
  expect((await mock.getTelemetry()).filter(entry => entry.relayUrl === relay)).toEqual([])
  await shell.getByRole("button", {name: "Sign in", exact: true}).click()
  await page.getByRole("button", {name: "Log in with Extension", exact: true}).click()
  await expect(
    shell.getByRole("heading", {name: "Authenticate to the invitation relays"}),
  ).toBeVisible()
  await shell.getByRole("button", {name: "Authenticate and check access"}).click()
  await expect(shell).toHaveAttribute("data-access", "denied")
  await expect(shell.getByText(note.content, {exact: true})).toHaveCount(0)
  expect(signed).toEqual([22242])
  await shell.screenshot({path: info.outputPath("denied.png")})
  granted = true
  await shell.getByRole("button", {name: "Retry access"}).click()
  await expect(shell).toHaveAttribute("data-access", "partial")
  await expect(shell.getByLabel("Private text post")).toHaveCount(0)
  await expect(shell.locator("article")).toHaveCount(0)
  maxLimit = 200
  await shell.getByRole("button", {name: "Retry access"}).click()
  await expect(shell).toHaveAttribute("data-access", "ready")
  await expect(shell.getByText(note.content, {exact: true})).toBeVisible()
  await expect(shell.getByText(memberNote.content, {exact: true})).toHaveCount(0)
  await expect(shell.getByText(wrongBranch.content, {exact: true})).toHaveCount(0)
  await expect(shell.getByText(unsupported.content, {exact: true})).toHaveCount(0)
  const grant = (members: string[], created_at: number) =>
    finalizeEvent(
      {
        kind: 30000,
        content: "",
        created_at,
        tags: [["d", `${community}-general`], ...members.map(member => ["p", member])],
      },
      key,
    )
  await mock.injectEvents([grant([member], 105)])
  await expect(shell.getByText(memberNote.content, {exact: true})).toBeVisible()
  await mock.injectEvents([grant([], 106)])
  await expect(shell.getByText(memberNote.content, {exact: true})).toHaveCount(0)
  await mock.injectEvents([grant([member], 107)])
  await expect(shell.getByText(memberNote.content, {exact: true})).toBeVisible()
  expect(signed).toEqual([22242])
  const requests = (await mock.getTelemetry()).filter(
    entry => entry.type === "req" && entry.relayUrl === relay,
  )
  expect(requests.filter(entry => entry.filters?.some(filter => "since" in filter))).toEqual([])
  expect(
    (await mock.getTelemetry()).filter(
      entry =>
        entry.relayUrl !== relay &&
        entry.filters?.some(filter => JSON.stringify(filter).includes(community)),
    ),
  ).toEqual([])
  await shell.getByLabel("Private text post").fill("Controlled private publication")
  capability = false
  await shell.getByRole("button", {name: "Publish to private relays"}).click()
  await expect(shell.getByRole("alert")).toContainText("Relay does not advertise")
  expect(signed).toEqual([22242])
  expect(mock.getPublishedEvents()).toEqual([])
  capability = true
  await shell.getByRole("button", {name: "Publish to private relays"}).click()
  await expect(shell.getByLabel("Private text post")).toHaveValue("")
  expect(signed).toEqual([22242, 1])
  expect(mock.getPublishedEvents()).toHaveLength(1)
  await shell.screenshot({path: info.outputPath("ready.png")})
  // The private store remains separate even after browser event intake.
  expect(
    await page.evaluate(
      async ({ids}) => {
        const module = await import(
          /* @vite-ignore */ "/packages/welshman/packages/app/src/index.ts"
        )
        return module.repository.query([{ids}]).length
      },
      {ids: [definition.id, note.id, ...mock.getPublishedEvents().map(event => event.id)]},
    ),
  ).toBe(0)
  await page.reload()
  await expect(
    shell.getByRole("heading", {name: "Authenticate to the invitation relays"}),
  ).toBeVisible()
  await shell.getByRole("button", {name: "Authenticate and check access"}).click()
  await expect(shell).toHaveAttribute("data-access", "ready")
  await page.evaluate(relay => {
    for (const socket of (window as any).__mockRelayConnections.values())
      if (socket.url === relay) socket.close()
  }, relay)
  await expect(shell).toHaveAttribute("data-access", "revoked")
  await expect(shell.getByText(note.content, {exact: true})).toHaveCount(0)
  expect(errors).toEqual([])
})
