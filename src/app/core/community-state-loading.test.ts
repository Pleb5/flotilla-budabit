import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {get} from "svelte/store"
import {pubkey, repository} from "@welshman/app"
import {type Filter, type TrustedEvent} from "@welshman/util"
import {COMMUNITY_DEFINITION_KIND, PROFILE_LIST_KIND} from "./community"

const {attemptAuthMock, forceLoadRelayListMock, fromPubkeysMock, loadMock} = vi.hoisted(() => ({
  attemptAuthMock: vi.fn(),
  forceLoadRelayListMock: vi.fn(),
  fromPubkeysMock: vi.fn(),
  loadMock: vi.fn(),
}))

vi.mock("@welshman/app", async importOriginal => {
  const actual = await importOriginal<typeof import("@welshman/app")>()

  return {
    ...actual,
    forceLoadRelayList: forceLoadRelayListMock,
  }
})

vi.mock("@welshman/net", async importOriginal => {
  const actual = await importOriginal<typeof import("@welshman/net")>()

  return {
    ...actual,
    load: loadMock,
    Pool: {
      get: () => ({
        get: () => ({auth: {status: actual.AuthStatus.Ok, attemptAuth: attemptAuthMock}}),
      }),
    },
  }
})

vi.mock("@welshman/router", () => ({
  Router: {
    get: () => ({
      FromUser: () => ({getUrls: () => []}),
      FromPubkeys: fromPubkeysMock,
    }),
  },
}))

import {
  activeCommunityDefinition,
  activePreferredCommunities,
  clearActiveCommunity,
  hydrateCommunityPreferences,
  loadCommunityDefinitionWithOutboxFallback,
  loadCommunityBootstrap,
  loadCommunityEvents,
} from "./community-state"

const communityPubkey = "a".repeat(64)
const listPubkey = "b".repeat(64)
const memberPubkey = "c".repeat(64)
const moderatorCommunityPubkey = "d".repeat(64)
const moderatorPubkey = "e".repeat(64)
const relayA = "wss://community-a.example.com/"
const relayB = "wss://community-b.example.com/"
const discoveryRelay = "wss://discovery.example.com/"
const moderatorCommunityRelay = "wss://moderator-community.example.com/"
const moderatorListIdentifier = "moderator-list"

const makeEvent = (overrides: Partial<TrustedEvent>): TrustedEvent =>
  ({
    id: "event-id",
    pubkey: communityPubkey,
    created_at: 1,
    kind: 1,
    tags: [],
    content: "",
    sig: "sig",
    ...overrides,
  }) as TrustedEvent

const definitionEvent = makeEvent({
  id: "definition",
  kind: COMMUNITY_DEFINITION_KIND,
  tags: [
    ["r", relayA],
    ["r", relayB],
    ["content", "General"],
    ["k", "1111"],
    ["a", `${PROFILE_LIST_KIND}:${listPubkey}:General`, relayA],
  ],
})

const profileListEvent = makeEvent({
  id: "general-list",
  kind: PROFILE_LIST_KIND,
  pubkey: listPubkey,
  tags: [
    ["d", "General"],
    ["p", memberPubkey],
  ],
})

const moderatorDefinitionEvent = makeEvent({
  id: "moderator-definition",
  kind: COMMUNITY_DEFINITION_KIND,
  pubkey: moderatorCommunityPubkey,
  tags: [
    ["r", moderatorCommunityRelay],
    ["content", "General"],
    ["k", "1111"],
    [
      "a",
      `${PROFILE_LIST_KIND}:${moderatorPubkey}:${moderatorListIdentifier}`,
      moderatorCommunityRelay,
    ],
  ],
})

const moderatorProfileListEvent = makeEvent({
  id: "moderator-list",
  kind: PROFILE_LIST_KIND,
  pubkey: moderatorPubkey,
  tags: [["d", moderatorListIdentifier]],
})

const hasKind = (filters: Filter[], kind: number) =>
  filters.some(filter => filter.kinds?.includes(kind))

const hasBroadCommunityDefinitionFilter = (filters: Filter[]) =>
  filters.some(filter => filter.kinds?.includes(COMMUNITY_DEFINITION_KIND) && !filter.authors)

const hasProfileListFilter = (filters: Filter[], author: string, identifier: string) =>
  filters.some(filter => {
    const dTags = (filter as Filter & {"#d"?: string[]})["#d"] || []

    return (
      filter.kinds?.includes(PROFILE_LIST_KIND) &&
      filter.authors?.includes(author) &&
      dTags.includes(identifier)
    )
  })

const removeTestEvents = () => {
  for (const event of [
    definitionEvent,
    profileListEvent,
    moderatorDefinitionEvent,
    moderatorProfileListEvent,
  ]) {
    repository.removeEvent(event.id)
  }
}

