import {afterEach, describe, expect, it} from "vitest"
import {relaysByUrl} from "@welshman/app"
import {getRelayPolicy, getRelayRequestPolicy} from "./relay-policy"

const publicRelay = "wss://relay.budabit.club/"
const metadataRelay = "wss://metadata.example/"
const unknownRelay = "wss://unknown.example/"

const defaultRequestPolicy = {
  maxSubscriptions: 9,
  maxFiltersPerSubscription: 5,
  maxLiveSubscriptions: 7,
  maxBackgroundLiveSubscriptions: 5,
  criticalLivePriority: 200,
  maxMessageBytes: 128 * 1024,
}

afterEach(() => {
  relaysByUrl.set(new Map())
})

describe("relay policy", () => {
  it("applies the explicit public Budabit relay limits", () => {
    expect(getRelayPolicy(publicRelay)).toEqual({
      auth: "none",
      ...defaultRequestPolicy,
    })
    expect(getRelayRequestPolicy(publicRelay)).toEqual(defaultRequestPolicy)
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
            },
          } as any,
        ],
      ]),
    )

    expect(getRelayPolicy(metadataRelay)).toEqual({
      auth: "required",
      ...defaultRequestPolicy,
      maxMessageBytes: 64 * 1024,
    })
  })

  it("does not authenticate relays that advertise no NIP-42 support", () => {
    relaysByUrl.set(
      new Map([[metadataRelay, {url: metadataRelay, supported_nips: ["1", "11"]}]]),
    )

    expect(getRelayPolicy(metadataRelay).auth).toBe("none")
  })
})
