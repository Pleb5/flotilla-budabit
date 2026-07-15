import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {get} from "svelte/store"
import {pubkey, repository} from "@welshman/app"
import {AuthStatus} from "@welshman/net"
import {type Filter, type TrustedEvent} from "@welshman/util"
import {COMMUNITY_DEFINITION_KIND, PROFILE_LIST_KIND} from "./community"

const {
  attemptAuthMock,
  authStatusByRelay,
  forceLoadRelayListMock,
  fromPubkeysMock,
  loadMock,
  makeLoaderMock,
  socketByRelay,
} = vi.hoisted(() => ({
  attemptAuthMock: vi.fn(),
  authStatusByRelay: new Map<string, any>(),
  forceLoadRelayListMock: vi.fn(),
  fromPubkeysMock: vi.fn(),
  loadMock: vi.fn(),
  makeLoaderMock: vi.fn(),
  socketByRelay: new Map<string, any>(),
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
    makeLoader: (options: unknown) => {
      makeLoaderMock(options)
      return loadMock
    },
    Pool: {
      get: () => ({
        get: (url: string) => {
          let socket = socketByRelay.get(url)

          if (!socket) {
            socket = {
              auth: {
                get status() {
                  return authStatusByRelay.get(url) ?? actual.AuthStatus.Ok
                },
                attemptAuth: (signer: unknown) => attemptAuthMock(url, signer),
                on: vi.fn(),
                off: vi.fn(),
              },
            }
            socketByRelay.set(url, socket)
          }

          return socket
        },
      }),
    },
  }
})

vi.mock("@welshman/router", async importOriginal => {
  const actual = await importOriginal<typeof import("@welshman/router")>()

  return {
    ...actual,
    Router: {
      get: () => ({
        FromUser: () => ({getUrls: () => []}),
        FromPubkeys: fromPubkeysMock,
      }),
    },
  }
})

import {
  activeCommunityDefinition,
  activeCommunityPermissionStatus,
  activePreferredCommunities,
  authenticateCommunityRelays,
  clearActiveCommunity,
  hydrateCommunityPreferences,
  loadCommunityDefinitionWithOutboxFallback,
  loadCommunityBootstrap,
  loadCommunityEvents,
  loadCommunityEventsWithStatus,
} from "./community-state"

const communityPubkey = "a".repeat(64)
const listPubkey = "b".repeat(64)
const memberPubkey = "c".repeat(64)
const moderatorCommunityPubkey = "d".repeat(64)
const moderatorPubkey = "e".repeat(64)
const relayA = "wss://community-a.example.com/"
const relayB = "wss://community-b.example.com/"
const requiredRelay = "wss://budabit.nostr1.com/"
const publicRelay = "wss://relay.budabit.club/"
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