describe("community relay loading", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    attemptAuthMock.mockReset()
    forceLoadRelayListMock.mockReset()
    fromPubkeysMock.mockReset()
    loadMock.mockReset()
    forceLoadRelayListMock.mockResolvedValue(undefined)
    fromPubkeysMock.mockReturnValue({getUrls: () => []})
    removeTestEvents()
    clearActiveCommunity()
    pubkey.set(undefined)
  })

  afterEach(async () => {
    await vi.runOnlyPendingTimersAsync()
    vi.useRealTimers()
    removeTestEvents()
    clearActiveCommunity()
    pubkey.set(undefined)
  })

  it("resolves first-non-empty loads without waiting for hanging relays", async () => {
    loadMock.mockImplementation(({relays, filters}: {relays: string[]; filters: Filter[]}) => {
      if (relays[0] === relayB) return new Promise(() => undefined)
      if (hasKind(filters, COMMUNITY_DEFINITION_KIND)) return Promise.resolve([definitionEvent])

      return Promise.resolve([])
    })

    const events = await loadCommunityEvents(
      [relayB, relayA],
      [{kinds: [COMMUNITY_DEFINITION_KIND]}],
      {
        settle: "first-non-empty",
      },
    )

    expect(events.map(event => event.id)).toEqual([definitionEvent.id])
  })

  it("resolves first loads from an empty responsive relay", async () => {
    loadMock.mockImplementation(({relays}: {relays: string[]; filters: Filter[]}) => {
      if (relays[0] === relayB) return new Promise(() => undefined)

      return Promise.resolve([])
    })

    const events = await loadCommunityEvents([relayB, relayA], [{kinds: [PROFILE_LIST_KIND]}], {
      settle: "first",
    })

    expect(events).toEqual([])
  })

  it("falls back to hydrated community outbox relays when discovery misses", async () => {
    let outboxHydrated = false
    forceLoadRelayListMock.mockImplementation(async () => {
      outboxHydrated = true
    })
    fromPubkeysMock.mockReturnValue({getUrls: () => (outboxHydrated ? [relayA] : [])})
    loadMock.mockImplementation(({relays, filters}: {relays: string[]; filters: Filter[]}) => {
      if (relays[0] === relayA && hasKind(filters, COMMUNITY_DEFINITION_KIND)) {
        return Promise.resolve([definitionEvent])
      }

      return Promise.resolve([])
    })

    const definition = await loadCommunityDefinitionWithOutboxFallback(communityPubkey, {
      relayHints: [discoveryRelay],
    })

    expect(definition?.event.id).toBe(definitionEvent.id)
    expect(forceLoadRelayListMock).toHaveBeenCalledWith(
      communityPubkey,
      expect.arrayContaining([discoveryRelay]),
    )
    expect(fromPubkeysMock).toHaveBeenCalledWith([communityPubkey])
    expect(loadMock.mock.calls.map(([args]) => args.relays[0])).toEqual(
      expect.arrayContaining([discoveryRelay, relayA]),
    )
  })

  it("uses cached community outbox relays immediately while refreshing them", async () => {
    forceLoadRelayListMock.mockReturnValue(new Promise(() => undefined))
    fromPubkeysMock.mockReturnValue({getUrls: () => [relayA]})
    loadMock.mockImplementation(({relays, filters}: {relays: string[]; filters: Filter[]}) => {
      if (relays[0] === relayA && hasKind(filters, COMMUNITY_DEFINITION_KIND)) {
        return Promise.resolve([definitionEvent])
      }

      return Promise.resolve([])
    })

    const definition = await loadCommunityDefinitionWithOutboxFallback(communityPubkey, {
      relayHints: [discoveryRelay],
    })

    expect(definition?.event.id).toBe(definitionEvent.id)
    expect(forceLoadRelayListMock).toHaveBeenCalledWith(
      communityPubkey,
      expect.arrayContaining([discoveryRelay]),
    )
  })

  it("returns discovery hits before community outbox hydration finishes", async () => {
    forceLoadRelayListMock.mockReturnValue(new Promise(() => undefined))
    fromPubkeysMock.mockReturnValue({getUrls: () => []})
    loadMock.mockImplementation(({relays, filters}: {relays: string[]; filters: Filter[]}) => {
      if (relays[0] === discoveryRelay && hasKind(filters, COMMUNITY_DEFINITION_KIND)) {
        return Promise.resolve([definitionEvent])
      }

      return Promise.resolve([])
    })

    const definition = await loadCommunityDefinitionWithOutboxFallback(communityPubkey, {
      relayHints: [discoveryRelay],
    })

    expect(definition?.event.id).toBe(definitionEvent.id)
    expect(forceLoadRelayListMock).toHaveBeenCalledWith(
      communityPubkey,
      expect.arrayContaining([discoveryRelay]),
    )
    expect(loadMock.mock.calls.map(([args]) => args.relays[0])).not.toContain(relayB)
  })

  it("times out community outbox relay hydration after three seconds", async () => {
    forceLoadRelayListMock.mockReturnValue(new Promise(() => undefined))
    fromPubkeysMock.mockReturnValue({getUrls: () => []})
    loadMock.mockResolvedValue([])

    let settled = false
    const definitionPromise = loadCommunityDefinitionWithOutboxFallback(communityPubkey, {
      relayHints: [discoveryRelay],
    }).then(definition => {
      settled = true

      return definition
    })

    await vi.advanceTimersByTimeAsync(2999)
    expect(settled).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    expect(await definitionPromise).toBeUndefined()
  })

  it("times out community definition loads after three seconds", async () => {
    fromPubkeysMock.mockReturnValue({getUrls: () => [relayA]})
    loadMock.mockImplementation(({relays, filters}: {relays: string[]; filters: Filter[]}) => {
      if (relays[0] === relayA && hasKind(filters, COMMUNITY_DEFINITION_KIND)) {
        return new Promise(() => undefined)
      }

      return Promise.resolve([])
    })

    let settled = false
    const definitionPromise = loadCommunityDefinitionWithOutboxFallback(communityPubkey, {
      relayHints: [discoveryRelay],
    }).then(definition => {
      settled = true

      return definition
    })

    await vi.advanceTimersByTimeAsync(2999)
    expect(settled).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    expect(await definitionPromise).toBeUndefined()
  })

  it("resolves bootstrap state from one responsive community relay", async () => {
    loadMock.mockImplementation(({relays, filters}: {relays: string[]; filters: Filter[]}) => {
      if (relays[0] === relayB) return new Promise(() => undefined)
      if (relays[0] !== relayA) return Promise.resolve([])
      if (hasKind(filters, COMMUNITY_DEFINITION_KIND)) return Promise.resolve([definitionEvent])
      if (hasKind(filters, PROFILE_LIST_KIND)) return Promise.resolve([profileListEvent])

      return Promise.resolve([])
    })

    const bootstrap = await loadCommunityBootstrap({
      communityPubkey,
      communityRelayHints: [relayA, relayB],
    })

    expect(bootstrap.definition?.event.id).toBe(definitionEvent.id)
    expect(bootstrap.profileListEvents.map(event => event.id)).toEqual([profileListEvent.id])
    expect(get(activeCommunityDefinition)?.event.id).toBe(definitionEvent.id)
  })

  it("discovers moderator communities from indexed definitions before loading profile lists", async () => {
    pubkey.set(moderatorPubkey)
    loadMock.mockImplementation(({relays, filters}: {relays: string[]; filters: Filter[]}) => {
      if (relays[0] === discoveryRelay && hasBroadCommunityDefinitionFilter(filters)) {
        return Promise.resolve([moderatorDefinitionEvent])
      }

      if (
        relays[0] === moderatorCommunityRelay &&
        hasProfileListFilter(filters, moderatorPubkey, moderatorListIdentifier)
      ) {
        return Promise.resolve([moderatorProfileListEvent])
      }

      return Promise.resolve([])
    })

    await hydrateCommunityPreferences({relayHints: [discoveryRelay], force: true})
    await Promise.resolve()

    expect(get(activePreferredCommunities)).toContainEqual(
      expect.objectContaining({
        communityPubkey: moderatorCommunityPubkey,
        isModerator: true,
      }),
    )
  })

  it("retries preference hydration after an empty early load", async () => {
    pubkey.set(moderatorPubkey)
    loadMock.mockResolvedValue([])

    await hydrateCommunityPreferences({relayHints: [discoveryRelay], force: true})
    loadMock.mockClear()

    await hydrateCommunityPreferences({relayHints: [discoveryRelay]})

    expect(loadMock).toHaveBeenCalled()
  })

  it("loads the signed-in admin community through preference relay hints", async () => {
    pubkey.set(communityPubkey)
    loadMock.mockImplementation(({relays, filters}: {relays: string[]; filters: Filter[]}) => {
      const adminFilter = filters.find(filter => filter.kinds?.includes(COMMUNITY_DEFINITION_KIND))

      if (relays[0] === relayA && adminFilter?.authors?.includes(communityPubkey)) {
        return Promise.resolve([definitionEvent])
      }

      return Promise.resolve([])
    })

    await hydrateCommunityPreferences({relayHints: [relayA], force: true})

    expect(get(activePreferredCommunities)).toContainEqual(
      expect.objectContaining({
        communityPubkey,
        isAdmin: true,
      }),
    )
  })
})
