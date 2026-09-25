import {describe, expect, it} from "vitest"
import {getPublicKey} from "nostr-tools/pure"
import type {TrustedEvent} from "@welshman/util"
import {
  COMMUNITY_DEFINITION_KIND,
  TARGETED_PUBLICATION_KIND,
  buildCommunityDefinition,
  buildTargetedPublication,
  communityPointersEqual,
  getCommunityDefinitionValidationFailure,
  makeCommunityPointer,
  parseCommunityDefinition,
  parseCommunityAuthority,
  makeCommunityChildIdentifier,
  makeCommunityProfileListIdentifier,
  makeTargetedPublicationLifecycleFilters,
  MAX_TARGETED_PUBLICATION_LIFECYCLE_COORDINATES,
  parseCommunityProfileListIdentifier,
  deleteMatchesCommunity,
  makeCommunityAuthorityTags,
  makeCommunityDeleteTags,
  makeCommunityScopeTags,
  parseCommunityId,
  parseCommunityNaddr,
  parseOwnerPubkey,
  parseTargetedPublication,
  removeTargetedCommunity,
  selectCurrentAddressableEvent,
  selectCurrentCommunityDefinition,
  selectCurrentTargetedPublicationEvents,
  updateCommunityDefinition,
} from "./community"

const secret = (value: number) => new Uint8Array(32).fill(value)
const owner = getPublicKey(secret(1))
const otherController = getPublicKey(secret(2))
const communityId = getPublicKey(secret(3))
const otherCommunityId = getPublicKey(secret(4))
const listController = getPublicKey(secret(5))
const servicePubkey = getPublicKey(secret(7))

const makeEvent = (overrides: Partial<TrustedEvent>): TrustedEvent =>
  ({
    id: "a".repeat(64),
    pubkey: owner,
    created_at: 1,
    kind: 1,
    tags: [],
    content: "",
    sig: "b".repeat(128),
    ...overrides,
  }) as TrustedEvent

const section = {
  name: "General",
  kinds: [{kind: 1111}],
  profileLists: [{address: `30000:${listController}:${communityId}-general`}],
}

describe("Communikeys identity", () => {
  it("accepts canonical lowercase 32-byte community IDs without curve validation", () => {
    expect(parseCommunityId(communityId)).toBe(communityId)
    expect(parseCommunityId(communityId.toUpperCase())).toBeUndefined()
    expect(parseCommunityId("f".repeat(64))).toBe("f".repeat(64))
    expect(parseCommunityId("0".repeat(64))).toBe("0".repeat(64))
    expect(parseCommunityId("abc")).toBeUndefined()
    expect(parseOwnerPubkey("f".repeat(64))).toBe("f".repeat(64))
    expect(parseOwnerPubkey("F".repeat(64))).toBeUndefined()
  })

  it("derives coherent pointers and ignores relay hints for equality", () => {
    const first = makeCommunityPointer({
      ownerPubkey: owner,
      communityId,
      relayHints: [
        "wss://one.example",
        "wss://two.example/",
        "wss://one.example/",
        "wss://three.example",
        "wss://four.example",
      ],
    })!
    const second = makeCommunityPointer({
      ownerPubkey: owner,
      communityId,
      relayHints: ["wss://elsewhere.example"],
    })!

    expect(first.address).toBe(`${COMMUNITY_DEFINITION_KIND}:${owner}:${communityId}`)
    expect(first.relayHints).toEqual([
      "wss://one.example",
      "wss://two.example",
      "wss://three.example",
    ])
    expect(first.cacheKey).toBe(first.address)
    expect(communityPointersEqual(first, second)).toBe(true)
    expect(parseCommunityNaddr(first.naddr)).toMatchObject({
      address: first.address,
      ownerPubkey: owner,
      communityId,
    })
    expect(
      communityPointersEqual(
        first,
        makeCommunityPointer({ownerPubkey: otherController, communityId})!,
      ),
    ).toBe(false)
  })

  it("rejects non-community and incoherent naddrs", async () => {
    const {naddrEncode} = await import("nostr-tools/nip19")
    const wrongKind = naddrEncode({kind: 30023, pubkey: owner, identifier: communityId})
    const malformedId = naddrEncode({
      kind: COMMUNITY_DEFINITION_KIND,
      pubkey: owner,
      identifier: "not-a-community-id",
    })

    expect(parseCommunityNaddr(wrongKind)).toBeUndefined()
    expect(parseCommunityNaddr(malformedId)).toBeUndefined()
  })

  it("parses a fixed external community naddr vector", () => {
    const vector =
      "naddr1qvzqqqramcpzqxuyc4t8kynygzv460k442aq2ewhrcvrgczgr8lec9l4a82a6pu0qyfhwumn8ghj7un9d3shjtn90psk6urvv5qyqe3exvcrscfsxyunydfcvvenzvp58yengdrx8q6kvwpevs6nyv3evg6nxvtr8q6r2wpnxenrjwtzxqurvvp3vccnzvmzvdjnqvekvcusayrxs5"

    expect(parseCommunityNaddr(vector)).toMatchObject({
      ownerPubkey: owner,
      communityId: "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9",
      relayHints: ["wss://relay.example"],
    })
  })
})

