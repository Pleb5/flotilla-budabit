import {afterEach, describe, expect, it, vi} from "vitest"
import {MockAdapter, publish, publishOne, PublishStatus, setPublishPolicy} from "@welshman/net"
import {makeEvent, type SignedEvent} from "@welshman/util"
import {Nip01Signer} from "@welshman/signer"
import {
  createRelayWriteCapabilityPolicy,
  getUnsupportedRelayKind,
  RELAY_WRITE_CAPABILITY_STORAGE_KEY,
  RELAY_WRITE_CAPABILITY_TTL,
} from "./relay-write-capabilities"

const relay = "wss://relay.example/"
const other = "wss://other.example/"
const denial = "blocked: kind 32222 is not allowed"
const event = (kind = 32222) => ({kind}) as SignedEvent
const restores: Array<() => void> = []
afterEach(() => {
  restores.splice(0).forEach(restore => restore())
  vi.useRealTimers()
})

describe("learned relay write capabilities", () => {
  it("learns only an explicit matching kind denial, scoped to the canonical relay and kind", () => {
    const policy = createRelayWriteCapabilityPolicy()
    expect(policy.check(relay, event())).toBeUndefined()
    policy.observeAck("WSS://RELAY.EXAMPLE", event(), false, denial)
    expect(policy.check(relay, event())).toEqual({detail: denial})
    expect(policy.check(other, event())).toBeUndefined()
    expect(policy.check(relay, event(30222))).toBeUndefined()
    expect(policy.check(relay, event(0))).toBeUndefined()
    policy.observeAck(other, event(30222), false, denial)
    expect(policy.check(other, event())).toBeUndefined()
    expect(policy.check(other, event(30222))).toBeUndefined()
    policy.observeAck(other, event(), undefined as unknown as boolean, denial)
    expect(policy.check(other, event())).toBeUndefined()
  })

  it.each([
    "blocked: kind 32222 is not enabled in this community",
    "blocked: kind 32222 is not allowed for this author",
    "blocked: no current grant for kind 32222",
    "blocked: not on white-list",
    "restricted: Event event must reference an accepted repository or accepted event",
    "blocked: Deletion of kinds 32222 and 30000 is not allowed",
    "rate-limited: kind 32222 is not allowed",
    "auth-required: kind 32222 is not allowed",
    "payment-required: subscription required",
    "invalid: kind 32222 is not allowed",
    "error: relay policy is loading",
    "timed out",
    "blocked: kind 999999 is not allowed",
  ])("does not infer a kind-wide restriction from %s", detail => {
    const policy = createRelayWriteCapabilityPolicy()
    policy.observeAck(relay, event(), false, detail)
    expect(getUnsupportedRelayKind(detail)).toBeUndefined()
    expect(policy.check(relay, event())).toBeUndefined()
  })

  it("expires without a background probe and clears evidence after a later success", () => {
    let time = 1_000
    const policy = createRelayWriteCapabilityPolicy({now: () => time})
    policy.observeAck(relay, event(), false, denial)
    time += RELAY_WRITE_CAPABILITY_TTL - 1
    expect(policy.check(relay, event())).toBeDefined()
    time += 1
    expect(policy.check(relay, event())).toBeUndefined()
    policy.observeAck(relay, event(), false, denial)
    policy.observeAck(relay, event(), true, denial)
    expect(policy.check(relay, event())).toBeUndefined()
  })

  it("persists bounded evidence across reloads and rejects stale or invalid storage", () => {
    let raw = "[]"
    let time = 10_000
    const storage = {
      getItem: vi.fn(() => raw),
      setItem: vi.fn((_key, value) => {
        raw = value
      }),
    }
    const create = () => createRelayWriteCapabilityPolicy({storage, now: () => time})
    const policy = create()
    for (let index = 0; index < 520; index++) {
      policy.observeAck(`wss://relay-${index}.example`, event(), false, denial)
    }
    expect(JSON.parse(raw)).toHaveLength(512)
    expect(create().check("wss://relay-519.example/", event())).toBeDefined()
    expect(storage.getItem).toHaveBeenCalledWith(RELAY_WRITE_CAPABILITY_STORAGE_KEY)
    time += RELAY_WRITE_CAPABILITY_TTL
    expect(create().check("wss://relay-519.example/", event())).toBeUndefined()
    raw = JSON.stringify([{relay, kind: 32222, detail: denial, observedAt: time + 1}])
    expect(create().check(relay, event())).toBeUndefined()
    raw = "invalid json"
    expect(create().check(relay, event())).toBeUndefined()
  })

  it("keeps working when browser storage is denied", () => {
    const fail = () => {
      throw new Error("storage denied")
    }
    const policy = createRelayWriteCapabilityPolicy({storage: {getItem: fail, setItem: fail}})
    policy.observeAck(relay, event(), false, denial)
    expect(policy.check(relay, event())).toEqual({detail: denial})
  })
})