const singleRelayDefinitionEvent = makeEvent({
  id: "definition-single-relay",
  kind: COMMUNITY_DEFINITION_KIND,
  tags: [
    ["r", relayA],
    ["content", "General"],
    ["k", "1111"],
    ["a", `${PROFILE_LIST_KIND}:${listPubkey}:General`, relayA],
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

const flushPromises = async (count = 10) => {
  for (let i = 0; i < count; i += 1) await Promise.resolve()
}

const removeTestEvents = () => {
  for (const event of [
    definitionEvent,
    singleRelayDefinitionEvent,
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
    attemptAuthMock.mockResolvedValue(undefined)
    authStatusByRelay.clear()
    socketByRelay.clear()
    forceLoadRelayListMock.mockReset()
    fromPubkeysMock.mockReset()
    loadMock.mockReset()
    forceLoadRelayListMock.mockResolvedValue(undefined)
    fromPubkeysMock.mockReturnValue({getUrls: () => []})
    removeTestEvents()
    clearActiveCommunity()
    pubkey.set(undefined)
  })

  it("uses a dedicated priority loader for community state", () => {
    expect(makeLoaderMock).toHaveBeenCalledWith({
      delay: 50,
      priority: 300,
    })
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

  it("marks first-settled multi-relay results incomplete", async () => {
    loadMock.mockImplementation(({relays}: {relays: string[]}) => {
      if (relays[0] === relayB) return new Promise(() => undefined)

      return Promise.resolve([profileListEvent])
    })

    const result = await loadCommunityEventsWithStatus(
      [relayA, relayB],
      [{kinds: [PROFILE_LIST_KIND]}],
      {settle: "first-non-empty"},
    )

    expect(result.events.map(event => event.id)).toEqual([profileListEvent.id])
    expect(result.complete).toBe(false)
  })

  it("distinguishes complete empty loads from timeouts", async () => {
    loadMock.mockResolvedValueOnce([])

    await expect(
      loadCommunityEventsWithStatus([relayA], [{kinds: [PROFILE_LIST_KIND]}]),
    ).resolves.toEqual({events: [], complete: true, timedOutRelays: [], failedRelays: []})

    loadMock.mockReturnValueOnce(new Promise(() => undefined))
    const pending = loadCommunityEventsWithStatus([relayA], [{kinds: [PROFILE_LIST_KIND]}], {
      timeout: 100,
    })
    await vi.advanceTimersByTimeAsync(100)

    await expect(pending).resolves.toEqual({
      events: [],
      complete: false,
      timedOutRelays: [relayA],
      failedRelays: [],
    })
  })

  it("treats relay CLOSED responses as incomplete failures", async () => {
    loadMock.mockImplementationOnce(({onClosed}: any) => {
      onClosed("restricted: denied", relayA)
      return Promise.resolve([])
    })

    await expect(
      loadCommunityEventsWithStatus([relayA], [{kinds: [PROFILE_LIST_KIND]}]),
    ).resolves.toEqual({
      events: [],
      complete: false,
      timedOutRelays: [],
      failedRelays: [relayA],
    })
  })

  it("retains and publishes events received before a timeout", async () => {
    loadMock.mockImplementationOnce(({onEvent}: any) => {
      onEvent(profileListEvent, relayA)
      return new Promise(() => undefined)
    })

    const pending = loadCommunityEventsWithStatus([relayA], [{kinds: [PROFILE_LIST_KIND]}], {
      timeout: 100,
    })
    await vi.advanceTimersByTimeAsync(100)
    const result = await pending

    expect(result.complete).toBe(false)
    expect(result.events.map(event => event.id)).toEqual([profileListEvent.id])
    expect(repository.query([{ids: [profileListEvent.id]}]).map(event => event.id)).toEqual([
      profileListEvent.id,
    ])
  })

  it("authenticates priority community relays before fallback relays", async () => {
    let releasePriorityAuth: () => void = () => {}
    const priorityAuth = new Promise<void>(resolve => {
      releasePriorityAuth = resolve
    })
    const calls: string[] = []

    pubkey.set(memberPubkey)
    authStatusByRelay.set(requiredRelay, AuthStatus.Requested)
    attemptAuthMock.mockImplementation((relay: string) => {
      calls.push(relay)

      return relay === requiredRelay ? priorityAuth : Promise.resolve()
    })

    const auth = authenticateCommunityRelays([relayB, requiredRelay], {
      priorityRelays: [requiredRelay],
    })

    await Promise.resolve()
    expect(calls).toEqual([requiredRelay])

    authStatusByRelay.set(requiredRelay, AuthStatus.Ok)
    releasePriorityAuth()
    await auth

    expect(calls).toEqual([requiredRelay])
  })

  it("skips pre-authentication for the public replacement relay", async () => {
    pubkey.set(memberPubkey)
    authStatusByRelay.set(publicRelay, AuthStatus.None)

    await authenticateCommunityRelays([publicRelay])

    expect(attemptAuthMock).not.toHaveBeenCalled()
  })

  it("shares one in-flight authentication attempt per relay socket", async () => {
    let releaseAuth: () => void = () => {}
    const pendingAuth = new Promise<void>(resolve => {
      releaseAuth = resolve
    })

    pubkey.set(memberPubkey)
    authStatusByRelay.set(requiredRelay, AuthStatus.Requested)
    attemptAuthMock.mockReturnValue(pendingAuth)

    const first = authenticateCommunityRelays([requiredRelay])
    const second = authenticateCommunityRelays([requiredRelay])

    await Promise.resolve()
    expect(attemptAuthMock).toHaveBeenCalledTimes(1)

    authStatusByRelay.set(requiredRelay, AuthStatus.Ok)
    releaseAuth()
    await Promise.all([first, second])
  })

  it("continues healthy public reads when a required relay rejects authentication", async () => {
    pubkey.set(memberPubkey)
    authStatusByRelay.set(requiredRelay, AuthStatus.Forbidden)
    loadMock.mockImplementation(({relays}: {relays: string[]}) =>
      Promise.resolve(relays[0] === publicRelay ? [profileListEvent] : []),
    )

    const result = await loadCommunityEventsWithStatus(
      [requiredRelay, publicRelay],
      [{kinds: [PROFILE_LIST_KIND]}],
      {authenticate: true},
    )

    expect(result.events.map(event => event.id)).toEqual([profileListEvent.id])
    expect(result.complete).toBe(false)
    expect(result.failedRelays).toEqual([requiredRelay])
    expect(loadMock.mock.calls.map(([options]) => options.relays[0])).toEqual([publicRelay])
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

  it("tracks permission readiness separately on cache-hit bootstrap", async () => {
    let resolveProfileListLoad: (events: TrustedEvent[]) => void = () => {}
    const profileListLoad = new Promise<TrustedEvent[]>(resolve => {
      resolveProfileListLoad = resolve
    })

    repository.publish(singleRelayDefinitionEvent)
    loadMock.mockImplementation(({filters}: {relays: string[]; filters: Filter[]}) => {
      if (hasKind(filters, PROFILE_LIST_KIND)) return profileListLoad
      if (hasKind(filters, COMMUNITY_DEFINITION_KIND))
        return Promise.resolve([singleRelayDefinitionEvent])

      return Promise.resolve([])
    })

    const bootstrap = await loadCommunityBootstrap({
      communityPubkey,
      communityRelayHints: [relayA],
    })

    expect(bootstrap.definition?.event.id).toBe(singleRelayDefinitionEvent.id)
    expect(bootstrap.profileListEvents).toEqual([])
    expect(get(activeCommunityPermissionStatus)).toMatchObject({
      communityPubkey,
      loading: true,
      loaded: false,
      hasCachedEvents: false,
    })

    resolveProfileListLoad([profileListEvent])
    await flushPromises()

    expect(get(activeCommunityPermissionStatus)).toMatchObject({
      communityPubkey,
      loading: false,
      loaded: true,
    })
  })

  it("waits for community relay auth before loading bootstrap content", async () => {
    let releaseAuth: () => void = () => {}
    const authDone = new Promise<void>(resolve => {
      releaseAuth = resolve
    })

    pubkey.set(memberPubkey)
    authStatusByRelay.set(relayA, AuthStatus.Requested)
    attemptAuthMock.mockImplementation((relay: string) =>
      relay === relayA ? authDone : Promise.resolve(),
    )
    loadMock.mockImplementation(({filters}: {relays: string[]; filters: Filter[]}) => {
      if (hasKind(filters, COMMUNITY_DEFINITION_KIND)) {
        return Promise.resolve([singleRelayDefinitionEvent])
      }
      if (hasKind(filters, PROFILE_LIST_KIND)) return Promise.resolve([profileListEvent])

      return Promise.resolve([])
    })

    let settled = false
    const bootstrapPromise = loadCommunityBootstrap({
      communityPubkey,
      communityRelayHints: [relayA],
    }).then(bootstrap => {
      settled = true

      return bootstrap
    })

    await Promise.resolve()
    await Promise.resolve()

    expect(settled).toBe(false)
    expect(loadMock.mock.calls.some(([args]) => hasKind(args.filters, PROFILE_LIST_KIND))).toBe(
      false,
    )

    releaseAuth()
    const bootstrap = await bootstrapPromise

    expect(bootstrap.profileListEvents.map(event => event.id)).toEqual([profileListEvent.id])
  })

  it("fails bootstrap when no community definition loads", async () => {
    loadMock.mockResolvedValue([])

    await expect(
      loadCommunityBootstrap({
        communityPubkey,
        communityRelayHints: [relayA],
      }),
    ).rejects.toThrow("Community definition unavailable")
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