describe("Communikeys definitions", () => {
  const watcherDefinition = (tags: string[][] = []) => {
    const template = buildCommunityDefinition({
      communityId,
      name: "CI community",
      relays: ["wss://community.example"],
      sections: [section],
    })
    const sectionIndex = template.tags.findIndex(tag => tag[0] === "content")
    return makeEvent({
      kind: COMMUNITY_DEFINITION_KIND,
      tags: [
        ...template.tags.slice(0, sectionIndex),
        ...tags,
        ...template.tags.slice(sectionIndex),
      ],
    })
  }

  it("round-trips CI watcher identities and merges duplicate relay hints before content sections", () => {
    const template = buildCommunityDefinition({
      communityId,
      name: "CI community",
      relays: ["wss://community.example"],
      ciRepoWatchers: [
        {pubkey: servicePubkey, relays: ["wss://ci.example/", "wss://ci.example"]},
        {pubkey: servicePubkey, relays: ["wss://backup.example"]},
        {pubkey: otherController, relays: ["wss://other.example"]},
      ],
      sections: [section],
    })
    const definition = parseCommunityDefinition(makeEvent({...template}))!
    expect(definition.ciRepoWatchers).toEqual([
      {pubkey: servicePubkey, relays: ["wss://ci.example", "wss://backup.example"]},
      {pubkey: otherController, relays: ["wss://other.example"]},
    ])
    const watcherTags = template.tags.filter(tag => tag[0] === "ci-repo-watcher")
    expect(watcherTags).toEqual([
      ["ci-repo-watcher", servicePubkey, "wss://ci.example", "wss://backup.example"],
      ["ci-repo-watcher", otherController, "wss://other.example"],
    ])
    expect(template.tags.indexOf(watcherTags[1])).toBeLessThan(
      template.tags.findIndex(tag => tag[0] === "content"),
    )
    expect(parseCommunityDefinition(watcherDefinition())?.ciRepoWatchers).toEqual([])
    expect(
      parseCommunityDefinition(watcherDefinition([...watcherTags, watcherTags[0]]))?.ciRepoWatchers,
    ).toEqual(definition.ciRepoWatchers)
  })

  it("rejects malformed, noncanonical, oversized, and section-local watcher advertisements", () => {
    for (const tag of [
      ["ci-repo-watcher"],
      ["ci-repo-watcher", servicePubkey],
      ["ci-repo-watcher", "npub1invalid", "wss://ci.example"],
      ["ci-repo-watcher", servicePubkey.toUpperCase(), "wss://ci.example"],
      ...[
        "",
        "ws://ci.example",
        "https://ci.example",
        "wss://ci.example/",
        "wss://user@ci.example",
        "wss://ci.example/#fragment",
      ].map(relay => ["ci-repo-watcher", servicePubkey, relay]),
      ["ci-repo-watcher", servicePubkey, ...Array(21).fill("wss://ci.example")],
    ]) {
      expect(
        parseCommunityDefinition(watcherDefinition([tag])),
        JSON.stringify(tag),
      ).toBeUndefined()
    }
    const tag = ["ci-repo-watcher", servicePubkey, "wss://ci.example"]
    expect(parseCommunityDefinition(watcherDefinition(Array(21).fill(tag)))).toBeUndefined()
    const event = watcherDefinition()
    expect(parseCommunityDefinition({...event, tags: [...event.tags, tag]})).toBeUndefined()
    const splitRelays = Array.from({length: 21}, (_, index) => `wss://relay-${index}.example`)
    expect(
      parseCommunityDefinition(
        watcherDefinition([
          ["ci-repo-watcher", servicePubkey, ...splitRelays.slice(0, 20)],
          ["ci-repo-watcher", servicePubkey, splitRelays[20]],
        ]),
      ),
    ).toBeUndefined()
    expect(() =>
      buildCommunityDefinition({
        communityId,
        name: "CI",
        relays: ["wss://community.example"],
        sections: [section],
        ciRepoWatchers: [{pubkey: servicePubkey, relays: []}],
      }),
    ).toThrow("Invalid CI repository watcher")
  })

  it("preserves watchers on metadata edits and replaces or removes them on settings rebuilds", () => {
    const tag = ["ci-repo-watcher", servicePubkey, "wss://ci.example"]
    const definition = parseCommunityDefinition(watcherDefinition([tag, ["future", "opaque"]]))!
    expect(updateCommunityDefinition(definition, {name: "Renamed"}).tags).toContainEqual(tag)
    for (const ciRepoWatchers of [
      definition.ciRepoWatchers,
      [],
      [{pubkey: otherController, relays: ["wss://new.example"]}],
    ]) {
      const replacement = buildCommunityDefinition({
        ...definition.metadata,
        communityId,
        relays: definition.relays,
        sections: definition.sections,
        ciRepoWatchers,
      })
      const updated = updateCommunityDefinition(definition, {}, {replacement})
      expect(parseCommunityDefinition(makeEvent({...updated}))?.ciRepoWatchers).toEqual(
        ciRepoWatchers,
      )
      expect(updated.tags.filter(tag => tag[0] === "ci-repo-watcher")).toHaveLength(
        ciRepoWatchers.length,
      )
      expect(updated.tags).toContainEqual(["future", "opaque"])
    }
  })

  it("builds and strictly parses definition-native metadata", () => {
    const template = buildCommunityDefinition({
      communityId,
      name: "Buda Builders",
      description: "A builder community",
      picture: "https://media.example/picture.png",
      relays: ["wss://relay.example"],
      sections: [section],
    })
    const definition = parseCommunityDefinition(
      makeEvent({kind: COMMUNITY_DEFINITION_KIND, tags: template.tags}),
    )!

    expect(template.kind).toBe(COMMUNITY_DEFINITION_KIND)
    expect(template.tags[0]).toEqual(["d", communityId])
    expect(definition.communityId).toBe(communityId)
    expect(definition.ownerPubkey).toBe(owner)
    expect(definition.pointer.address).toBe(`${COMMUNITY_DEFINITION_KIND}:${owner}:${communityId}`)
    expect(definition.metadata).toEqual({
      name: "Buda Builders",
      description: "A builder community",
      picture: "https://media.example/picture.png",
    })
    expect(definition.relays).toEqual(["wss://relay.example"])
  })

  it("round-trips owner-only sections without profile lists", () => {
    const template = buildCommunityDefinition({
      communityId,
      name: "Owner-only community",
      relays: ["wss://relay.example"],
      sections: [{name: "General", kinds: [{kind: 1111}], profileLists: []}],
    })
    const definition = parseCommunityDefinition(
      makeEvent({kind: COMMUNITY_DEFINITION_KIND, tags: template.tags}),
    )

    expect(template.tags).not.toContainEqual(expect.arrayContaining(["a"]))
    expect(definition?.sections).toEqual([
      {
        name: "General",
        kinds: [{kind: 1111}],
        profileLists: [],
        badges: [],
        retention: [],
      },
    ])
  })

  it("accepts community relay inputs with or without a trailing slash", () => {
    const template = buildCommunityDefinition({
      communityId,
      name: "Buda Builders",
      relays: ["wss://relay.example/", "wss://relay-two.example"],
      graspServers: ["wss://grasp.example/"],
      terms: {reference: "c".repeat(64), relay: "wss://terms.example/"},
      sections: [section],
    })

    expect(template.tags).toContainEqual(["r", "wss://relay.example"])
    expect(template.tags).toContainEqual(["r", "wss://relay-two.example"])
    expect(template.tags).toContainEqual(["grasp", "wss://grasp.example"])
    expect(template.tags).toContainEqual(["tos", "c".repeat(64), "wss://terms.example"])
  })

  it("rejects malformed or insecure community relay inputs", () => {
    for (const relay of [
      "ws://relay.example",
      "https://relay.example",
      "wss://user:password@relay.example",
      "wss://relay.example/#fragment",
      "not a relay",
    ]) {
      expect(() =>
        buildCommunityDefinition({
          communityId,
          name: "Buda Builders",
          relays: [relay],
          sections: [section],
        }),
      ).toThrow("A valid community relay URL is required.")
    }
  })

  it("round-trips typed mint, terms, and service declarations", () => {
    const template = buildCommunityDefinition({
      communityId,
      name: "Buda Builders",
      relays: ["wss://relay.example"],
      mints: [{url: "https://mint.example", type: "cashu"}],
      terms: {reference: "c".repeat(64), relay: "wss://terms.example"},
      services: [
        {
          name: "community-alerts",
          pubkey: servicePubkey,
          requestRelay: "wss://requests.example/",
          handlerAddress: `31990:${servicePubkey}:alerts`,
          handlerRelay: "wss://handlers.example/",
        },
      ],
      sections: [section],
    })
    const parsed = parseCommunityDefinition(
      makeEvent({kind: COMMUNITY_DEFINITION_KIND, tags: template.tags}),
    )!

    expect(parsed.mints).toEqual([{url: "https://mint.example", type: "cashu"}])
    expect(parsed.terms).toEqual({reference: "c".repeat(64), relay: "wss://terms.example"})
    expect(parsed.services).toEqual([
      {
        name: "community-alerts",
        pubkey: servicePubkey,
        requestRelay: "wss://requests.example",
        handlerAddress: `31990:${servicePubkey}:alerts`,
        handlerRelay: "wss://handlers.example",
      },
    ])
  })

  it("identifies noncanonical service relays in rejected definitions", () => {
    const template = buildCommunityDefinition({
      communityId,
      name: "Buda Builders",
      relays: ["wss://relay.example"],
      services: [
        {
          name: "community-alerts",
          pubkey: servicePubkey,
          requestRelay: "wss://requests.example",
          handlerAddress: `31990:${servicePubkey}:alerts`,
          handlerRelay: "wss://handlers.example",
        },
      ],
      sections: [section],
    })
    const event = makeEvent({
      kind: COMMUNITY_DEFINITION_KIND,
      tags: template.tags.map(tag =>
        tag[0] === "service" ? [tag[0], tag[1], tag[2], `${tag[3]}/`, tag[4], `${tag[5]}/`] : tag,
      ),
    })

    expect(parseCommunityDefinition(event)).toBeUndefined()
    expect(getCommunityDefinitionValidationFailure(event)).toEqual({
      eventId: event.id,
      category: "service declaration",
    })
  })

  it("rejects missing, duplicate, uppercase, and malformed definition d tags", () => {
    const validTags = buildCommunityDefinition({
      communityId,
      name: "Builders",
      relays: ["wss://relay.example"],
      sections: [section],
    }).tags

    expect(
      parseCommunityDefinition(
        makeEvent({kind: COMMUNITY_DEFINITION_KIND, tags: validTags.slice(1)}),
      ),
    ).toBeUndefined()
    expect(
      parseCommunityDefinition(
        makeEvent({
          kind: COMMUNITY_DEFINITION_KIND,
          tags: [...validTags, ["d", otherCommunityId]],
        }),
      ),
    ).toBeUndefined()
    expect(
      parseCommunityDefinition(
        makeEvent({
          kind: COMMUNITY_DEFINITION_KIND,
          tags: validTags.map(tag => (tag[0] === "d" ? ["d", communityId.toUpperCase()] : tag)),
        }),
      ),
    ).toBeUndefined()
    expect(
      parseCommunityDefinition(
        makeEvent({kind: COMMUNITY_DEFINITION_KIND, tags: [...validTags, ["h", communityId]]}),
      ),
    ).toBeUndefined()
  })

  it("rejects malformed recognized tags and invalid section structure", () => {
    const validTags = buildCommunityDefinition({
      communityId,
      name: "Builders",
      relays: ["wss://relay.example"],
      sections: [section],
    }).tags
    const malformedCases = [
      validTags.map(tag => (tag[0] === "name" ? ["name", "Builders", "extra"] : tag)),
      validTags.map(tag => (tag[0] === "r" ? ["r", "ws://relay.example"] : tag)),
      validTags.map(tag => (tag[0] === "k" ? ["k", "01111"] : tag)),
      validTags.map(tag => (tag[0] === "k" ? ["k", "1111", ""] : tag)),
      validTags.map(tag => (tag[0] === "a" ? ["a", `30009:${listController}:badge`] : tag)),
      [
        ["d", communityId],
        ["name", "Builders"],
        ["r", "wss://relay.example"],
        ["k", "1111"],
        ["content", "General"],
        ["a", section.profileLists[0].address],
      ],
      validTags.filter(tag => tag[0] !== "content" && tag[0] !== "k" && tag[0] !== "a"),
      [...validTags, ["mint", "http://mint.example", "cashu"]],
      [...validTags, ["tos", "not-an-event-or-address"]],
      [
        ...validTags,
        [
          "service",
          "Invalid Service",
          servicePubkey,
          "wss://requests.example",
          `31990:${servicePubkey}:alerts`,
          "wss://handlers.example",
        ],
      ],
      [
        ...validTags.slice(0, 3),
        [
          "service",
          "community-alerts",
          servicePubkey,
          "wss://requests.example",
          `1:${servicePubkey}:not-addressable`,
          "wss://handlers.example",
        ],
        ...validTags.slice(3),
      ],
    ]

    for (const tags of malformedCases) {
      expect(
        parseCommunityDefinition(makeEvent({kind: COMMUNITY_DEFINITION_KIND, tags})),
      ).toBeUndefined()
    }
  })

  it("rejects builder inputs that its parser would reject", () => {
    expect(() =>
      buildCommunityDefinition({
        communityId,
        name: "Builders",
        relays: ["wss://relay.example"],
        sections: [],
      }),
    ).toThrow()
    expect(() =>
      buildCommunityDefinition({
        communityId,
        name: "Builders",
        relays: ["wss://relay.example"],
        sections: [{name: "General", kinds: [], profileLists: []}],
      }),
    ).toThrow("Community sections require kinds.")
    expect(() =>
      buildCommunityDefinition({
        communityId,
        name: "Builders",
        relays: ["wss://relay.example"],
        sections: [section, {...section, name: "general"}],
      }),
    ).toThrow()
    expect(() =>
      buildCommunityDefinition({
        communityId,
        name: "Builders",
        relays: Array.from({length: 21}, (_, index) => `wss://relay-${index}.example`),
        sections: [section],
      }),
    ).toThrow()
  })

  it("uses the complete community ID in generated child coordinates", () => {
    const sharedPrefix = communityId.slice(0, 16)
    const siblingId = getPublicKey(secret(6))
    expect(siblingId.slice(0, 16)).not.toBe(sharedPrefix)

    expect(makeCommunityProfileListIdentifier(communityId, "general-writers")).toBe(
      `${communityId}-general-writers`,
    )
    expect(makeCommunityProfileListIdentifier(communityId, "General Writers")).toBeUndefined()
    expect(parseCommunityProfileListIdentifier(communityId, `${communityId}-general-2`)).toEqual({
      purpose: "general-2",
    })
    expect(parseCommunityProfileListIdentifier(communityId, `${communityId}-general-2.2`)).toEqual({
      purpose: "general-2",
      shard: 2,
    })
    expect(
      parseCommunityProfileListIdentifier(communityId, `${communityId.slice(0, 32)}-general`),
    ).toBeUndefined()
    expect(makeCommunityChildIdentifier(communityId, "form", "---")).toBe(
      `budabit-${communityId}-form`,
    )
    expect(makeCommunityChildIdentifier(communityId, "Invalid Purpose", "general")).toBeUndefined()
  })

  it("preserves unknown top-level and section tags through edits", () => {
    const base = parseCommunityDefinition(
      makeEvent({
        kind: COMMUNITY_DEFINITION_KIND,
        tags: [
          ["d", communityId],
          ["name", "Before"],
          ["x-top", "one"],
          ["r", "wss://relay.example"],
          ["content", "General"],
          ["k", "1111"],
          ["x-section", "two"],
          ["a", section.profileLists[0].address],
        ],
      }),
    )!
    const updated = updateCommunityDefinition(base, {name: "After"})

    expect(updated.tags).toContainEqual(["x-top", "one"])
    expect(updated.tags).toContainEqual(["x-section", "two"])
    expect(updated.tags).toContainEqual(["name", "After"])
    expect(
      parseCommunityDefinition(makeEvent({kind: COMMUNITY_DEFINITION_KIND, tags: updated.tags})),
    ).toBeTruthy()
  })

  it("rejects noncanonical section profile-list identifiers", () => {
    const tags = buildCommunityDefinition({
      communityId,
      name: "Builders",
      relays: ["wss://relay.example"],
      sections: [section],
    }).tags.map(tag =>
      tag[0] === "a" && tag[1] === section.profileLists[0].address
        ? ["a", `30000:${listController}:general`]
        : tag,
    )

    expect(
      parseCommunityDefinition(makeEvent({kind: COMMUNITY_DEFINITION_KIND, tags})),
    ).toBeUndefined()
  })

  it("losslessly rebuilds known fields while preserving the exact address and renamed-section extensions", () => {
    const base = parseCommunityDefinition(
      makeEvent({
        kind: COMMUNITY_DEFINITION_KIND,
        tags: [
          ["d", communityId],
          ["name", "Before"],
          ["x-top", "one"],
          ["r", "wss://relay.example"],
          ["content", "General"],
          ["k", "1111"],
          ["x-section", "two"],
          ["a", section.profileLists[0].address],
        ],
      }),
    )!
    const rebuilt = buildCommunityDefinition({
      communityId: base.communityId,
      name: "After",
      relays: ["wss://relay.example", "wss://relay-two.example"],
      sections: [{...section, name: "Renamed"}],
    })
    const updated = updateCommunityDefinition(
      base,
      {name: "After"},
      {replacement: rebuilt, originalSectionNames: {renamed: "general"}},
    )
    const parsed = parseCommunityDefinition(
      makeEvent({kind: COMMUNITY_DEFINITION_KIND, tags: updated.tags}),
    )!

    expect(parsed.pointer.address).toBe(base.pointer.address)
    expect(parsed.communityId).toBe(base.communityId)
    expect(parsed.relays).toEqual(["wss://relay.example", "wss://relay-two.example"])
    expect(parsed.sections[0].name).toBe("Renamed")
    expect(updated.tags).toContainEqual(["x-top", "one"])
    expect(updated.tags).toContainEqual(["x-section", "two"])
  })

  it("preserves geohash on name edits and rejects invalid metadata edits", () => {
    const template = buildCommunityDefinition({
      communityId,
      name: "Before",
      geohash: "u173z",
      relays: ["wss://relay.example"],
      sections: [section],
    })
    const definition = parseCommunityDefinition(
      makeEvent({kind: COMMUNITY_DEFINITION_KIND, tags: template.tags}),
    )!

    expect(updateCommunityDefinition(definition, {name: "After"}).tags).toContainEqual([
      "g",
      "u173z",
    ])
    expect(() => updateCommunityDefinition(definition, {picture: "javascript:alert(1)"})).toThrow(
      "Invalid picture",
    )
  })

  it("selects replacements deterministically by timestamp then lowest event ID", () => {
    const tags = buildCommunityDefinition({
      communityId,
      name: "Builders",
      relays: ["wss://relay.example"],
      sections: [section],
    }).tags
    const highId = makeEvent({id: "f".repeat(64), kind: COMMUNITY_DEFINITION_KIND, tags})
    const lowId = makeEvent({id: "1".repeat(64), kind: COMMUNITY_DEFINITION_KIND, tags})
    const otherAddress = makeEvent({
      id: "0".repeat(64),
      kind: COMMUNITY_DEFINITION_KIND,
      tags: buildCommunityDefinition({
        communityId: otherCommunityId,
        name: "Other",
        relays: ["wss://relay.example"],
        sections: [
          {
            ...section,
            profileLists: [{address: `30000:${listController}:${otherCommunityId}-general`}],
          },
        ],
      }).tags,
    })

    expect(
      selectCurrentAddressableEvent(
        [highId, otherAddress, lowId],
        `${COMMUNITY_DEFINITION_KIND}:${owner}:${communityId}`,
      )?.id,
    ).toBe(lowId.id)
  })

  it("applies same-author address tombstones before selecting authority state", () => {
    const address = `30000:${owner}:writers`
    const oldList = makeEvent({
      id: "1".repeat(64),
      kind: 30000,
      created_at: 10,
      tags: [["d", "writers"]],
    })
    const deletion = makeEvent({
      id: "2".repeat(64),
      kind: 5,
      created_at: 10,
      tags: [["a", address]],
    })
    const recreated = makeEvent({
      id: "3".repeat(64),
      kind: 30000,
      created_at: 11,
      tags: [["d", "writers"]],
    })
    const foreignDeletion = makeEvent({
      id: "4".repeat(64),
      pubkey: otherController,
      kind: 5,
      created_at: 20,
      tags: [["a", address]],
    })

    expect(selectCurrentAddressableEvent([oldList, deletion], address)).toBeUndefined()
    expect(selectCurrentAddressableEvent([oldList, deletion, recreated], address)?.id).toBe(
      recreated.id,
    )
    expect(selectCurrentAddressableEvent([oldList, foreignDeletion], address)?.id).toBe(oldList.id)

    const multiAddressDeletion = makeEvent({
      id: "5".repeat(64),
      kind: 5,
      created_at: 20,
      tags: [
        ["a", `30000:${owner}:other`],
        ["a", address],
      ],
    })
    expect(selectCurrentAddressableEvent([oldList, multiAddressDeletion], address)).toBeUndefined()
  })

  it("ignores invalid newer definitions and e tombstones for addressable authority", () => {
    const valid = makeEvent({
      id: "1".repeat(64),
      created_at: 10,
      kind: COMMUNITY_DEFINITION_KIND,
      tags: buildCommunityDefinition({
        communityId,
        name: "Valid",
        relays: ["wss://relay.example"],
        sections: [section],
      }).tags,
    })
    const invalid = makeEvent({
      id: "2".repeat(64),
      created_at: 11,
      kind: COMMUNITY_DEFINITION_KIND,
      tags: [["d", communityId]],
    })
    const address = `${COMMUNITY_DEFINITION_KIND}:${owner}:${communityId}`
    expect(selectCurrentCommunityDefinition([valid, invalid], address)?.id).toBe(valid.id)

    const listAddress = `30000:${owner}:writers`
    const older = makeEvent({
      id: "3".repeat(64),
      created_at: 9,
      kind: 30000,
      tags: [["d", "writers"]],
    })
    const newer = makeEvent({
      id: "4".repeat(64),
      created_at: 10,
      kind: 30000,
      tags: [["d", "writers"]],
    })
    const deletion = makeEvent({
      id: "5".repeat(64),
      created_at: 11,
      kind: 5,
      tags: [["e", newer.id]],
    })
    expect(selectCurrentAddressableEvent([older, newer, deletion], listAddress)?.id).toBe(newer.id)
  })

  it("requires a single exact a tag for definition address tombstones", () => {
    const definition = makeEvent({
      id: "1".repeat(64),
      created_at: 10,
      kind: COMMUNITY_DEFINITION_KIND,
      tags: buildCommunityDefinition({
        communityId,
        name: "Still active",
        relays: ["wss://relay.example"],
        sections: [section],
      }).tags,
    })
    const deletion = makeEvent({
      id: "2".repeat(64),
      created_at: 11,
      kind: 5,
      tags: [
        ["a", `${COMMUNITY_DEFINITION_KIND}:${owner}:${communityId}`],
        ["a", `30000:${owner}:other`],
      ],
    })

    expect(
      selectCurrentCommunityDefinition(
        [definition, deletion],
        `${COMMUNITY_DEFINITION_KIND}:${owner}:${communityId}`,
      )?.id,
    ).toBe(definition.id)
  })
})