describe("central publishing boundary", () => {
  it("sends the first real event, learns the ACK, then skips before acquiring any adapter", async () => {
    vi.useFakeTimers()
    const policy = createRelayWriteCapabilityPolicy()
    restores.push(setPublishPolicy(policy))
    const signed = await Nip01Signer.ephemeral().sign(makeEvent(32222))
    const send = vi.fn()
    const adapter = new MockAdapter(relay, send)
    const getAdapter = vi.fn(() => adapter)
    const first = publishOne({relay, event: signed, context: {getAdapter}})
    expect(send).toHaveBeenCalledExactlyOnceWith(["EVENT", signed])
    adapter.receive(["OK", "not-this-event", false, denial])
    expect(policy.check(relay, signed)).toBeUndefined()
    adapter.receive(["OK", signed.id, false, denial])
    expect((await first).status).toBe(PublishStatus.Failure)
    const skipped = vi.fn()
    const success = vi.fn()
    const complete = vi.fn()
    const timersBeforeSkip = vi.getTimerCount()
    const second = await publish({
      relays: [relay, "WSS://RELAY.EXAMPLE"],
      event: signed,
      context: {getAdapter},
      onSkipped: skipped,
      onSuccess: success,
      onComplete: complete,
    })
    expect(second[relay]).toEqual({relay, status: PublishStatus.Skipped, detail: denial})
    expect(getAdapter).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledOnce()
    expect(skipped).toHaveBeenCalledOnce()
    expect(complete).toHaveBeenCalledOnce()
    expect(success).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(timersBeforeSkip)
  })

  it("keeps the exact configured timeout and tries again normally after timeout", async () => {
    vi.useFakeTimers()
    const policy = createRelayWriteCapabilityPolicy()
    const observeAck = vi.fn(policy.observeAck)
    restores.push(setPublishPolicy({...policy, observeAck}))
    const signed = await Nip01Signer.ephemeral().sign(makeEvent(30222))
    const send = vi.fn()
    const getAdapter = vi.fn(() => new MockAdapter(relay, send))
    const onTimeout = vi.fn()
    const options = {relay, event: signed, timeout: 1234, context: {getAdapter}, onTimeout}
    const first = publishOne(options)
    await vi.advanceTimersByTimeAsync(1233)
    expect(onTimeout).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect((await first).status).toBe(PublishStatus.Timeout)
    expect(observeAck).not.toHaveBeenCalled()
    expect(policy.check(relay, signed)).toBeUndefined()
    const second = publishOne(options)
    await vi.advanceTimersByTimeAsync(1234)
    expect((await second).status).toBe(PublishStatus.Timeout)
    expect(send).toHaveBeenCalledTimes(2)
    expect(onTimeout).toHaveBeenCalledTimes(2)
  })

  it("settles mixed accepted/skipped destinations without treating a skip as an ACK", async () => {
    const policy = createRelayWriteCapabilityPolicy()
    policy.observeAck(relay, event(), false, denial)
    restores.push(setPublishPolicy(policy))
    const signed = await Nip01Signer.ephemeral().sign(makeEvent(32222))
    const adapter = new MockAdapter(other, vi.fn())
    const getAdapter = vi.fn(() => adapter)
    const onComplete = vi.fn()
    const pending = publish({
      event: signed,
      relays: [relay, other],
      context: {getAdapter},
      onComplete,
    })
    adapter.receive(["OK", signed.id, true, "stored"])
    const results = await pending
    expect(results[relay].status).toBe(PublishStatus.Skipped)
    expect(results[other].status).toBe(PublishStatus.Success)
    expect(getAdapter).toHaveBeenCalledOnce()
    expect(onComplete).toHaveBeenCalledOnce()
  })
})
