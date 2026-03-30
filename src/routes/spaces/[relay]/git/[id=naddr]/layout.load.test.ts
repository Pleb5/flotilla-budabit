import {describe, expect, it, vi} from "vitest"
import {nip19} from "nostr-tools"

type LayoutResult = {
  url: string
  repoId: string
  repoName: string
  repoPubkey: string
  fallbackRelays: string[]
  naddrRelays: string[]
  id: string
  relay: string
}

const mkLoadEvent = (params: {id: string; relay: string}) =>
  ({
    params,
    data: null,
    route: {},
    url: new URL("https://example.com"),
    fetch: () => Promise.resolve(new Response()),
    setHeaders: () => {},
    parent: () => Promise.resolve({}),
    depends: () => {},
    untrack: (fn: () => void) => fn(),
    tracing: {},
  }) as any

vi.mock("@app/core/state", () => ({
  decodeRelay: vi.fn((url: string) => (url === "encoded-relay" ? "wss://relay.example.com" : url)),
}))

vi.mock("@src/lib/budabit/state", () => ({
  getRepoAnnouncementRelays: vi.fn(() => ["wss://fallback.relay.example.com"]),
}))

vi.mock("@nostr-git/core/utils", () => ({
  normalizeRelayUrl: vi.fn((u: string) => (u && u.startsWith("wss") ? u : "")),
  parseRepoId: vi.fn((id: string) => {
    if (!id || !id.includes(":")) throw new Error("Invalid repoId")
    return id.replace(":", "/")
  }),
}))

const VALID_PUBKEY = "a".repeat(64)
const VALID_IDENTIFIER = "flotilla-budabit"

describe("git [id=naddr] layout load", () => {
  it("returns repoId, repoName, repoPubkey, url, fallbackRelays, naddrRelays, and params", async () => {
    const naddr = nip19.naddrEncode({
      kind: 30617,
      pubkey: VALID_PUBKEY,
      identifier: VALID_IDENTIFIER,
      relays: [],
    })
    const {load} = await import("./+layout")
    const result = (await load(mkLoadEvent({id: naddr, relay: "encoded-relay"}))) as LayoutResult

    expect(result).toMatchObject({
      url: "wss://relay.example.com",
      repoId: `${VALID_PUBKEY}:${VALID_IDENTIFIER}`,
      repoName: VALID_IDENTIFIER,
      repoPubkey: VALID_PUBKEY,
      id: naddr,
      relay: "encoded-relay",
    })
    expect(result.fallbackRelays).toEqual(["wss://fallback.relay.example.com"])
    expect(result.naddrRelays).toEqual([])
  })

  it("populates naddrRelays when naddr has relay hints", async () => {
    const naddr = nip19.naddrEncode({
      kind: 30617,
      pubkey: VALID_PUBKEY,
      identifier: VALID_IDENTIFIER,
      relays: ["wss://hint.relay.example.com", "wss://other.relay.example.com"],
    })
    const {load} = await import("./+layout")
    const result = (await load(mkLoadEvent({id: naddr, relay: "encoded-relay"}))) as LayoutResult

    expect(result.naddrRelays).toEqual([
      "wss://hint.relay.example.com",
      "wss://other.relay.example.com",
    ])
  })

  it("filters out invalid relay URLs from naddrRelays", async () => {
    const {normalizeRelayUrl} = await import("@nostr-git/core/utils")
    vi.mocked(normalizeRelayUrl).mockImplementation((u: string) => {
      if (u === "wss://valid.relay.com" || u === "wss://also-valid.relay.com") return u
      return ""
    })

    const naddr = nip19.naddrEncode({
      kind: 30617,
      pubkey: VALID_PUBKEY,
      identifier: VALID_IDENTIFIER,
      relays: ["wss://valid.relay.com", "invalid", "wss://also-valid.relay.com"],
    })

    const {load} = await import("./+layout")
    const result = (await load(mkLoadEvent({id: naddr, relay: "encoded-relay"}))) as LayoutResult

    expect(result.naddrRelays).toEqual(["wss://valid.relay.com", "wss://also-valid.relay.com"])
  })

  it("throws when parseRepoId rejects repoId", async () => {
    const {parseRepoId} = await import("@nostr-git/core/utils")
    vi.mocked(parseRepoId).mockImplementationOnce(() => {
      throw new Error("Invalid repoId")
    })

    const naddr = nip19.naddrEncode({
      kind: 30617,
      pubkey: VALID_PUBKEY,
      identifier: VALID_IDENTIFIER,
      relays: [],
    })
    const {load} = await import("./+layout")

    await expect(load(mkLoadEvent({id: naddr, relay: "encoded-relay"}))).rejects.toThrow(
      /Invalid repoId.*Expected canonical repoId/,
    )
  })
})