describe("Communikeys targeting", () => {
  it("builds and parses semantic source and community pairs without role markers", () => {
    const target = makeCommunityPointer({ownerPubkey: owner, communityId})!
    const otherTarget = makeCommunityPointer({
      ownerPubkey: otherController,
      communityId: otherCommunityId,
    })!
    const template = buildTargetedPublication({
      id: "target-id",
      kind: 31922,
      source: {type: "a", value: `31922:${owner}:event`, relay: "wss://source.example"},
      communities: [target, otherTarget],
    })

    expect(template.tags).toEqual([
      ["d", "target-id"],
      ["a", `31922:${owner}:event`, "wss://source.example"],
      ["k", "31922"],
      ["h", communityId],
      ["a", target.address],
      ["h", otherCommunityId],
      ["a", otherTarget.address],
    ])
    expect(template.kind).toBe(TARGETED_PUBLICATION_KIND)
    expect(template.tags.some(tag => tag[0] === "p")).toBe(false)
    expect(
      parseTargetedPublication(
        makeEvent({kind: TARGETED_PUBLICATION_KIND, tags: template.tags}),
      )?.communities.map(item => item.address),
    ).toEqual([target.address, otherTarget.address])
  })

  it("rejects mismatched or non-adjacent target pairs", () => {
    const pointer = makeCommunityPointer({ownerPubkey: owner, communityId})!
    const base = [
      ["d", "target-id"],
      ["k", "31922"],
      ["h", otherCommunityId],
      ["a", pointer.address],
    ]
    const separated = [
      ["d", "target-id"],
      ["k", "31922"],
      ["h", communityId],
      ["alt", "separator"],
      ["a", pointer.address],
    ]

    expect(
      parseTargetedPublication(makeEvent({kind: TARGETED_PUBLICATION_KIND, tags: base})),
    ).toBeUndefined()
    expect(
      parseTargetedPublication(makeEvent({kind: TARGETED_PUBLICATION_KIND, tags: separated})),
    ).toBeUndefined()
  })

  it("rejects malformed references, noncanonical relays, and incoherent pointers", () => {
    const pointer = makeCommunityPointer({ownerPubkey: owner, communityId})!
    const base = buildTargetedPublication({
      id: "target-id",
      kind: 31922,
      communities: [pointer],
    }).tags
    const cases = [
      base.map(tag => (tag[0] === "a" ? ["a", tag[1], "", "extra"] : tag)),
      base.map(tag => (tag[0] === "a" ? ["a", tag[1], "wss://relay.example/"] : tag)),
      base.map(tag => (tag[0] === "h" ? ["h", tag[1], "extra"] : tag)),
    ]
    for (const tags of cases) {
      expect(
        parseTargetedPublication(makeEvent({kind: TARGETED_PUBLICATION_KIND, tags})),
      ).toBeUndefined()
    }

    expect(
      parseTargetedPublication(
        makeEvent({
          kind: TARGETED_PUBLICATION_KIND,
          tags: [...base, ["x-extension", "source", "community"], ["p", communityId]],
        }),
      ),
    ).toBeTruthy()

    expect(
      parseTargetedPublication(
        makeEvent({
          kind: TARGETED_PUBLICATION_KIND,
          tags: [...base, ["a", `30009:${owner}:unclassified`]],
        }),
      ),
    ).toBeUndefined()

    expect(() =>
      buildTargetedPublication({
        id: "target-id",
        kind: 31922,
        communities: [{...pointer, address: `${pointer.address}-tampered`}],
      }),
    ).toThrow("Incoherent community target")
  })

  it("reads shipped marked V2 wrappers while normalizing replacements", () => {
    const pointer = makeCommunityPointer({ownerPubkey: owner, communityId})!
    const other = makeCommunityPointer({ownerPubkey: otherController, communityId})!
    const event = makeEvent({
      kind: TARGETED_PUBLICATION_KIND,
      tags: [
        ["d", "target-id"],
        ["e", "1".repeat(64), "", "", "source"],
        ["k", "1"],
        ["h", communityId],
        ["a", pointer.address, "", "community"],
        ["h", communityId],
        ["a", other.address, "", "community"],
      ],
    })

    expect(parseTargetedPublication(event)).toMatchObject({
      source: {type: "e", value: "1".repeat(64)},
    })
    const removed = removeTargetedCommunity(event, pointer.address)!
    expect(removed.tags).toContainEqual(["e", "1".repeat(64)])
    expect(removed.tags).toContainEqual(["a", other.address])
    expect(removed.tags.flat().includes("source")).toBe(false)
    expect(removed.tags.flat().includes("community")).toBe(false)
  })

  it("removes targets by exact definition address", () => {
    const first = makeCommunityPointer({ownerPubkey: owner, communityId})!
    const sameIdBranch = makeCommunityPointer({ownerPubkey: otherController, communityId})!
    const event = makeEvent({
      kind: TARGETED_PUBLICATION_KIND,
      tags: [
        ...buildTargetedPublication({
          id: "target-id",
          kind: 9041,
          communities: [first, sameIdBranch],
        }).tags,
        ["x-extension", "preserve-me"],
      ],
    })
    const removed = removeTargetedCommunity(event, first.address)!
    const parsed = parseTargetedPublication(
      makeEvent({kind: TARGETED_PUBLICATION_KIND, tags: removed.tags}),
    )!

    expect(parsed.communities.map(item => item.address)).toEqual([sameIdBranch.address])
    expect(parsed.communities[0].communityId).toBe(communityId)
    expect(removed.tags).toContainEqual(["x-extension", "preserve-me"])
  })

  it("selects effective wrapper replacements and applies timestamp-aware deletions", () => {
    const first = makeCommunityPointer({ownerPubkey: owner, communityId})!
    const second = makeCommunityPointer({
      ownerPubkey: otherController,
      communityId: otherCommunityId,
    })!
    const address = `${TARGETED_PUBLICATION_KIND}:${owner}:target-id`
    const original = makeEvent({
      id: "1".repeat(64),
      created_at: 10,
      kind: TARGETED_PUBLICATION_KIND,
      tags: buildTargetedPublication({id: "target-id", kind: 9041, communities: [first, second]})
        .tags,
    })
    const replacement = makeEvent({
      id: "2".repeat(64),
      created_at: 20,
      kind: TARGETED_PUBLICATION_KIND,
      tags: removeTargetedCommunity(original, first.address)!.tags,
    })
    const staleDeletion = makeEvent({
      id: "3".repeat(64),
      created_at: 19,
      kind: 5,
      tags: [["a", address]],
    })
    const idDeletion = makeEvent({
      id: "4".repeat(64),
      created_at: 20,
      kind: 5,
      tags: [["e", replacement.id]],
    })
    const deletion = makeEvent({
      id: "6".repeat(64),
      created_at: 20,
      kind: 5,
      tags: [["a", address]],
    })
    const recreation = {...replacement, id: "5".repeat(64), created_at: 21}

    expect(selectCurrentTargetedPublicationEvents([original, replacement, staleDeletion])).toEqual([
      replacement,
    ])
    expect(selectCurrentTargetedPublicationEvents([original, replacement, idDeletion])).toEqual([
      replacement,
    ])
    expect(selectCurrentTargetedPublicationEvents([original, replacement, deletion])).toEqual([])
    expect(
      selectCurrentTargetedPublicationEvents([original, replacement, deletion, recreation]),
    ).toEqual([recreation])
  })

  it("bounds targeting lifecycle expansion deterministically with exact address deletes", () => {
    const community = makeCommunityPointer({ownerPubkey: owner, communityId})!
    const candidates = Array.from(
      {length: MAX_TARGETED_PUBLICATION_LIFECYCLE_COORDINATES + 1},
      (_, index) =>
        makeEvent({
          id: index.toString(16).padStart(64, "0"),
          kind: TARGETED_PUBLICATION_KIND,
          tags: buildTargetedPublication({
            id: `target-${index.toString().padStart(3, "0")}`,
            kind: 9041,
            communities: [community],
          }).tags,
        }),
    )
    const malformed = makeEvent({
      id: "f".repeat(64),
      kind: TARGETED_PUBLICATION_KIND,
      tags: [["d", "malformed"]],
    })
    const filters = makeTargetedPublicationLifecycleFilters([malformed, ...candidates])
    const reversed = makeTargetedPublicationLifecycleFilters([...candidates].reverse())

    expect(filters).toEqual(reversed)
    expect(filters).toHaveLength(MAX_TARGETED_PUBLICATION_LIFECYCLE_COORDINATES * 2)
    expect(filters.every(filter => filter.limit === 1)).toBe(true)
    expect(filters.some(filter => "#e" in filter)).toBe(false)
    expect(filters.slice(MAX_TARGETED_PUBLICATION_LIFECYCLE_COORDINATES)).toEqual(
      filters.slice(0, MAX_TARGETED_PUBLICATION_LIFECYCLE_COORDINATES).map(filter => {
        const author = filter.authors![0]
        const identifier = filter["#d"]![0]
        return {
          kinds: [5],
          authors: [author],
          "#a": [`${TARGETED_PUBLICATION_KIND}:${author}:${identifier}`],
          limit: 1,
        }
      }),
    )
  })

  it("selects a large persisted wrapper cache without per-coordinate rescans", () => {
    const pointer = makeCommunityPointer({ownerPubkey: owner, communityId})!
    const events = Array.from({length: 2_000}, (_, index) =>
      makeEvent({
        id: index.toString(16).padStart(64, "0"),
        created_at: index + 1,
        kind: TARGETED_PUBLICATION_KIND,
        tags: buildTargetedPublication({
          id: `target-${index}`,
          kind: 31922,
          communities: [pointer],
        }).tags,
      }),
    )

    expect(selectCurrentTargetedPublicationEvents(events)).toHaveLength(events.length)
  })
})

