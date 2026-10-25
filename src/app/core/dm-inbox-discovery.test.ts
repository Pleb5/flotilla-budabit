import {afterEach, describe, expect, it, vi} from "vitest"
import {finalizeEvent, getPublicKey} from "nostr-tools/pure"
import {Router} from "@welshman/router"
import {repository} from "@welshman/app"
import {INDEXER_RELAYS} from "./state"

const mocks = vi.hoisted(() => ({load: vi.fn(), outbox: vi.fn().mockResolvedValue(undefined)}))
vi.mock("./state", async original => ({
  ...(await original<typeof import("./state")>()),
  INDEXER_RELAYS: ["wss://indexer.example/"],
}))
vi.mock("@welshman/net", async original => {
  const actual = await original<typeof import("@welshman/net")>()
  return {
    ...actual,
    request: mocks.load,
  }
})
vi.mock("@welshman/app", async original => ({
  ...(await original<typeof import("@welshman/app")>()),
  forceLoadMessagingRelayList: mocks.outbox,
}))
import {checkDmInboxRelayList} from "./dm"

afterEach(() => {
  vi.restoreAllMocks()
  repository.clear()
})

describe("complete DM inbox metadata discovery", () => {
  it("queries all membership relays for either participant despite a cached older list", async () => {
    vi.spyOn(Router, "get").mockReturnValue({FromPubkeys: () => ({getUrls: () => []})} as any)
    const hints = Array.from({length: 7}, (_, i) => `wss://membership-${i}.example/`)
    for (const seed of [41, 42]) {
      const key = new Uint8Array(32).fill(seed)
      const author = getPublicKey(key)
      const old = finalizeEvent(
        {kind: 10050, created_at: 1, content: "", tags: [["relay", "wss://old-inbox.example/"]]},
        key,
      )
      repository.publish(old)
      // A newer empty list on the seventh relay must supersede the cached inbox.
      const latest = finalizeEvent({kind: 10050, created_at: 2, content: "", tags: []}, key)
      mocks.load.mockImplementation(async options => {
        expect(options.relays).toEqual([...new Set([...INDEXER_RELAYS, ...hints])])
        expect(options.filters[0]).toMatchObject({authors: [author]})
        expect(options.filters[0].limit).toBe(options.filters[0].kinds[0] === 10050 ? 1 : 200)
        options.relays.forEach(options.onEose)
        return [latest]
      })
      expect(await checkDmInboxRelayList(author, hints)).toBe(false)
      const configured = finalizeEvent(
        {
          kind: 10050,
          created_at: 3,
          content: "",
          tags: [["relay", "wss://recipient-inbox.example/"]],
        },
        key,
      )
      mocks.load.mockImplementation(async options => {
        options.relays.forEach(options.onEose)
        return [configured]
      })
      expect(await checkDmInboxRelayList(author, hints)).toBe(true)
    }
  })

  it("queries configured indexers even without caller hints and selects their newer list", async () => {
    vi.spyOn(Router, "get").mockReturnValue({FromPubkeys: () => ({getUrls: () => []})} as any)
    const key = new Uint8Array(32).fill(43)
    const author = getPublicKey(key)
    const old = finalizeEvent({kind: 10050, created_at: 1, content: "", tags: []}, key)
    const latest = finalizeEvent(
      {kind: 10050, created_at: 2, content: "", tags: [["relay", "wss://inbox.example/"]]},
      key,
    )
    repository.publish(old)
    mocks.load.mockImplementation(async options => {
      expect(options.relays).toEqual(INDEXER_RELAYS)
      options.relays.forEach(options.onEose)
      return [latest, old]
    })
    expect(await checkDmInboxRelayList(author, [])).toBe(true)
  })

  it("does not establish absence from only one completed community source", async () => {
    vi.spyOn(Router, "get").mockReturnValue({FromPubkeys: () => ({getUrls: () => []})} as any)
    mocks.load.mockImplementation(async options => {
      options.onEose("wss://community.example/")
      return []
    })
    await expect(
      checkDmInboxRelayList(getPublicKey(new Uint8Array(32).fill(44)), [
        "wss://community.example/",
        "wss://indexer.example/",
      ]),
    ).rejects.toThrow("all DM inbox")
  })

  it("ignores wrong authors, bad signatures and future events", async () => {
    vi.spyOn(Router, "get").mockReturnValue({FromPubkeys: () => ({getUrls: () => []})} as any)
    const key = new Uint8Array(32).fill(45)
    const author = getPublicKey(key)
    const template = {
      kind: 10050,
      created_at: 2,
      content: "",
      tags: [["relay", "wss://inbox.example/"]],
    }
    const signed = finalizeEvent(template, key)
    mocks.load.mockImplementation(async options => {
      options.relays.forEach(options.onEose)
      return [
        finalizeEvent(template, new Uint8Array(32).fill(46)),
        JSON.parse(JSON.stringify({...signed, sig: "0".repeat(128)})),
        finalizeEvent({...template, created_at: Math.floor(Date.now() / 1000) + 600}, key),
      ]
    })
    expect(await checkDmInboxRelayList(author, ["wss://community.example/"])).toBe(false)
  })

  it("honors same-author deletions without resurrecting an older cached inbox", async () => {
    vi.spyOn(Router, "get").mockReturnValue({FromPubkeys: () => ({getUrls: () => []})} as any)
    const key = new Uint8Array(32).fill(47)
    const author = getPublicKey(key)
    const template = {
      kind: 10050,
      created_at: 1,
      content: "",
      tags: [["relay", "wss://inbox.example/"]],
    }
    repository.publish(finalizeEvent(template, key))
    const latest = finalizeEvent({...template, created_at: 2}, key)
    const deletion = finalizeEvent(
      {kind: 5, created_at: 3, content: "", tags: [["e", latest.id]]},
      key,
    )
    mocks.load.mockImplementation(async options => {
      options.relays.forEach(options.onEose)
      return [latest, deletion]
    })
    expect(await checkDmInboxRelayList(author, [])).toBe(false)
  })

  it("treats saturated deletion history as incomplete rather than confirmed absence", async () => {
    vi.spyOn(Router, "get").mockReturnValue({FromPubkeys: () => ({getUrls: () => []})} as any)
    mocks.load.mockImplementation(async options => {
      for (let i = 0; i < 200; i++) options.onEvent?.({kind: 5}, options.relays[0])
      options.relays.forEach(options.onEose)
      return []
    })
    await expect(
      checkDmInboxRelayList(getPublicKey(new Uint8Array(32).fill(48)), []),
    ).rejects.toThrow("all DM inbox")
  })
})
