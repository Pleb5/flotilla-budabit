import {get} from "svelte/store"
import {afterEach, describe, expect, it, vi} from "vitest"
import {PublishStatus, type PublishResultsByRelay, type PublishOptions} from "@welshman/net"
import type {SignedEvent} from "@welshman/util"
import {
  clearRelayDeliveries,
  dismissRelayDelivery,
  recordRelayDelivery,
  relayDeliveryNotices,
  retryRelayDelivery,
  trackConfirmedRelayDelivery,
} from "./relay-publish-delivery"

const owner = "a".repeat(64)
const event: SignedEvent = {
  id: "b".repeat(64),
  pubkey: owner,
  sig: "c".repeat(128),
  kind: 11,
  created_at: 1,
  content: "test",
  tags: [],
}
const good = "wss://good.example/"
const bad = "wss://bad.example/"
const result = (relay: string, status: PublishStatus, detail = "") => ({relay, status, detail})
const mixed = (): PublishResultsByRelay => ({
  [good]: result(good, PublishStatus.Success),
  [bad]: result(bad, PublishStatus.Failure, "error: relay policy is loading, retry shortly"),
})

afterEach(() => {
  clearRelayDeliveries()
  vi.useRealTimers()
})

describe("relay delivery recovery", () => {
  it("revalidates permissions before resending a confirmed operation's failed destinations", async () => {
    const validate = vi.fn(async () => {
      throw new Error("grant was revoked")
    })
    recordRelayDelivery(event, mixed(), "Thread", undefined, validate)
    const publish = vi.fn(async () => ({}))
    await expect(retryRelayDelivery(event.id, owner, publish)).rejects.toThrow("grant was revoked")
    expect(validate).toHaveBeenCalledWith(event)
    expect(publish).not.toHaveBeenCalled()
  })
  it("clears an old failure report when the same event succeeds on a later attempt", () => {
    recordRelayDelivery(event, mixed())
    recordRelayDelivery(event, {
      [good]: result(good, PublishStatus.Success),
      [bad]: result(bad, PublishStatus.Success),
    })
    expect(get(relayDeliveryNotices).size).toBe(0)
  })
  it("captures rejection arriving after the first ACK and stops observing at completion", () => {
    const thunk: {event: SignedEvent; results: PublishResultsByRelay} = {
      event,
      results: {
        [good]: result(good, PublishStatus.Success),
        [bad]: result(bad, PublishStatus.Pending),
      },
    }
    let notify!: (value: typeof thunk) => void
    const stop = vi.fn()
    trackConfirmedRelayDelivery(
      {
        ...thunk,
        subscribe(callback) {
          notify = callback
          callback(thunk)
          return stop
        },
      },
      "Thread",
    )
    expect(get(relayDeliveryNotices).size).toBe(0)
    notify({...thunk, results: mixed()})
    expect(get(relayDeliveryNotices).get(event.id)?.results[bad].detail).toContain("loading")
    expect(stop).toHaveBeenCalledOnce()
  })
  it("retries only failed destinations with the identical signed payload", async () => {
    recordRelayDelivery(event, mixed(), "Thread")
    const publish = vi.fn(async (_options: PublishOptions) => ({
      [bad]: result(bad, PublishStatus.Success),
    }))
    await retryRelayDelivery(event.id, owner, publish)
    expect(publish).toHaveBeenCalledWith({event, relays: [bad], timeout: 12_000})
    expect(publish.mock.calls[0][0].event).toBe(event)
    expect(get(relayDeliveryNotices).size).toBe(0)
  })
  it("preserves successful destinations and the latest exact failure on another rejection", async () => {
    recordRelayDelivery(event, mixed(), "Thread")
    await retryRelayDelivery(event.id, owner, async () => ({
      [bad]: result(bad, PublishStatus.Failure, "rate-limited: too many writes"),
    }))
    const notice = get(relayDeliveryNotices).get(event.id)!
    expect(notice.results[good].status).toBe(PublishStatus.Success)
    expect(notice.results[bad].detail).toBe("rate-limited: too many writes")
    expect(notice.retrying).toBe(false)
  })
  it("does not retry permanent deletion denial, unknown account, or concurrently", async () => {
    const publish = vi.fn(async () => ({}))
    recordRelayDelivery(event, {
      [bad]: result(
        bad,
        PublishStatus.Failure,
        "blocked: Deletion of kinds 32222 and 30000 is not allowed",
      ),
    })
    await expect(retryRelayDelivery(event.id, owner, publish)).rejects.toThrow("needs correcting")
    await expect(retryRelayDelivery(event.id, "different", publish)).rejects.toThrow("account")
    expect(publish).not.toHaveBeenCalled()
    recordRelayDelivery(event, mixed())
    let finish!: (results: PublishResultsByRelay) => void
    const pending = vi.fn(
      () =>
        new Promise<PublishResultsByRelay>(resolve => {
          finish = resolve
        }),
    )
    const first = retryRelayDelivery(event.id, owner, pending)
    await retryRelayDelivery(event.id, owner, pending)
    expect(pending).toHaveBeenCalledOnce()
    finish({[bad]: result(bad, PublishStatus.Success)})
    await first
  })
  it("retains transport exceptions and missing results instead of claiming success", async () => {
    recordRelayDelivery(event, mixed())
    await expect(
      retryRelayDelivery(event.id, owner, async () => {
        throw new Error("connection refused")
      }),
    ).rejects.toThrow("connection refused")
    expect(get(relayDeliveryNotices).get(event.id)?.error).toBe("connection refused")
    await retryRelayDelivery(event.id, owner, async () => ({}))
    expect(get(relayDeliveryNotices).get(event.id)?.results[bad].status).toBe(PublishStatus.Timeout)
  })
  it("dismisses only local recovery and bounds monitor lifetime", () => {
    vi.useFakeTimers()
    const stop = vi.fn()
    trackConfirmedRelayDelivery({event, results: mixed(), subscribe: () => stop}, "Thread")
    vi.advanceTimersByTime(60_000)
    expect(stop).toHaveBeenCalledOnce()
    recordRelayDelivery(event, mixed())
    dismissRelayDelivery(event.id)
    expect(get(relayDeliveryNotices).size).toBe(0)
  })
})
