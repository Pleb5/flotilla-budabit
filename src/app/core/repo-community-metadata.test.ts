import {describe, expect, it} from "vitest"
import type {TrustedEvent} from "@welshman/util"
import {buildCommunityDefinition} from "./community"
import {selectRepoCommunityDefinition} from "./repo-community-metadata"

const communityId = "0a8ecba4868c13e1e84cc5cb58c02c1fd0880d9e5a25a5050ee96ad8a166d7c8"
const otherOwner = "b".repeat(64)
const binding = {communityId, relay: "wss://relay.budabit.club"}
const definition = (pubkey = communityId, name = "BudaBit", created_at = 1): TrustedEvent =>
  ({
    ...buildCommunityDefinition({
      communityId,
      name,
      relays: [binding.relay],
      sections: [{name: "Repositories", kinds: [{kind: 30617}], profileLists: []}],
    }),
    id: `${pubkey}-${created_at}`,
    pubkey,
    created_at,
    sig: "",
  }) as TrustedEvent

describe("repository community metadata", () => {
  it("resolves an h-only association from a matching definition, including a different owner", () => {
    expect(selectRepoCommunityDefinition(binding, [definition()])?.metadata.name).toBe("BudaBit")
    expect(selectRepoCommunityDefinition(binding, [definition(otherOwner)])?.pointer.address).toBe(
      `32222:${otherOwner}:${communityId}`,
    )
    expect(selectRepoCommunityDefinition(binding, [])).toBeUndefined()
  })

  it("does not choose arbitrarily between branches sharing a stable ID", () => {
    const events = [definition(), definition(otherOwner)]
    expect(selectRepoCommunityDefinition(binding, events)).toBeUndefined()
    expect(
      selectRepoCommunityDefinition(
        {...binding, address: `32222:${otherOwner}:${communityId}`},
        events,
      )?.ownerPubkey,
    ).toBe(otherOwner)
    expect(
      selectRepoCommunityDefinition({...binding, address: `32222:${otherOwner}:${communityId}`}, [
        definition(),
      ]),
    ).toBeUndefined()
  })

  it("tracks the latest name and same-author definition deletions", () => {
    const events = [definition(), definition(communityId, "Renamed BudaBit", 2)]
    expect(selectRepoCommunityDefinition(binding, events)?.metadata.name).toBe("Renamed BudaBit")
    const deletion = {
      id: "delete",
      kind: 5,
      pubkey: communityId,
      created_at: 3,
      tags: [["a", `32222:${communityId}:${communityId}`]],
      content: "",
      sig: "",
    }
    expect(
      selectRepoCommunityDefinition(binding, [...events, {...deletion, pubkey: otherOwner}])
        ?.metadata.name,
    ).toBe("Renamed BudaBit")
    expect(selectRepoCommunityDefinition(binding, [...events, deletion])).toBeUndefined()
    expect(
      selectRepoCommunityDefinition(binding, [
        ...events,
        deletion,
        definition(communityId, "Restored", 4),
      ])?.metadata.name,
    ).toBe("Restored")
  })

  it("ignores unrelated IDs and repositories without a binding", () => {
    expect(selectRepoCommunityDefinition({communityId: otherOwner}, [definition()])).toBeUndefined()
    expect(selectRepoCommunityDefinition(undefined, [definition()])).toBeUndefined()
  })
})
