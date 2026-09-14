import {test, expect} from "@playwright/test"
import {finalizeEvent, getPublicKey, nip19} from "nostr-tools"
import {MockRelay} from "./helpers/mock-relay"

const key = new Uint8Array(32).fill(27),
  pubkey = getPublicKey(key)
const community = "d".repeat(64),
  relay = "wss://private-browser.test/"
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
    ],
  },
  key,
)
const note = finalizeEvent(
  {kind: 1, created_at: 101, content: "Retained private fixture history", tags: []},
  key,
)

test("cold invitation, consent, denied reader, grant retry without another AUTH, reload and revoke", async ({
  page,
}, info) => {
  const errors: string[] = [],
    signed: number[] = []
  page.on("pageerror", error => errors.push(error.message))
  // Do not contact public providers. MockRelay intercepts all remote WebSockets;
  // HTTP requests outside the intended frontend are blocked too.
  await page.route("**/*", route =>
    new URL(route.request().url()).origin === "http://localhost:1847"
      ? route.continue()
      : route.abort(),
  )
  let granted = false
  const mock = new MockRelay({
    authRequiredRelays: [relay],
    seedEventsByRelay: {[relay]: [definition, note]},
    getSubscriptionOutcome: (_filters, url) => (url === relay && !granted ? "denied" : "eose"),
  })
  await mock.setup(page)
  await page.exposeFunction("__privateTestSign", (event: Parameters<typeof finalizeEvent>[0]) => {
    if (event.kind !== 22242 || !event.tags.some(tag => tag[0] === "relay" && tag[1] === relay))
      throw Error("Test signer refuses any non-private AUTH or publication")
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
  await expect(
    shell.getByRole("heading", {name: "Sign in to this private community"}),
  ).toBeVisible()
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
  await expect(shell).toHaveAttribute("data-access", "ready")
  await expect(shell.getByText(note.content, {exact: true})).toBeVisible()
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
      {ids: [definition.id, note.id]},
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
