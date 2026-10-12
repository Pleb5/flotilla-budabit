import {afterEach, describe, expect, it, vi} from "vitest"
import {finalizeEvent, getPublicKey} from "nostr-tools/pure"
import {Router} from "@welshman/router"
import {repository} from "@welshman/app"

const mocks = vi.hoisted(() => ({load: vi.fn(), outbox: vi.fn().mockResolvedValue(undefined)}))
vi.mock("@welshman/net", async original => {
  const actual = await original<typeof import("@welshman/net")>()
  return {
    ...actual,
    makeLoader: (options: any) =>
      options.delay === 0 && options.threshold === 1 ? mocks.load : actual.makeLoader(options),
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
        expect(options.relays).toEqual(hints)
        expect(options.filters).toEqual([{kinds: [10050], authors: [author], limit: 1}])
        options.onEose()
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
      mocks.load.mockResolvedValue([configured])
      expect(await checkDmInboxRelayList(author, hints)).toBe(true)
    }
  })
})
