import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {forceLoadRelayMock, loadRelayMock} = vi.hoisted(() => ({
  forceLoadRelayMock: vi.fn(),
  loadRelayMock: vi.fn(),
}))

vi.mock("@welshman/app", async importOriginal => {
  const actual = await importOriginal<typeof import("@welshman/app")>()

  return {...actual, forceLoadRelay: forceLoadRelayMock, loadRelay: loadRelayMock}
})

import {relaysByUrl} from "@welshman/app"
import {Socket, SocketEvent, SocketStatus} from "@welshman/net"
import {
  getRelayPolicy,
  getRelayRequestPolicy,
  loadRelayPolicy,
  relayPolicyRefreshPolicy,
  RELAY_POLICY_REFRESH_INTERVAL,
  refreshRelayPolicy,
} from "./relay-policy"

const publicRelay = "wss://relay.budabit.club/"
const metadataRelay = "wss://metadata.example/"
const unknownRelay = "wss://unknown.example/"

const defaultRequestPolicy = {
  maxSubscriptions: 28,
  maxFiltersPerSubscription: 10,
  maxLiveSubscriptions: 24,
  maxBackgroundLiveSubscriptions: 18,
  criticalLivePriority: 200,
  maxMessageBytes: 128 * 1024,
}
const defaultRelayPolicy = {...defaultRequestPolicy, maxLimit: 200}

beforeEach(() => {
  forceLoadRelayMock.mockResolvedValue(undefined)
  loadRelayMock.mockResolvedValue(undefined)
})

afterEach(() => {
  relaysByUrl.set(new Map())
  forceLoadRelayMock.mockReset()
  loadRelayMock.mockReset()
  vi.useRealTimers()
})

describe("relay policy", () => {
  it("applies the explicit public Budabit relay limits", () => {
    expect(getRelayPolicy(publicRelay)).toEqual({
      auth: "none",
      ...defaultRelayPolicy,
    })
    expect(getRelayRequestPolicy(publicRelay)).toEqual(defaultRequestPolicy)
  })

  it("uses the direct Budabit limits for unknown relays", () => {
    expect(getRelayPolicy(unknownRelay)).toEqual({
      auth: "optional",
      ...defaultRelayPolicy,
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
      ...defaultRelayPolicy,
      maxSubscriptions: 12,
      maxLiveSubscriptions: 10,
      maxBackgroundLiveSubscriptions: 10,
      maxMessageBytes: 64 * 1024,
    })
  })

  it("does not authenticate relays that advertise no NIP-42 support", () => {
    relaysByUrl.set(new Map([[metadataRelay, {url: metadataRelay, supported_nips: ["1", "11"]}]]))

    expect(getRelayPolicy(metadataRelay).auth).toBe("none")
  })

  it("refreshes NIP-11 metadata without blocking first policy use", () => {
    const relay = "wss://first-use.example/"
    loadRelayMock.mockReturnValue(new Promise(() => undefined))

    expect(getRelayRequestPolicy(relay)).toEqual(defaultRequestPolicy)
    expect(loadRelayMock).toHaveBeenCalledOnce()
    expect(loadRelayMock).toHaveBeenCalledWith(relay)
    expect(forceLoadRelayMock).not.toHaveBeenCalled()
  })

  it("refreshes metadata about hourly while policy remains active", async () => {
    const relay = "wss://active-policy.example/"
    const startedAt = new Date("2026-07-15T00:00:00Z")
    vi.useFakeTimers()
    vi.setSystemTime(startedAt)
    loadRelayMock.mockResolvedValue(undefined)

    getRelayPolicy(relay)
    await refreshRelayPolicy(relay)

    vi.setSystemTime(startedAt.getTime() + RELAY_POLICY_REFRESH_INTERVAL - 1)
    getRelayPolicy(relay)
    expect(loadRelayMock).toHaveBeenCalledTimes(1)

    vi.setSystemTime(startedAt.getTime() + RELAY_POLICY_REFRESH_INTERVAL)
    getRelayPolicy(relay)
    expect(loadRelayMock).toHaveBeenCalledTimes(2)
    expect(forceLoadRelayMock).not.toHaveBeenCalled()
  })

  it("checks cached metadata when a socket reconnects", () => {
    const relay = "wss://reconnected-policy.example/"
    const socket = new Socket(relay, [])
    const unsubscribe = relayPolicyRefreshPolicy(socket)
    loadRelayMock.mockResolvedValue(undefined)

    socket.emit(SocketEvent.Status, SocketStatus.Open, relay)

    expect(loadRelayMock).toHaveBeenCalledOnce()
    expect(loadRelayMock).toHaveBeenCalledWith(relay)
    expect(forceLoadRelayMock).not.toHaveBeenCalled()
    unsubscribe()
    socket.cleanup()
  })

  it("coalesces first use with socket open", () => {
    const relay = "wss://coalesced-policy.example/"
    const socket = new Socket(relay, [])
    const unsubscribe = relayPolicyRefreshPolicy(socket)
    loadRelayMock.mockReturnValue(new Promise(() => undefined))

    getRelayPolicy(relay)
    socket.emit(SocketEvent.Status, SocketStatus.Open, relay)

    expect(loadRelayMock).toHaveBeenCalledOnce()
    expect(forceLoadRelayMock).not.toHaveBeenCalled()
    unsubscribe()
    socket.cleanup()
  })

  it("uses the uncached loader only for explicit policy loads", async () => {
    const relay = "wss://forced-policy.example/"

    await loadRelayPolicy(relay)

    expect(forceLoadRelayMock).toHaveBeenCalledOnce()
    expect(forceLoadRelayMock).toHaveBeenCalledWith(relay)
    expect(loadRelayMock).not.toHaveBeenCalled()
  })

  it("defaults signer relay requests to critical-live priority", async () => {
    vi.stubEnv("VITE_SIGNER_RELAYS", "wss://signer.example/,wss://other-signer.example")
    vi.resetModules()

    try {
      const {getRelayRequestPolicy: getPolicy, RELAY_REQUEST_PRIORITY: priorities} =
        await import("./relay-policy")

      expect(getPolicy("wss://signer.example/").priority).toBe(priorities.authority)
      // Normalization applies to both the env entries and the lookup
      expect(getPolicy("wss://other-signer.example/").priority).toBe(priorities.authority)
      expect(getPolicy(unknownRelay).priority).toBeUndefined()
    } finally {
      vi.unstubAllEnvs()
      vi.resetModules()
    }
  })
})
