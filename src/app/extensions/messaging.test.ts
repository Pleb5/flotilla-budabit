import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {finalizeEvent, generateSecretKey, getPublicKey} from "nostr-tools/pure"
import {asDecryptedEvent, readList, type SignedEvent} from "@welshman/util"
import type {CommunityWidgetContext, CommunityWidgetRuntimeContext} from "./types"

const mocks = vi.hoisted(() => ({
  actor: "",
  lists: new Map<string, any>(),
  load: vi.fn(),
  sign: vi.fn(),
  publish: vi.fn(),
  ack: vi.fn(),
  save: vi.fn(),
}))
vi.mock("@welshman/app", () => ({
  pubkey: {
    subscribe: (run: (value: string) => void) => {
      run(mocks.actor)
      return () => {}
    },
  },
  getMessagingRelayList: (key: string) => mocks.lists.get(key),
  forceLoadMessagingRelayList: mocks.load,
  publishThunk: mocks.publish,
  waitForAnyRelayAck: mocks.ack,
  repository: {publish: mocks.save},
}))
vi.mock("@app/core/dm", () => ({
  getDmRelayUrls: (list: any) =>
    list?.event.tags
      .filter((tag: string[]) => tag[0] === "relay" && /^wss?:\/\//.test(tag[1]))
      .map((tag: string[]) => tag[1]) || [],
  getMessagingRelayHints: () => ["wss://index.example/", "wss://outbox.example/"],
  normalizeRelayUrls: (urls: string[]) => [
    ...new Set(urls.filter(url => typeof url === "string" && /^wss?:\/\//.test(url))),
  ],
}))
vi.mock("@app/core/community-relays", () => ({
  getUserDataPublishRelays: (urls: string[]) => [...new Set(urls)],
}))
vi.mock("@app/core/publication", () => ({signEventForPublication: mocks.sign}))
import {ExtensionMessaging} from "./messaging"

const key = generateSecretKey(),
  actor = getPublicKey(key),
  other = getPublicKey(generateSecretKey())
const relay = "wss://community.example/"
const context = {
  definitionAddress: "32222:owner:community",
  contextSessionId: "session",
  contextVersion: 1,
  viewer: {pubkey: actor},
  relays: [relay],
} as CommunityWidgetContext
const runtime = {
  definition: {pointer: {address: context.definitionAddress}, relays: [relay]},
} as CommunityWidgetRuntimeContext
const payload = {expectedPubkey: actor, contextSessionId: "session", contextVersion: 1}
const setupPayload = {...payload, relay}
const list = (tags: string[][], at = 1) =>
  readList(asDecryptedEvent(finalizeEvent({kind: 10050, content: "", created_at: at, tags}, key)))
const instances: ExtensionMessaging[] = []
const setup = (getContext = () => context) => {
  const adapter = new ExtensionMessaging(getContext, () => runtime)
  instances.push(adapter)
  return adapter
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.actor = actor
  mocks.lists.clear()
  mocks.load.mockResolvedValue(undefined)
  mocks.sign.mockImplementation(async event => finalizeEvent(event, key))
  mocks.publish.mockImplementation(() => ({controller: new AbortController()}))
  mocks.ack.mockResolvedValue({status: "success"})
  mocks.save.mockImplementation((event: SignedEvent) =>
    mocks.lists.set(event.pubkey, readList(asDecryptedEvent(event))),
  )
})
afterEach(() => {
  instances.splice(0).forEach(adapter => adapter.close())
  vi.useRealTimers()
})

describe("widget messaging readiness", () => {
  it("uses Chat's cached DM list and checks the recipient separately", async () => {
    mocks.lists.set(actor, list([["relay", relay]]))
    const result = await setup().check({...payload, recipient: other})
    expect(result.self.status).toBe("ready")
    expect(result.recipient?.status).toBe("missing")
    expect(mocks.load).toHaveBeenCalledOnce()
    expect(mocks.load).toHaveBeenCalledWith(
      other,
      expect.arrayContaining([relay, "wss://index.example/", "wss://outbox.example/"]),
    )
    expect(mocks.sign).not.toHaveBeenCalled()
  })
  it("coalesces preload with a publish check and rereads shared settings on every check", async () => {
    let release!: () => void
    mocks.load.mockReturnValue(new Promise<void>(resolve => (release = resolve)))
    const adapter = setup(),
      warm = adapter.check(payload),
      action = adapter.check(payload)
    expect(mocks.load).toHaveBeenCalledOnce()
    release()
    expect((await warm).self.status).toBe("missing")
    expect((await action).self.status).toBe("missing")
    mocks.lists.set(actor, list([["relay", relay]]))
    expect((await adapter.check(payload)).self.status).toBe("ready")
  })
  it("waits for an ACK before exposing setup to Chat and preserves existing list metadata", async () => {
    mocks.lists.set(actor, list([["client", "test"]], Math.floor(Date.now() / 1000) + 5))
    let acknowledge!: () => void
    mocks.ack.mockReturnValue(new Promise<void>(resolve => (acknowledge = resolve)))
    const adapter = setup(),
      pending = adapter.useCommunityRelay(setupPayload)
    await vi.waitFor(() => expect(mocks.ack).toHaveBeenCalledOnce())
    expect(mocks.save).not.toHaveBeenCalled()
    expect(mocks.publish.mock.calls[0][0]).toMatchObject({
      optimistic: false,
      presentation: "private",
      relays: expect.arrayContaining([relay, "wss://index.example/", "wss://outbox.example/"]),
    })
    const event = mocks.publish.mock.calls[0][0].event
    expect(event.pubkey).toBe(actor)
    expect(event.kind).toBe(10050)
    expect(event.tags).toEqual([
      ["client", "test"],
      ["relay", relay],
    ])
    expect(event.created_at).toBeGreaterThan(mocks.lists.get(actor).event.created_at)
    acknowledge()
    expect((await pending).self.status).toBe("ready")
    expect(mocks.save).toHaveBeenCalledWith(event)
    expect((await adapter.check(payload)).self.status).toBe("ready")
  })
  it("never enables messaging when relays reject setup", async () => {
    mocks.ack.mockRejectedValue(new Error("rejected"))
    const adapter = setup()
    await expect(adapter.useCommunityRelay(setupPayload)).rejects.toThrow("No relay confirmed")
    expect(mocks.save).not.toHaveBeenCalled()
    expect((await adapter.check(payload)).self.status).toBe("missing")
    expect(mocks.publish.mock.results[0].value.controller.signal.aborted).toBe(true)
  })
  it("does not overwrite a configured list or accept an arbitrary relay", async () => {
    const adapter = setup()
    await expect(
      adapter.useCommunityRelay({...setupPayload, relay: "wss://untrusted.example/"}),
    ).rejects.toThrow("community")
    mocks.lists.set(actor, list([["relay", "wss://personal.example/"]]))
    expect((await adapter.useCommunityRelay(setupPayload)).self.relays).toEqual([
      "wss://personal.example/",
    ])
    expect(mocks.sign).not.toHaveBeenCalled()
  })
  it("bounds failed discovery and blocks setup until the list can be checked", async () => {
    vi.useFakeTimers()
    mocks.load.mockReturnValue(new Promise(() => {}))
    const adapter = setup(),
      pending = adapter.check(payload)
    await vi.advanceTimersByTimeAsync(8000)
    expect((await pending).self.status).toBe("unavailable")
    await expect(adapter.useCommunityRelay(setupPayload)).rejects.toThrow("could not be checked")
    expect(mocks.sign).not.toHaveBeenCalled()
  })
  it("rejects changed accounts and contexts before discovery or publication", async () => {
    const adapter = setup()
    await expect(adapter.check({...payload, contextVersion: 2})).rejects.toThrow("changed")
    await expect(adapter.check({...payload, recipient: "invalid"})).rejects.toThrow("recipient")
    expect(mocks.load).not.toHaveBeenCalled()
    let release!: (event: any) => void
    mocks.sign.mockImplementation(
      event => new Promise(resolve => (release = () => resolve(finalizeEvent(event, key)))),
    )
    const pending = adapter.useCommunityRelay(setupPayload)
    await vi.waitFor(() => expect(mocks.sign).toHaveBeenCalledOnce())
    mocks.actor = other
    release(undefined)
    await expect(pending).rejects.toThrow("changed")
    expect(mocks.publish).not.toHaveBeenCalled()
  })
  it("rejects detach during preload and concurrent changes while signing", async () => {
    let release!: () => void
    mocks.load.mockReturnValue(new Promise<void>(resolve => (release = resolve)))
    const adapter = setup(),
      pending = adapter.check(payload)
    adapter.close()
    release()
    await expect(pending).rejects.toThrow("closed")
    mocks.load.mockResolvedValue(undefined)
    mocks.sign.mockImplementation(async event => {
      mocks.lists.set(actor, list([["relay", "wss://new.example/"]]))
      return finalizeEvent(event, key)
    })
    await expect(adapter.useCommunityRelay(setupPayload)).rejects.toThrow("changed while signing")
    expect(mocks.publish).not.toHaveBeenCalled()
  })
})
