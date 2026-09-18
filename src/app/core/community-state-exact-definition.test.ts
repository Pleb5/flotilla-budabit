import {describe, expect, it, vi} from "vitest"
import {getPublicKey} from "nostr-tools/pure"
import {get} from "svelte/store"
import {repository} from "@welshman/app"
import type {Filter, TrustedEvent} from "@welshman/util"
import {
  COMMUNITY_DEFINITION_KIND,
  buildCommunityDefinition,
  makeCommunityPointer,
} from "./community"
import {
  getExactCommunityBranchKey,
  getExactCommunitySessionPointer,
  makeExactCommunityDefinitionFilter,
  makeExactCommunitySession,
  parseExactCommunitySession,
  readExactCommunitySession,
  resolveExactCommunityDefinition,
  selectBoundedCommunityDefinitionDiscovery,
  selectExactCommunityDefinition,
  writeExactCommunitySession,
  activeExactCommunityRelays,
  activeExactCommunityPublishRelays,
  setActiveExactCommunityPointer,
  clearActiveExactCommunity,
} from "./community-state"
import {selectCurrentCommunityDefinitions} from "./community"

const secret = (value: number) => new Uint8Array(32).fill(value)
const owner = getPublicKey(secret(11))
const otherController = getPublicKey(secret(12))
const communityId = getPublicKey(secret(13))
const siblingId = getPublicKey(secret(14))
const listController = getPublicKey(secret(15))
const pointer = makeCommunityPointer({
  ownerPubkey: owner,
  communityId,
  relayHints: ["wss://hint.example"],
})!

const makeDefinition = ({
  id,
  createdAt,
  definitionController = owner,
  definitionCommunityId = communityId,
  name = "Builders",
}: {
  id: string
  createdAt: number
  definitionController?: string
  definitionCommunityId?: string
  name?: string
}): TrustedEvent => ({
  id,
  pubkey: definitionController,
  created_at: createdAt,
  kind: COMMUNITY_DEFINITION_KIND,
  content: "",
  sig: "f".repeat(128),
  tags: buildCommunityDefinition({
    communityId: definitionCommunityId,
    name,
    relays: ["wss://relay.example"],
    sections: [
      {
        name: "General",
        kinds: [{kind: 1111}],
        profileLists: [{address: `30000:${listController}:${definitionCommunityId}-general`}],
      },
    ],
  }).tags,
})

