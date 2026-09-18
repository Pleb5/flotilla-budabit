import {describe, expect, it, vi} from "vitest"
import {get} from "svelte/store"
import {getPublicKey} from "nostr-tools/pure"
import {buildCommunityDefinition, parseCommunityDefinition, makeCommunityPointer} from "./community"
import type {TrustedEvent} from "@welshman/util"

const account = getPublicKey(new Uint8Array(32).fill(1))
const other = getPublicKey(new Uint8Array(32).fill(2))
const community = makeCommunityPointer({ownerPubkey: other, communityId: account})!

describe("application outcome discovery context", () => {
  it("retains exact per-account context across refresh and membership removal", async () => {
    const first = await import("./community-outcome-context")
    await first.rememberCommunityOutcomeContexts(account, [
      {address: community.address, relays: ["wss://community.example"]},
    ])
    await first.rememberCommunityOutcomeContexts(other, [
      {address: community.address, relays: ["wss://other.example"]},
    ])
    // An empty membership snapshot must not forget a rejected/revoked applicant.
    await first.rememberCommunityOutcomeContexts(account, [])
    vi.resetModules()
    const restored = await import("./community-outcome-context")
    await restored.communityOutcomeContexts.ready
    expect(get(restored.communityOutcomeContexts)[account]).toEqual([
      {address: community.address, relays: ["wss://community.example/"]},
    ])
    expect(get(restored.communityOutcomeContexts)[other]).toEqual([
      {address: community.address, relays: ["wss://other.example/"]},
    ])
  })

  it("queries outcomes on refreshed definition relays, without membership or a discovery copy", async () => {
    const {makeCommunityOutcomeSources} = await import("./community-outcome-context")
    const definition = parseCommunityDefinition({
      ...buildCommunityDefinition({
        communityId: account,
        name: "Outcome",
        relays: ["wss://current.example"],
        sections: [{name: "General", kinds: [{kind: 7}], profileLists: []}],
      }),
      pubkey: other,
      id: "d".repeat(64),
      sig: "f".repeat(128),
      created_at: 1,
    } as TrustedEvent)!
    const input = {account, definitions: [definition], since: 10, limit: 100}
    expect(makeCommunityOutcomeSources(input)).toEqual([
      {
        communityAddress: community.address,
        relays: ["wss://current.example/"],
        filters: [
          {kinds: [7], "#p": [account], "#h": [account], "#k": ["1069"], since: 10, limit: 100},
        ],
      },
    ])
    expect(makeCommunityOutcomeSources({...input, account: undefined})).toEqual([])
    expect(
      makeCommunityOutcomeSources({...input, definitions: [{...definition, relays: []}]})[0].relays,
    ).toEqual([])
  })
})
