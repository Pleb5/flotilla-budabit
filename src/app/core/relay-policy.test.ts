import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {forceLoadRelayMock} = vi.hoisted(() => ({
  forceLoadRelayMock: vi.fn(),
}))

vi.mock("@welshman/app", async importOriginal => {
  const actual = await importOriginal<typeof import("@welshman/app")>()

  return {...actual, forceLoadRelay: forceLoadRelayMock}
})

import {relaysByUrl} from "@welshman/app"
import {Socket, SocketEvent, SocketStatus} from "@welshman/net"
import {
  getRelayPolicy,
  getRelayRequestPolicy,
  relayPolicyRefreshPolicy,
  RELAY_POLICY_REFRESH_INTERVAL,
  refreshRelayPolicy,
} from "./relay-policy"

const publicRelay = "wss://relay.budabit.club/"
const metadataRelay = "wss://metadata.example/"
const unknownRelay = "wss://unknown.example/"

const defaultRequestPolicy = {
  maxSubscriptions: 16,
  maxFiltersPerSubscription: 10,
  maxLiveSubscriptions: 12,
  maxBackgroundLiveSubscriptions: 8,
  criticalLivePriority: 200,
  maxMessageBytes: 128 * 1024,
}

beforeEach(() => {
  forceLoadRelayMock.mockResolvedValue(undefined)
})

afterEach(() => {
  relaysByUrl.set(new Map())
  forceLoadRelayMock.mockReset()
  vi.useRealTimers()
})

describe("relay policy", () => {
  it("applies the explicit public Budabit relay limits", () => {
    expect(getRelayPolicy(publicRelay)).toEqual({
      auth: "none",
      ...defaultRequestPolicy,
      maxSubscriptions: 28,
      maxLiveSubscriptions: 24,
      maxBackgroundLiveSubscriptions: 18,
      maxLimit: 200,
    })
    expect(getRelayRequestPolicy(publicRelay)).toEqual({
      ...defaultRequestPolicy,
      maxSubscriptions: 28,
      maxLiveSubscriptions: 24,
      maxBackgroundLiveSubscriptions: 18,
    })
  })

  it("uses the direct Budabit limits for unknown relays", () => {
    expect(getRelayPolicy(unknownRelay)).toEqual({
      auth: "optional",
      ...defaultRequestPolicy,
    })
    expect(getRelayRequestPolicy(unknownRelay)).toEqual(defaultRequestPolicy)
  })

  it("lets stricter NIP-11 subscription limits win", () => {
    relaysByUrl.set(
      new Map([
        [
          metadataRelay,
          {
            url: metadataRelay,
            limitation: {max_subscriptions: 4},
          } as any,
        ],
      ]),
    )

    expect(getRelayRequestPolicy(metadataRelay)).toEqual({
      ...defaultRequestPolicy,
      maxSubscriptions: 4,
      maxLiveSubscriptions: 2,
      maxBackgroundLiveSubscriptions: 2,
    })
  })

  it("uses available NIP-11 limits and authentication metadata", () => {
    relaysByUrl.set(
      new Map([
        [
          metadataRelay,
          {
            url: metadataRelay,
            supported_nips: ["42"],
            limitation: {
              auth_required: true,
              max_subscriptions: 12,
              max_message_length: 64 * 1024,
              max_limit: 500,
            },
          } as any,
        ],
      ]),
    )

    expect(getRelayPolicy(metadataRelay)).toEqual({
      auth: "required",
      ...defaultRequestPolicy,
      maxSubscriptions: 12,
      maxLiveSubscriptions: 10,
      maxMessageBytes: 64 * 1024,
      maxLimit: 500,
    })
  })

  it("does not authenticate relays that advertise no NIP-42 support", () => {
    relaysByUrl.set(
      new Map([[metadataRelay, {url: metadataRelay, supported_nips: ["1", "11"]}]]),
    )

    expect(getRelayPolicy(metadataRelay).auth).toBe("none")
  })

  it("refreshes NIP-11 metadata without blocking first policy use", () => {
    const relay = "wss://first-use.example/"
    forceLoadRelayMock.mockReturnValue(new Promise(() => undefined))

    expect(getRelayRequestPolicy(relay)).toEqual(defaultRequestPolicy)
    expect(forceLoadRelayMock).toHaveBeenCalledOnce()
    expect(forceLoadRelayMock).toHaveBeenCalledWith(relay)
  })

  it("refreshes metadata about hourly while policy remains active", async () => {
    const relay = "wss://active-policy.example/"
    const startedAt = new Date("2026-07-15T00:00:00Z")
    vi.useFakeTimers()
    vi.setSystemTime(startedAt)
    forceLoadRelayMock.mockResolvedValue(undefined)

    getRelayPolicy(relay)
    await refreshRelayPolicy(relay)

    vi.setSystemTime(startedAt.getTime() + RELAY_POLICY_REFRESH_INTERVAL - 1)
    getRelayPolicy(relay)
    expect(forceLoadRelayMock).toHaveBeenCalledTimes(1)

    vi.setSystemTime(startedAt.getTime() + RELAY_POLICY_REFRESH_INTERVAL)
    getRelayPolicy(relay)
    expect(forceLoadRelayMock).toHaveBeenCalledTimes(2)
  })

  it("forces a metadata refresh when a socket reconnects", () => {
    const relay = "wss://reconnected-policy.example/"
    const socket = new Socket(relay, [])
    const unsubscribe = relayPolicyRefreshPolicy(socket)
    forceLoadRelayMock.mockResolvedValue(undefined)

    socket.emit(SocketEvent.Status, SocketStatus.Open, relay)

    expect(forceLoadRelayMock).toHaveBeenCalledOnce()
    expect(forceLoadRelayMock).toHaveBeenCalledWith(relay)
    unsubscribe()
    socket.cleanup()
  })
})
