import {afterEach, describe, expect, it} from "vitest"
import {relaysByUrl} from "@welshman/app"
import {getRelayPolicy, getRelayRequestPolicy} from "./relay-policy"

const publicRelay = "wss://relay.budabit.club/"
const metadataRelay = "wss://metadata.example/"

afterEach(() => {
  relaysByUrl.set(new Map())
})

describe("relay policy", () => {
  it("applies the explicit public Budabit relay limits", () => {
    expect(getRelayPolicy(publicRelay)).toEqual({
      auth: "none",
      maxSubscriptions: 10,
      maxFiltersPerSubscription: 5,
      maxMessageBytes: 128 * 1024,
    })
    expect(getRelayRequestPolicy(publicRelay)).toEqual({
      maxSubscriptions: 9,
      maxFiltersPerSubscription: 5,
      maxMessageBytes: 128 * 1024,
      reservedSubscriptions: 3,
      reservedPriority: 200,
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
      maxSubscriptions: 12,
      maxFiltersPerSubscription: 1,
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