describe("Communikeys workflow scope", () => {
  it("builds one stable h while interpreting person tags by position", () => {
    expect(makeCommunityScopeTags(communityId, [["title", "General"]])).toEqual([
      ["h", communityId],
      ["title", "General"],
    ])
    expect(() => makeCommunityScopeTags(communityId, [["h", communityId]])).toThrow()
    expect(makeCommunityScopeTags(communityId, [["p", communityId]])).toEqual([
      ["h", communityId],
      ["p", communityId],
    ])
  })

  it("adds one coherent marked branch authority reference", () => {
    const pointer = makeCommunityPointer({ownerPubkey: owner, communityId})!
    expect(makeCommunityAuthorityTags(pointer, "wss://relay.example")).toEqual([
      ["h", communityId],
      ["a", pointer.address, "wss://relay.example", "community"],
    ])
    expect(() =>
      makeCommunityAuthorityTags(pointer, undefined, [["a", pointer.address, "", "community"]]),
    ).toThrow()
  })

  it("scopes deletion requests with h only and never with an a tag", () => {
    const pointer = makeCommunityPointer({ownerPubkey: owner, communityId})!
    const otherBranch = makeCommunityPointer({ownerPubkey: getPublicKey(secret(9)), communityId})!

    expect(makeCommunityDeleteTags(pointer, [["e", "x".repeat(64)], ["k", "1984"]])).toEqual([
      ["h", communityId],
      ["e", "x".repeat(64)],
      ["k", "1984"],
    ])
    // NIP-09 makes every a tag on a kind:5 a deletion target.
    expect(() => makeCommunityDeleteTags(pointer, [["a", pointer.address, "", "community"]])).toThrow()
    expect(() => makeCommunityDeleteTags(pointer, [["a", pointer.address]])).toThrow()

    const current = makeEvent({kind: 5, tags: makeCommunityDeleteTags(pointer, [["e", "x".repeat(64)]])})
    const legacy = makeEvent({
      kind: 5,
      tags: [["h", communityId], ["a", pointer.address, "", "community"], ["e", "x".repeat(64)]],
    })
    const legacyOtherBranch = makeEvent({
      kind: 5,
      tags: [["h", communityId], ["a", otherBranch.address, "", "community"], ["e", "x".repeat(64)]],
    })
    const unscoped = makeEvent({kind: 5, tags: [["e", "x".repeat(64)]]})
    const otherCommunity = makeEvent({kind: 5, tags: [["h", otherCommunityId], ["e", "x".repeat(64)]]})
    const doubleScoped = makeEvent({kind: 5, tags: [["h", communityId], ["h", communityId]]})

    expect(deleteMatchesCommunity(current, pointer)).toBe(true)
    expect(deleteMatchesCommunity(current, otherBranch)).toBe(true)
    expect(deleteMatchesCommunity(legacy, pointer)).toBe(true)
    expect(deleteMatchesCommunity(legacyOtherBranch, pointer)).toBe(false)
    expect(deleteMatchesCommunity(unscoped, pointer)).toBe(false)
    expect(deleteMatchesCommunity(otherCommunity, pointer)).toBe(false)
    expect(deleteMatchesCommunity(doubleScoped, pointer)).toBe(false)
    expect(deleteMatchesCommunity({...current, kind: 7}, pointer)).toBe(false)
  })

  it("parses only one coherent stable and exact branch authority pair", () => {
    const pointer = makeCommunityPointer({ownerPubkey: owner, communityId})!
    const valid = makeEvent({tags: makeCommunityAuthorityTags(pointer, "wss://relay.example")})

    expect(parseCommunityAuthority(valid)?.address).toBe(pointer.address)
    expect(
      parseCommunityAuthority(
        makeEvent({
          tags: [
            ["h", communityId],
            ["a", pointer.address, "", "community"],
            ["h", communityId],
          ],
        }),
      ),
    ).toBeUndefined()
    expect(
      parseCommunityAuthority(
        makeEvent({
          tags: [
            ["h", otherCommunityId],
            ["a", pointer.address, "", "community"],
          ],
        }),
      ),
    ).toBeUndefined()
    expect(
      parseCommunityAuthority(makeEvent({tags: [...valid.tags, ["p", communityId]]}))?.address,
    ).toBe(pointer.address)
  })
})