describe("exact community state", () => {
  it("builds an exact definition filter without relay-selected replacement limits", () => {
    expect(makeExactCommunityDefinitionFilter(pointer)).toEqual({
      kinds: [COMMUNITY_DEFINITION_KIND],
      authors: [owner],
      "#d": [communityId],
    })
  })

  it("keeps same-owner siblings and same-ID branches separate", () => {
    const expected = makeDefinition({id: "2".repeat(64), createdAt: 2})
    const sibling = makeDefinition({
      id: "1".repeat(64),
      createdAt: 3,
      definitionCommunityId: siblingId,
    })
    const sameIdBranch = makeDefinition({
      id: "0".repeat(64),
      createdAt: 4,
      definitionController: otherController,
    })

    expect(
      selectExactCommunityDefinition([sibling, sameIdBranch, expected], pointer)?.event.id,
    ).toBe(expected.id)
  })

  it("groups current definitions by exact coordinate", () => {
    const first = makeDefinition({id: "1".repeat(64), createdAt: 2})
    const sibling = makeDefinition({
      id: "2".repeat(64),
      createdAt: 3,
      definitionCommunityId: siblingId,
    })
    const sameIdBranch = makeDefinition({
      id: first.id,
      createdAt: 4,
      definitionController: otherController,
    })

    expect(Array.from(selectCurrentCommunityDefinitions([first, sibling, sameIdBranch]))).toEqual([
      [pointer.address, expect.objectContaining({event: first})],
      [
        `${COMMUNITY_DEFINITION_KIND}:${owner}:${siblingId}`,
        expect.objectContaining({event: sibling}),
      ],
      [
        `${COMMUNITY_DEFINITION_KIND}:${otherController}:${communityId}`,
        expect.objectContaining({event: sameIdBranch}),
      ],
    ])
  })

  it("does not claim a saturated bounded definition discovery is complete", () => {
    const definitions = [
      makeDefinition({id: "1".repeat(64), createdAt: 2}),
      makeDefinition({id: "2".repeat(64), createdAt: 2, definitionCommunityId: siblingId}),
    ]

    expect(selectBoundedCommunityDefinitionDiscovery(definitions, true, 2)).toMatchObject({
      complete: false,
      saturated: true,
    })
    expect(selectBoundedCommunityDefinitionDiscovery(definitions, true, 3)).toMatchObject({
      complete: true,
      saturated: false,
    })
    expect(selectBoundedCommunityDefinitionDiscovery(definitions, false, 3)).toMatchObject({
      complete: false,
      saturated: false,
    })
  })

  it("selects equal-time candidates deterministically across relay order", () => {
    const high = makeDefinition({id: "f".repeat(64), createdAt: 5, name: "High"})
    const low = makeDefinition({id: "1".repeat(64), createdAt: 5, name: "Low"})

    expect(selectExactCommunityDefinition([high, low], pointer)?.event.id).toBe(low.id)
    expect(selectExactCommunityDefinition([low, high], pointer)?.event.id).toBe(low.id)
  })

  it("round-trips only versioned exact sessions and rejects old stored state", () => {
    const session = makeExactCommunitySession(pointer, "definition-id")

    expect(parseExactCommunitySession(JSON.stringify(session))).toEqual(session)
    expect(getExactCommunitySessionPointer(session)).toMatchObject({address: pointer.address})
    expect(
      parseExactCommunitySession(
        JSON.stringify({communityPubkey: communityId, communityRelayHints: pointer.relayHints}),
      ),
    ).toBeUndefined()
    expect(parseExactCommunitySession("not-json")).toBeUndefined()
  })

  it("persists exact sessions and clears rejected stored shapes", () => {
    let stored: string | null = null
    const storage = {
      getItem: vi.fn(() => stored),
      setItem: vi.fn((_key: string, value: string) => {
        stored = value
      }),
      removeItem: vi.fn(() => {
        stored = null
      }),
    }
    const session = makeExactCommunitySession(pointer, "definition-id")

    writeExactCommunitySession(storage, session)
    expect(readExactCommunitySession(storage)).toEqual(session)

    stored = JSON.stringify({communityPubkey: communityId})
    expect(readExactCommunitySession(storage)).toBeUndefined()
    expect(storage.removeItem).toHaveBeenCalled()

    writeExactCommunitySession(storage, undefined)
    expect(stored).toBeNull()
  })

  it("keeps bootstrap hints readable but never writable before an exact definition loads", () => {
    const definition = makeDefinition({id: "9".repeat(64), createdAt: 20})
    setActiveExactCommunityPointer(pointer)
    try {
      expect(get(activeExactCommunityRelays)).toEqual(pointer.relayHints)
      expect(get(activeExactCommunityPublishRelays)).toEqual([])
      repository.publish(definition)
      expect(get(activeExactCommunityPublishRelays)).toEqual(["wss://relay.example/"])
      setActiveExactCommunityPointer(
        makeCommunityPointer({
          ownerPubkey: otherController,
          communityId,
          relayHints: ["wss://sibling-hint.example"],
        })!,
      )
      expect(get(activeExactCommunityRelays)).toEqual(["wss://sibling-hint.example"])
      expect(get(activeExactCommunityPublishRelays)).toEqual([])
    } finally {
      repository.removeEvent(definition.id)
      clearActiveExactCommunity()
    }
  })

  it("uses exact branch identity without relay hints in state keys", () => {
    const otherHints = makeCommunityPointer({
      ownerPubkey: owner,
      communityId,
      relayHints: ["wss://elsewhere.example"],
    })!

    expect(getExactCommunityBranchKey(pointer, listController)).toBe(
      getExactCommunityBranchKey(otherHints, listController),
    )
    expect(getExactCommunityBranchKey(pointer, listController)).toBe(
      `${listController}:${pointer.address}`,
    )
  })

  it("resolves from all relays and hydrates only the owner outbox", async () => {
    const high = makeDefinition({id: "f".repeat(64), createdAt: 5, name: "High"})
    const low = makeDefinition({id: "1".repeat(64), createdAt: 5, name: "Low"})
    const hydrateOwnerOutbox = vi.fn(async () => ["wss://outbox.example"])
    const loadEvents = vi.fn(async (relays: string[], _filters: Filter[]) =>
      relays.includes("wss://outbox.example") ? [low] : [high],
    )

    const definition = await resolveExactCommunityDefinition(pointer, {
      discoveryRelays: ["wss://discovery.example"],
      hydrateOwnerOutbox,
      loadEvents,
    })

    expect(hydrateOwnerOutbox).toHaveBeenCalledWith(owner, pointer.relayHints)
    expect(hydrateOwnerOutbox).not.toHaveBeenCalledWith(communityId, expect.anything())
    expect(loadEvents).toHaveBeenCalledTimes(2)
    expect(loadEvents.mock.calls[0][1]).toEqual([
      makeExactCommunityDefinitionFilter(pointer),
      {kinds: [5], authors: [owner]},
    ])
    expect(definition?.event.id).toBe(low.id)
  })

  it("applies address deletions acquired during definition resolution", async () => {
    const deleted = makeDefinition({id: "1".repeat(64), createdAt: 5})
    const older = makeDefinition({id: "2".repeat(64), createdAt: 4})
    const deletion: TrustedEvent = {
      id: "3".repeat(64),
      pubkey: owner,
      created_at: 6,
      kind: 5,
      content: "",
      sig: "f".repeat(128),
      tags: [["a", pointer.address]],
    }

    const definition = await resolveExactCommunityDefinition(pointer, {
      hydrateOwnerOutbox: async () => [],
      loadEvents: async () => [deleted, older, deletion],
    })

    expect(definition).toBeUndefined()
  })
})
