import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {get} from "svelte/store"
import {getPublicKey, finalizeEvent} from "nostr-tools"
import {pubkey, repository} from "@welshman/app"
import {
  AuthStatus,
  Pool,
  RelayMessageType,
  SocketEvent,
  SocketStatus,
  type Socket,
} from "@welshman/net"
import {type Filter, type TrustedEvent} from "@welshman/util"
import {
  COMMUNITY_DEFINITION_KIND,
  FORM_TEMPLATE_KIND,
  PROFILE_LIST_KIND,
  buildCommunityDefinition,
  makeCommunityAuthorityTags,
  makeCommunityPointer,
} from "./community"
import {resolvePrivateCommunityScope, makePrivateCommunityInvite} from "./private-community-scope"

const {
  forceLoadRelayMock,
  forceLoadRelayListMock,
  fromPubkeysMock,
  loadMock,
  makeLoaderMock,
  signMock,
  socketByRelay,
} = vi.hoisted(() => ({
  forceLoadRelayMock: vi.fn(),
  forceLoadRelayListMock: vi.fn(),
  fromPubkeysMock: vi.fn(),
  loadMock: vi.fn(),
  makeLoaderMock: vi.fn(),
  signMock: vi.fn(),
  socketByRelay: new Map<string, any>(),
}))

vi.mock("@welshman/app", async importOriginal => {
  const actual = await importOriginal<typeof import("@welshman/app")>()
  const signing = {sign: signMock}

  return {
    ...actual,
    forceLoadRelay: forceLoadRelayMock,
    forceLoadRelayList: forceLoadRelayListMock,
    sign: signMock,
    signer: {...actual.signer, get: () => signing},
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
        _data: socketByRelay,
        remove: (url: string) => {
          socketByRelay.get(url)?.cleanup()
          socketByRelay.delete(url)
        },
        get: (url: string) => {
          let socket = socketByRelay.get(url)

          if (!socket) {
            socket = new actual.Socket(url, [])
            socket.attemptToOpen = vi.fn()
            socketByRelay.set(url, socket)
          }

          return socket
        },
        subscribe: () => () => {},
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
  activeCommunityAdmissionFormStatus,
  activeCommunityDescriptor,
  activeExactCommunityDefinition,
  activeCommunityBootstrapStatus,
  activeCommunityPermissionStatus,
  activeExactCommunitySession,
  activePreferredCommunities,
  authenticateCommunityRelays,
  clearActiveCommunityState,
  clearActiveExactCommunity,
  clearCommunityBootstrapCache,
  ensureCommunityBootstrap,
  getCommunityPermissionReadiness,
  getCommunityPermissionStatusKeyPrefix,
  hasCommunityHydrationCompleted,
  hydrateCommunityEventsWithStatus,
  hydrateCommunityPreferences,
  isCommunityDescriptorReady,
  loadCommunityDefinitionWithOutboxFallback,
  loadCommunityBootstrap,
  loadCommunityEvents,
  loadCommunityEventsWithStatus,
  loadCommunityDefinitionFromRelays,
  makeCommunityProfileListFilters,
  recoverCommunityRelayAuth,
  recoverCommunityBootstrap,
  RelayAuthenticationTimeoutError,
  waitForCommunityRelayAuth,
  makeExactCommunitySession,
  setActiveExactCommunityPointer,
} from "./community-state"

const communityPubkey = getPublicKey(new Uint8Array(32).fill(1))
const communityId = getPublicKey(new Uint8Array(32).fill(2))
const listPubkey = getPublicKey(new Uint8Array(32).fill(3))
const secondListPubkey = getPublicKey(new Uint8Array(32).fill(4))
const memberPubkey = getPublicKey(new Uint8Array(32).fill(5))
const moderatorCommunityPubkey = getPublicKey(new Uint8Array(32).fill(6))
const moderatorPubkey = getPublicKey(new Uint8Array(32).fill(7))
const relayA = "wss://community-a.example.com/"
const relayB = "wss://community-b.example.com/"
const requiredRelay = "wss://budabit.nostr1.com/"
const publicRelay = "wss://relay.budabit.club/"
const discoveryRelay = "wss://discovery.example.com/"
const moderatorCommunityRelay = "wss://moderator-community.example.com/"
const generalListIdentifier = `${communityId}-general`
const secondaryListIdentifier = `${communityId}-secondary`
const moderatorCommunityId = getPublicKey(new Uint8Array(32).fill(8))
const moderatorListIdentifier = `${moderatorCommunityId}-moderator-list`
const community = makeCommunityPointer({
  ownerPubkey: communityPubkey,
  communityId,
  relayHints: [relayA],
})!
const communitySession = makeExactCommunitySession(community)
const makeSession = (relayHints = community.relayHints) =>
  makeExactCommunitySession(
    makeCommunityPointer({ownerPubkey: communityPubkey, communityId, relayHints})!,
  )

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
  tags: buildCommunityDefinition({
    communityId,
    name: "Community",
    relays: [relayA.slice(0, -1), relayB.slice(0, -1)],
    sections: [
      {
        name: "General",
        kinds: [{kind: 1111}],
        profileLists: [
          {
            address: `${PROFILE_LIST_KIND}:${listPubkey}:${generalListIdentifier}`,
            relay: relayA.slice(0, -1),
          },
        ],
      },
    ],
  }).tags,
})

const ownerOnlyDefinitionEvent = makeEvent({
  id: "owner-only-definition",
  kind: COMMUNITY_DEFINITION_KIND,
  tags: buildCommunityDefinition({
    communityId,
    name: "Owner and moderators",
    relays: [relayA.slice(0, -1)],
    sections: [{name: "General", kinds: [{kind: 1111}], profileLists: []}],
  }).tags,
})

const profileListEvent = makeEvent({
  id: "general-list",
  kind: PROFILE_LIST_KIND,
  pubkey: listPubkey,
  tags: [
    ["d", generalListIdentifier],
    ["p", memberPubkey],
  ],
})

const secondProfileListEvent = makeEvent({
  id: "secondary-list",
  kind: PROFILE_LIST_KIND,
  pubkey: secondListPubkey,
  tags: [
    ["d", secondaryListIdentifier],
    ["p", memberPubkey],
  ],
})

const twoListDefinitionEvent = makeEvent({
  id: "definition-two-lists",
  kind: COMMUNITY_DEFINITION_KIND,
  tags: buildCommunityDefinition({
    communityId,
    name: "Two-list community",
    relays: [relayA.slice(0, -1), relayB.slice(0, -1)],
    sections: [
      {
        name: "General",
        kinds: [{kind: 1111}],
        profileLists: [
          {
            address: `${PROFILE_LIST_KIND}:${listPubkey}:${generalListIdentifier}`,
            relay: relayA.slice(0, -1),
          },
          {
            address: `${PROFILE_LIST_KIND}:${secondListPubkey}:${secondaryListIdentifier}`,
            relay: relayB.slice(0, -1),
          },
        ],
      },
    ],
  }).tags,
})

const admissionFormEvent = makeEvent({
  id: "admission-form",
  kind: FORM_TEMPLATE_KIND,
  pubkey: listPubkey,
  tags: [
    ["d", "general-application"],
    ...makeCommunityAuthorityTags(community, relayA, [["content", "General"]]),
  ],
})

const singleRelayDefinitionEvent = makeEvent({
  id: "definition-single-relay",
  kind: COMMUNITY_DEFINITION_KIND,
  tags: buildCommunityDefinition({
    communityId,
    name: "Single-relay community",
    relays: [relayA.slice(0, -1)],
    sections: [
      {
        name: "General",
        kinds: [{kind: 1111}],
        profileLists: [
          {
            address: `${PROFILE_LIST_KIND}:${listPubkey}:${generalListIdentifier}`,
            relay: relayA.slice(0, -1),
          },
        ],
      },
    ],
  }).tags,
})

const requiredRelayDefinitionEvent = makeEvent({
  id: "definition-required-relay",
  kind: COMMUNITY_DEFINITION_KIND,
  tags: buildCommunityDefinition({
    communityId,
    name: "Required-relay community",
    relays: [requiredRelay.slice(0, -1)],
    sections: [
      {
        name: "General",
        kinds: [{kind: 1111}],
        profileLists: [
          {
            address: `${PROFILE_LIST_KIND}:${listPubkey}:${generalListIdentifier}`,
            relay: requiredRelay.slice(0, -1),
          },
        ],
      },
    ],
  }).tags,
})

const preferenceDefinitionEvent = makeEvent({
  id: "preference-definition",
  kind: COMMUNITY_DEFINITION_KIND,
  tags: buildCommunityDefinition({
    communityId,
    name: "Preference community",
    relays: [relayA.slice(0, -1)],
    sections: [
      {
        name: "General",
        kinds: [{kind: 1111}],
        profileLists: [
          {
            address: `${PROFILE_LIST_KIND}:${listPubkey}:${generalListIdentifier}`,
            relay: relayA.slice(0, -1),
          },
        ],
      },
    ],
  }).tags,
})

const moderatorPreferenceDefinitionEvent = makeEvent({
  id: "moderator-preference-definition",
  kind: COMMUNITY_DEFINITION_KIND,
  pubkey: moderatorCommunityPubkey,
  tags: buildCommunityDefinition({
    communityId: moderatorCommunityId,
    name: "Moderator community",
    relays: [moderatorCommunityRelay.slice(0, -1)],
    sections: [
      {
        name: "General",
        kinds: [{kind: 1111}],
        profileLists: [
          {
            address: `${PROFILE_LIST_KIND}:${moderatorPubkey}:${moderatorListIdentifier}`,
            relay: moderatorCommunityRelay.slice(0, -1),
          },
        ],
      },
    ],
  }).tags,
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

const hasProfileListFilter = (filters: Filter[], _author: string, identifier: string) =>
  filters.some(filter => {
    const dTags = (filter as Filter & {"#d"?: string[]})["#d"] || []

    return (
      filter.kinds?.includes(PROFILE_LIST_KIND) && !filter.authors && dTags.includes(identifier)
    )
  })

const hasMemberProfileListFilter = (
  filters: Filter[],
  _author: string,
  identifier: string,
  member: string,
) =>
  filters.some(filter => {
    const dTags = (filter as Filter & {"#d"?: string[]})["#d"] || []
    const pTags = (filter as Filter & {"#p"?: string[]})["#p"] || []

    return (
      filter.kinds?.includes(PROFILE_LIST_KIND) &&
      !filter.authors &&
      dTags.includes(identifier) &&
      pTags.includes(member)
    )
  })

const flushPromises = async (count = 10) => {
  for (let i = 0; i < count; i += 1) await Promise.resolve()
}

const getRelaySocket = (relay: string) => Pool.get().get(relay) as Socket

const makeAuthEvent = (event: Parameters<typeof finalizeEvent>[0] = signMock.mock.lastCall![0]) =>
  finalizeEvent(event, new Uint8Array(32).fill(5))

const sendAuthChallenge = (socket: Socket, challenge = "challenge") => {
  socket.emit(SocketEvent.Receiving, [RelayMessageType.Auth, challenge], socket.url)
}

const acceptAuth = (socket: Socket) => {
  expect(socket.auth.request).toBeTruthy()
  socket.emit(
    SocketEvent.Receive,
    [RelayMessageType.Ok, socket.auth.request, true, "authenticated"],
    socket.url,
  )
}

const removeTestEvents = () => {
  for (const event of [
    definitionEvent,
    ownerOnlyDefinitionEvent,
    twoListDefinitionEvent,
    singleRelayDefinitionEvent,
    requiredRelayDefinitionEvent,
    profileListEvent,
    secondProfileListEvent,
    admissionFormEvent,
    moderatorProfileListEvent,
  ]) {
    repository.removeEvent(event.id)
  }
  repository.removeEvent("definition-newer")
  repository.removeEvent("general-list-newer")
  repository.removeEvent("other-definition")
}

describe("community relay loading", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    forceLoadRelayMock.mockReset()
    forceLoadRelayMock.mockResolvedValue(undefined)
    socketByRelay.clear()
    forceLoadRelayListMock.mockReset()
    fromPubkeysMock.mockReset()
    loadMock.mockReset()
    forceLoadRelayListMock.mockResolvedValue(undefined)
    fromPubkeysMock.mockReturnValue({getUrls: () => []})
    signMock.mockReset()
    signMock.mockImplementation(async event => makeAuthEvent(event))
    removeTestEvents()
    clearActiveCommunityState()
    clearActiveExactCommunity()
    setActiveExactCommunityPointer(community)
    pubkey.set(undefined)
  })

  it("isolates community state requests in their requested priority lanes", async () => {
    loadMock.mockResolvedValue([])

    await loadCommunityEvents([relayA], [{kinds: [1]}], {priority: -100})
    await loadCommunityEvents([relayA], [{kinds: [2]}])
    await loadCommunityEvents([relayA], [{kinds: [3]}], {priority: 350})

    expect(makeLoaderMock).toHaveBeenCalledWith({delay: 50, priority: -100})
    expect(makeLoaderMock).toHaveBeenCalledWith({delay: 50, priority: 300})
    expect(makeLoaderMock).toHaveBeenCalledWith({delay: 50, priority: 350})
  })

  afterEach(async () => {
    await vi.runOnlyPendingTimersAsync()
    await flushPromises(30)
    for (const socket of socketByRelay.values()) socket.cleanup()
    vi.useRealTimers()
    removeTestEvents()
    clearActiveCommunityState()
    clearActiveExactCommunity()
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

  it("does not let an invalid definition hide a valid response from another relay", async () => {
    const invalidDefinition = {...definitionEvent, id: "invalid-definition", content: "invalid"}
    loadMock.mockImplementation(({relays}: {relays: string[]}) =>
      Promise.resolve(relays[0] === relayA ? [invalidDefinition] : [definitionEvent]),
    )

    const definition = await loadCommunityDefinitionFromRelays(community, [relayA, relayB])

    expect(definition?.event.id).toBe(definitionEvent.id)
  })

  it("ignores an invalid definition when every relay completed", async () => {
    const invalidDefinition = {...definitionEvent, id: "invalid-definition", content: "invalid"}
    loadMock.mockResolvedValue([invalidDefinition])

    await expect(loadCommunityDefinitionFromRelays(community, [relayA])).resolves.toBeUndefined()
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

  it("reports progressive and terminal results after an early multi-relay result", async () => {
    let resolveRelayB: (events: TrustedEvent[]) => void = () => {}
    const relayBLoad = new Promise<TrustedEvent[]>(resolve => {
      resolveRelayB = resolve
    })
    const progress: Array<{
      result: {complete: boolean; events: TrustedEvent[]}
      terminal: boolean
    }> = []
    loadMock.mockImplementation(({relays}: {relays: string[]}) =>
      relays[0] === relayB ? relayBLoad : Promise.resolve([profileListEvent]),
    )

    const firstResult = await loadCommunityEventsWithStatus(
      [relayA, relayB],
      [{kinds: [PROFILE_LIST_KIND]}],
      {
        settle: "first-non-empty",
        onProgress: (result, terminal) => progress.push({result, terminal}),
      },
    )

    expect(firstResult).toMatchObject({complete: false, events: [profileListEvent]})
    expect(progress).toMatchObject([
      {result: {complete: false, events: [profileListEvent]}, terminal: false},
    ])

    resolveRelayB([])
    await flushPromises()

    expect(progress.at(-1)).toMatchObject({
      result: {complete: true, events: [profileListEvent]},
      terminal: true,
    })
  })

  it("reports a timed-out relay as one terminal update after an early result", async () => {
    const progress: Array<{
      result: {complete: boolean; timedOutRelays: string[]}
      terminal: boolean
    }> = []
    loadMock.mockImplementation(({relays, onStart}: {relays: string[]; onStart?: () => void}) => {
      onStart?.()
      return relays[0] === relayB
        ? new Promise(() => undefined)
        : Promise.resolve([profileListEvent])
    })

    await loadCommunityEventsWithStatus([relayA, relayB], [{kinds: [PROFILE_LIST_KIND]}], {
      timeout: 100,
      settle: "first-non-empty",
      onProgress: (result, terminal) => progress.push({result, terminal}),
    })
    await vi.advanceTimersByTimeAsync(100)

    const terminalUpdates = progress.filter(item => item.terminal)
    expect(terminalUpdates).toHaveLength(1)
    expect(terminalUpdates[0]).toMatchObject({
      result: {complete: false, timedOutRelays: [relayB]},
      terminal: true,
    })
  })

  it("classifies current authority readiness without accepting stale generations", () => {
    const expectedKeyPrefix = `viewer:definition:relay:`
    const baseStatus = {
      communityAddress: community.address,
      key: `${expectedKeyPrefix}1`,
      loading: true,
      loaded: true,
      complete: false,
      hasCachedEvents: false,
    }

    expect(
      getCommunityPermissionReadiness({
        status: baseStatus,
        communityAddress: community.address,
        expectedKeyPrefix,
      }),
    ).toBe("loading")
    expect(
      getCommunityPermissionReadiness({
        status: {...baseStatus, hasCachedEvents: true},
        communityAddress: community.address,
        expectedKeyPrefix,
      }),
    ).toBe("ready")
    expect(
      getCommunityPermissionReadiness({
        status: {...baseStatus, loading: false},
        communityAddress: community.address,
        expectedKeyPrefix,
      }),
    ).toBe("unavailable")
    expect(
      getCommunityPermissionReadiness({
        status: {...baseStatus, key: "viewer:older-definition:relay:1"},
        communityAddress: community.address,
        expectedKeyPrefix,
      }),
    ).toBe("loading")
    const sibling = makeCommunityPointer({
      ownerPubkey: community.ownerPubkey,
      communityId: getPublicKey(new Uint8Array(32).fill(11)),
    })!
    expect(
      getCommunityPermissionReadiness({
        status: {...baseStatus, hasCachedEvents: true},
        communityAddress: sibling.address,
        expectedKeyPrefix,
      }),
    ).toBe("loading")
  })

  it("keeps active descriptors coherent while switching same-owner branches", () => {
    repository.publish(definitionEvent)
    const definition = get(activeExactCommunityDefinition)!
    const permissionKeyPrefix = getCommunityPermissionStatusKeyPrefix(
      definition,
      definition.relays,
      "",
    )
    activeCommunityPermissionStatus.set({
      communityAddress: community.address,
      key: `${permissionKeyPrefix}1`,
      loading: false,
      loaded: true,
      complete: true,
      hasCachedEvents: true,
    })
    expect(get(activeCommunityDescriptor)?.authorityReadiness.state).toBe("ready")

    const sibling = makeCommunityPointer({
      ownerPubkey: community.ownerPubkey,
      communityId: getPublicKey(new Uint8Array(32).fill(11)),
      relayHints: ["wss://sibling-hint.example.com/"],
    })!
    const siblingDefinitionEvent = makeEvent({
      id: "other-definition",
      kind: COMMUNITY_DEFINITION_KIND,
      tags: buildCommunityDefinition({
        communityId: sibling.communityId,
        name: "Sibling community",
        relays: ["wss://sibling.example.com"],
        sections: [{name: "General", kinds: [{kind: 1111}], profileLists: []}],
      }).tags,
    })
    repository.publish(siblingDefinitionEvent)

    const snapshots: Array<{
      communityAddress: string
      definitionAddress?: string
      relays: string[]
      authorityAddress: string
      authorityState: string
      widgetReady: boolean
    }> = []
    const unsubscribe = activeCommunityDescriptor.subscribe(descriptor => {
      if (!descriptor) return
      snapshots.push({
        communityAddress: descriptor.community.address,
        definitionAddress: descriptor.definition?.pointer.address,
        relays: descriptor.relays,
        authorityAddress: descriptor.authorityReadiness.communityAddress,
        authorityState: descriptor.authorityReadiness.state,
        widgetReady: isCommunityDescriptorReady(descriptor, descriptor.community.address),
      })
    })

    setActiveExactCommunityPointer(sibling)
    const sameIdBranch = makeCommunityPointer({
      ownerPubkey: getPublicKey(new Uint8Array(32).fill(12)),
      communityId: community.communityId,
      relayHints: ["wss://same-id-hint.example.com/"],
    })!
    repository.publish(
      makeEvent({
        id: "definition-newer",
        pubkey: sameIdBranch.ownerPubkey,
        kind: COMMUNITY_DEFINITION_KIND,
        tags: buildCommunityDefinition({
          communityId: sameIdBranch.communityId,
          name: "Same ID branch",
          relays: ["wss://same-id.example.com"],
          sections: [{name: "General", kinds: [{kind: 1111}], profileLists: []}],
        }).tags,
      }),
    )
    setActiveExactCommunityPointer(sameIdBranch)
    unsubscribe()

    for (const branch of [sibling, sameIdBranch]) {
      const branchSnapshots = snapshots.filter(
        snapshot => snapshot.communityAddress === branch.address,
      )
      expect(branchSnapshots.length).toBeGreaterThan(0)
      expect(
        branchSnapshots.every(
          snapshot =>
            (!snapshot.definitionAddress || snapshot.definitionAddress === branch.address) &&
            snapshot.authorityAddress === branch.address &&
            snapshot.authorityState === "loading" &&
            !snapshot.widgetReady &&
            snapshot.relays.every(relay => !definition.relays.includes(relay)),
        ),
      ).toBe(true)
    }
  })

  it("distinguishes complete empty loads from timeouts", async () => {
    loadMock.mockResolvedValueOnce([])

    await expect(
      loadCommunityEventsWithStatus([relayA], [{kinds: [PROFILE_LIST_KIND]}]),
    ).resolves.toEqual({
      events: [],
      complete: true,
      timedOutRelays: [],
      failedRelays: [],
      outcomes: {[relayA]: "complete"},
    })

    loadMock.mockImplementationOnce(({onStart}: {onStart?: () => void}) => {
      onStart?.()
      return new Promise(() => undefined)
    })
    const pending = loadCommunityEventsWithStatus([relayA], [{kinds: [PROFILE_LIST_KIND]}], {
      timeout: 100,
    })
    await vi.advanceTimersByTimeAsync(100)

    await expect(pending).resolves.toEqual({
      events: [],
      complete: false,
      timedOutRelays: [relayA],
      failedRelays: [],
      outcomes: {[relayA]: "timeout"},
    })
  })

  it("loads invitation hints through the normal shared repository without discovery fallback", async () => {
    const relay = "wss://invitation-loading.test/"
    pubkey.set(memberPubkey)
    Pool.get().get(relay).auth.setStatus(AuthStatus.Ok)
    const pointer = makeCommunityPointer({
      ownerPubkey: communityPubkey,
      communityId: "e".repeat(64),
      relayHints: [relay],
    })!
    resolvePrivateCommunityScope(
      new URL(makePrivateCommunityInvite(pointer, [relay]), "https://app.test"),
    )
    const definition = makeEvent({
      kind: COMMUNITY_DEFINITION_KIND,
      pubkey: pointer.ownerPubkey,
      tags: buildCommunityDefinition({
        communityId: pointer.communityId,
        name: "Invited community",
        readAccess: "members",
        relays: [relay],
        sections: [{name: "General", kinds: [{kind: 1}], profileLists: []}],
      }).tags,
    })
    loadMock.mockImplementationOnce(({onEvent}: any) => {
      onEvent(definition, relay)
      return Promise.resolve([definition])
    })
    try {
      await loadCommunityDefinitionWithOutboxFallback(pointer, {relayHints: [relayB]})
      expect(loadMock.mock.calls.map(([options]) => options.relays)).toEqual([[relay]])
      expect(forceLoadRelayListMock).not.toHaveBeenCalled()
      expect(fromPubkeysMock).not.toHaveBeenCalled()
      expect(repository.query([{ids: [definition.id]}])).toEqual([definition])
    } finally {
      repository.removeEvent(definition.id)
    }
  })

  it("starts the relay timeout when queued work physically starts", async () => {
    loadMock.mockImplementationOnce(
      ({onStart, signal}: any) =>
        new Promise(resolve => {
          setTimeout(() => onStart?.(relayA), 5000)
          signal?.addEventListener("abort", () => resolve([]), {once: true})
        }),
    )
    let settled = false
    const pending = loadCommunityEventsWithStatus([relayA], [{kinds: [PROFILE_LIST_KIND]}], {
      timeout: 100,
    }).then(result => {
      settled = true
      return result
    })

    await vi.advanceTimersByTimeAsync(5000)
    await vi.advanceTimersByTimeAsync(99)
    expect(settled).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    await expect(pending).resolves.toMatchObject({
      complete: false,
      timedOutRelays: [relayA],
    })
  })

  it("uses a separate admission deadline while relay work remains queued", async () => {
    loadMock.mockImplementationOnce(
      ({signal}: any) =>
        new Promise(resolve => {
          signal?.addEventListener("abort", () => resolve([]), {once: true})
        }),
    )
    let settled = false
    const pending = loadCommunityEventsWithStatus([relayA], [{kinds: [PROFILE_LIST_KIND]}], {
      timeout: 100,
    }).then(result => {
      settled = true
      return result
    })

    await vi.advanceTimersByTimeAsync(29_999)
    expect(settled).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    await expect(pending).resolves.toMatchObject({
      complete: false,
      timedOutRelays: [relayA],
    })
  })

  it("settles queued relay work immediately when the caller aborts", async () => {
    const controller = new AbortController()
    loadMock.mockImplementationOnce(
      ({signal}: any) =>
        new Promise(resolve => {
          signal?.addEventListener("abort", () => resolve([]), {once: true})
        }),
    )
    const pending = loadCommunityEventsWithStatus([relayA], [{kinds: [PROFILE_LIST_KIND]}], {
      signal: controller.signal,
      timeout: 100,
    })

    controller.abort()

    await expect(pending).resolves.toEqual({
      events: [],
      complete: false,
      timedOutRelays: [],
      failedRelays: [],
      outcomes: {[relayA]: "auth-cancelled"},
    })
    expect(loadMock.mock.calls[0][0].signal.aborted).toBe(true)
  })

  it("does not treat non-empty authority filters as complete without relays", async () => {
    const onProgress = vi.fn()

    await expect(
      loadCommunityEventsWithStatus([], [{kinds: [PROFILE_LIST_KIND]}], {onProgress}),
    ).resolves.toEqual({events: [], complete: false, timedOutRelays: [], failedRelays: []})
    expect(onProgress).toHaveBeenCalledWith(
      {events: [], complete: false, timedOutRelays: [], failedRelays: []},
      true,
    )
  })

  it("keeps timed-out route hydration incomplete and retryable", async () => {
    const statuses: string[] = []
    const hydrationKey = "test:route-timeout"
    loadMock.mockImplementationOnce(({onStart, relays}: any) => {
      onStart?.(relays[0])
      return new Promise(() => undefined)
    })

    const pending = hydrateCommunityEventsWithStatus({
      key: hydrationKey,
      relays: [relayA],
      filters: [{kinds: [PROFILE_LIST_KIND]}],
      timeout: 100,
      onStatus: status => statuses.push(status),
    })
    await vi.advanceTimersByTimeAsync(100)

    await expect(pending).resolves.toMatchObject({complete: false, timedOutRelays: [relayA]})
    expect(statuses).toEqual(["queued", "loading", "incomplete"])
    expect(hasCommunityHydrationCompleted(hydrationKey)).toBe(false)
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
      outcomes: {[relayA]: "denied"},
    })
    expect(loadMock).toHaveBeenCalledOnce()
    expect(signMock).not.toHaveBeenCalled()
  })

  it("retries unavailable policy once without re-signing or narrowing the history filter", async () => {
    loadMock
      .mockImplementationOnce(({onClosed}: any) => {
        onClosed("error: community read policy temporarily unavailable", relayA)
        return Promise.resolve([])
      })
      .mockResolvedValueOnce([profileListEvent])
    const filters = [{kinds: [PROFILE_LIST_KIND]}]
    const pending = loadCommunityEventsWithStatus([relayA], filters)
    await vi.advanceTimersByTimeAsync(200)
    await expect(pending).resolves.toMatchObject({complete: true, outcomes: {[relayA]: "complete"}})
    expect(loadMock).toHaveBeenCalledTimes(2)
    expect(loadMock.mock.calls.map(([options]) => options.filters)).toEqual([filters, filters])
    expect(signMock).not.toHaveBeenCalled()
  })

  it("leaves persistent policy unavailability incomplete after one retry", async () => {
    loadMock.mockImplementation(({onClosed}: any) => {
      onClosed("error: community read policy temporarily unavailable", relayA)
      return Promise.resolve([])
    })
    const pending = loadCommunityEventsWithStatus([relayA], [{kinds: [PROFILE_LIST_KIND]}])
    await vi.advanceTimersByTimeAsync(200)
    await expect(pending).resolves.toMatchObject({
      complete: false,
      outcomes: {[relayA]: "policy-unavailable"},
    })
    expect(loadMock).toHaveBeenCalledTimes(2)
  })

  it("honors publishEvents:false and ignores late callbacks from a cancelled loader", async () => {
    let receive!: (event: TrustedEvent, relay: string) => void
    loadMock.mockImplementationOnce(({onEvent, onStart}: any) => {
      receive = onEvent
      onStart(relayA)
      onEvent(profileListEvent, relayA)
      return new Promise(() => undefined)
    })
    const pending = loadCommunityEventsWithStatus([relayA], [{kinds: [PROFILE_LIST_KIND]}], {
      publishEvents: false,
      timeout: 100,
    })
    await vi.advanceTimersByTimeAsync(100)
    const result = await pending
    receive(secondProfileListEvent, relayA)
    expect(result.complete).toBe(false)
    expect(result.events).toEqual([profileListEvent])
    expect(repository.query([{ids: [profileListEvent.id, secondProfileListEvent.id]}])).toEqual([])
  })

  it("retains and publishes events received before a timeout", async () => {
    loadMock.mockImplementationOnce(({onEvent, onStart}: any) => {
      onStart?.(relayA)
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

  it("waits through nonterminal auth transitions until the relay accepts", async () => {
    let releaseSignature: (event: ReturnType<typeof makeAuthEvent>) => void = () => {}
    const socket = getRelaySocket(requiredRelay)
    signMock.mockImplementation(
      event =>
        new Promise(resolve => {
          releaseSignature = resolve
        }),
    )
    sendAuthChallenge(socket)
    pubkey.set(memberPubkey)

    let settled = false
    const authentication = authenticateCommunityRelays([requiredRelay]).then(result => {
      settled = true
      return result
    })

    await flushPromises()
    expect(socket.auth.status).toBe(AuthStatus.PendingSignature)
    expect(settled).toBe(false)

    releaseSignature(makeAuthEvent())
    await flushPromises()
    expect(socket.auth.status).toBe(AuthStatus.PendingResponse)
    expect(settled).toBe(false)

    acceptAuth(socket)
    await expect(authentication).resolves.toEqual([])
  })

  it("rejects auth waits with a typed timeout", async () => {
    const socket = getRelaySocket(requiredRelay)
    sendAuthChallenge(socket)
    const pending = waitForCommunityRelayAuth(socket.auth, 100)
    const rejected = expect(pending).rejects.toBeInstanceOf(RelayAuthenticationTimeoutError)

    socket.auth.setStatus(AuthStatus.PendingSignature)
    socket.auth.setStatus(AuthStatus.PendingResponse)
    await vi.advanceTimersByTimeAsync(100)

    await rejected
  })

  it("fails auth waits when the socket disconnects", async () => {
    const socket = getRelaySocket(requiredRelay)
    sendAuthChallenge(socket)
    const pending = waitForCommunityRelayAuth(socket.auth, 1000)

    socket.emit(SocketEvent.Status, SocketStatus.Error, socket.url)

    await expect(pending).rejects.toThrow("Authentication failed")
  })

  it("skips pre-authentication for the public replacement relay", async () => {
    pubkey.set(memberPubkey)

    await authenticateCommunityRelays([publicRelay])

    expect(signMock).not.toHaveBeenCalled()
    expect(socketByRelay.has(publicRelay)).toBe(false)
  })

  it("does not turn an AUTH handshake rejection into community access denial", async () => {
    const socket = getRelaySocket(requiredRelay)
    const attemptAuth = vi.spyOn(socket.auth, "attemptAuth")
    const {deriveRelayAccessError, relaysMostlyRestricted} = await import("./state")
    let authError: string | undefined
    const unsubscribe = deriveRelayAccessError(requiredRelay).subscribe(error => {
      authError = error
    })

    socket.auth.details = "error: AUTH disabled"
    socket.auth.setStatus(AuthStatus.Forbidden)
    await flushPromises()

    expect(authError).toBeUndefined()
    // Actual rejected requests still produce an access issue, independently of
    // whether the relay accepts or rejects the optional handshake.
    relaysMostlyRestricted.set({[requiredRelay]: "restricted: read access denied"})
    expect(authError).toBe("read access denied")
    relaysMostlyRestricted.set({})
    expect(authError).toBeUndefined()
    expect(attemptAuth).not.toHaveBeenCalled()
    unsubscribe()
  })

  it("shares one in-flight authentication attempt per relay socket", async () => {
    let releaseSignature: (event: ReturnType<typeof makeAuthEvent>) => void = () => {}
    const socket = getRelaySocket(requiredRelay)
    signMock.mockImplementation(
      () =>
        new Promise(resolve => {
          releaseSignature = resolve
        }),
    )

    pubkey.set(memberPubkey)
    sendAuthChallenge(socket)

    const first = authenticateCommunityRelays([requiredRelay])
    const second = authenticateCommunityRelays([requiredRelay])

    await flushPromises()
    expect(signMock).toHaveBeenCalledTimes(1)

    releaseSignature(makeAuthEvent())
    await flushPromises()
    acceptAuth(socket)
    await Promise.all([first, second])
  })

  it("turns signer rejection into a terminal auth failure", async () => {
    const socket = getRelaySocket(requiredRelay)
    pubkey.set(memberPubkey)
    signMock.mockRejectedValue(new Error("User rejected signing"))
    sendAuthChallenge(socket)

    await expect(authenticateCommunityRelays([requiredRelay])).resolves.toEqual([requiredRelay])
    expect(socket.auth.status).toBe(AuthStatus.DeniedSignature)
  })

  it("explicitly retries a denied signature for the same challenge", async () => {
    const socket = getRelaySocket(requiredRelay)
    pubkey.set(memberPubkey)
    signMock.mockRejectedValueOnce(new Error("User rejected signing"))
    sendAuthChallenge(socket, "same-challenge")
    await expect(authenticateCommunityRelays([requiredRelay])).resolves.toEqual([requiredRelay])

    const retryAuth = vi.spyOn(socket.auth, "retryAuth")
    signMock.mockImplementation(async event => makeAuthEvent(event))
    const retried = recoverCommunityRelayAuth(requiredRelay)
    await flushPromises()
    acceptAuth(socket)

    await expect(retried).resolves.toBeUndefined()
    expect(retryAuth).toHaveBeenCalledOnce()
    expect(signMock).toHaveBeenCalledTimes(2)
  })

  it("explicitly retries a challenged optional relay", async () => {
    const socket = getRelaySocket(relayA)
    pubkey.set(memberPubkey)
    sendAuthChallenge(socket, "optional-challenge")
    socket.auth.setStatus(AuthStatus.DeniedSignature)
    const retryAuth = vi.spyOn(socket.auth, "retryAuth")
    signMock.mockImplementation(async event => makeAuthEvent(event))

    const retried = recoverCommunityRelayAuth(relayA)
    await flushPromises()
    acceptAuth(socket)

    await expect(retried).resolves.toBeUndefined()
    expect(retryAuth).toHaveBeenCalledOnce()
    expect(signMock).toHaveBeenCalledOnce()
  })

  it("does not retry relay auth after a forbidden response", async () => {
    const socket = getRelaySocket(requiredRelay)
    const retryAuth = vi.spyOn(socket.auth, "retryAuth")
    pubkey.set(memberPubkey)
    socket.auth.setStatus(AuthStatus.Forbidden)

    await expect(recoverCommunityRelayAuth(requiredRelay)).rejects.toThrow(
      "authentication forbidden",
    )
    expect(retryAuth).not.toHaveBeenCalled()
    expect(signMock).not.toHaveBeenCalled()
  })

  it("does not overwrite bootstrap status when recovery is superseded", async () => {
    let releaseSignature: (event: ReturnType<typeof makeAuthEvent>) => void = () => {}
    const otherCommunityPubkey = getPublicKey(new Uint8Array(32).fill(9))
    const socket = getRelaySocket(requiredRelay)
    repository.publish(requiredRelayDefinitionEvent)
    setActiveExactCommunityPointer(community)
    pubkey.set(memberPubkey)
    signMock.mockImplementation(
      () =>
        new Promise(resolve => {
          releaseSignature = resolve
        }),
    )
    sendAuthChallenge(socket)

    const recovery = recoverCommunityBootstrap(makeSession([requiredRelay]), {
      recoverAuth: true,
      authTimeout: 1000,
    })
    await flushPromises()
    setActiveExactCommunityPointer(
      makeCommunityPointer({ownerPubkey: otherCommunityPubkey, communityId})!,
    )
    activeCommunityBootstrapStatus.set({
      key: `:${otherCommunityPubkey}:`,
      loading: true,
      loaded: false,
    })
    releaseSignature(makeAuthEvent())
    await flushPromises()
    acceptAuth(socket)

    await expect(recovery).rejects.toThrow("superseded")
    expect(get(activeCommunityBootstrapStatus).key).toBe(`:${otherCommunityPubkey}:`)
  })

  it("can retry authentication after a new challenge", async () => {
    const socket = getRelaySocket(requiredRelay)
    pubkey.set(memberPubkey)
    signMock.mockRejectedValueOnce(new Error("User rejected signing"))
    sendAuthChallenge(socket, "first-challenge")
    await expect(authenticateCommunityRelays([requiredRelay])).resolves.toEqual([requiredRelay])

    signMock.mockImplementation(async event => makeAuthEvent(event))
    sendAuthChallenge(socket, "second-challenge")
    const retried = authenticateCommunityRelays([requiredRelay])
    await flushPromises()
    acceptAuth(socket)

    await expect(retried).resolves.toEqual([])
    expect(signMock).toHaveBeenCalledTimes(2)
  })

  it("continues healthy public reads when a required relay rejects authentication", async () => {
    pubkey.set(memberPubkey)
    getRelaySocket(requiredRelay).auth.setStatus(AuthStatus.Forbidden)
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

  it("forwards a dedicated auth wait timeout from relay loads", async () => {
    const socket = getRelaySocket(requiredRelay)
    pubkey.set(memberPubkey)
    signMock.mockReturnValue(new Promise(() => undefined))
    sendAuthChallenge(socket)

    const pending = loadCommunityEventsWithStatus([requiredRelay], [{kinds: [PROFILE_LIST_KIND]}], {
      authenticate: true,
      authTimeout: 100,
      timeout: 1000,
    })
    await vi.advanceTimersByTimeAsync(100)

    await expect(pending).resolves.toMatchObject({
      complete: false,
      failedRelays: [requiredRelay],
    })
    expect(loadMock).not.toHaveBeenCalled()
  })

  it("explicitly recovers when a timed-out pending signature later fails", async () => {
    let rejectInitialSignature: (error: Error) => void = () => {}
    const socket = getRelaySocket(requiredRelay)
    pubkey.set(memberPubkey)
    signMock
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectInitialSignature = reject
          }),
      )
      .mockImplementation(async event => makeAuthEvent(event))
    sendAuthChallenge(socket)

    const initial = authenticateCommunityRelays([requiredRelay], {timeout: 100})
    await vi.advanceTimersByTimeAsync(100)
    await expect(initial).resolves.toEqual([requiredRelay])
    expect(socket.auth.status).toBe(AuthStatus.DeniedSignature)

    const retryAuth = vi.spyOn(socket.auth, "retryAuth")
    const recovery = recoverCommunityRelayAuth(requiredRelay, {timeout: 1000})
    rejectInitialSignature(new Error("Initial bunker request expired"))
    await flushPromises()
    acceptAuth(socket)

    await expect(recovery).resolves.toBeUndefined()
    expect(retryAuth).toHaveBeenCalledOnce()
    expect(signMock).toHaveBeenCalledTimes(2)
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

    const definition = await loadCommunityDefinitionWithOutboxFallback(community, {
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

    const definition = await loadCommunityDefinitionWithOutboxFallback(community, {
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

    const definition = await loadCommunityDefinitionWithOutboxFallback(community, {
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
    const definitionPromise = loadCommunityDefinitionWithOutboxFallback(community, {
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
    loadMock.mockImplementation(
      ({relays, filters, onStart}: {relays: string[]; filters: Filter[]; onStart?: () => void}) => {
        if (relays[0] === relayA && hasKind(filters, COMMUNITY_DEFINITION_KIND)) {
          onStart?.()
          return new Promise(() => undefined)
        }

        return Promise.resolve([])
      },
    )

    let settled = false
    const definitionPromise = loadCommunityDefinitionWithOutboxFallback(community, {
      relayHints: [discoveryRelay],
    })
    const resultPromise = definitionPromise.then(
      definition => {
        settled = true
        return definition
      },
      error => {
        settled = true
        throw error
      },
    )
    const rejection = expect(resultPromise).rejects.toThrow(
      `Community definition relay lookup did not complete (${relayA}).`,
    )

    await vi.advanceTimersByTimeAsync(2999)
    expect(settled).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    await rejection
  })

  it("uses authority from one responsive relay without requiring an admission form", async () => {
    loadMock.mockImplementation(({relays, filters}: {relays: string[]; filters: Filter[]}) => {
      if (relays[0] === relayB) return new Promise(() => undefined)
      if (relays[0] !== relayA) return Promise.resolve([])
      if (hasKind(filters, COMMUNITY_DEFINITION_KIND)) return Promise.resolve([definitionEvent])
      if (hasKind(filters, PROFILE_LIST_KIND)) return Promise.resolve([profileListEvent])
      if (hasKind(filters, FORM_TEMPLATE_KIND)) return Promise.resolve([])

      return Promise.resolve([])
    })

    const bootstrap = await loadCommunityBootstrap(makeSession([relayA, relayB]))

    expect(bootstrap.definition?.event.id).toBe(definitionEvent.id)
    expect(bootstrap.profileListEvents.map(event => event.id)).toEqual([profileListEvent.id])
    expect(get(activeExactCommunityDefinition)?.event.id).toBe(definitionEvent.id)
    expect(get(activeCommunityPermissionStatus)).toMatchObject({
      loading: true,
      loaded: true,
      complete: false,
      hasCachedEvents: true,
    })
    expect(get(activeCommunityAdmissionFormStatus)).toMatchObject({
      loading: true,
      loaded: false,
      complete: false,
      hasCachedEvents: false,
    })
  })

  it("settles owner-only authority without requesting profile lists", async () => {
    let profileListLoads = 0
    loadMock.mockImplementation(({filters}: {filters: Filter[]}) => {
      if (hasKind(filters, COMMUNITY_DEFINITION_KIND)) {
        return Promise.resolve([ownerOnlyDefinitionEvent])
      }
      if (hasKind(filters, PROFILE_LIST_KIND)) profileListLoads += 1
      return Promise.resolve([])
    })

    const bootstrap = await loadCommunityBootstrap(makeSession([relayA]))
    await flushPromises()

    expect(makeCommunityProfileListFilters(bootstrap.definition!)).toEqual([])
    expect(profileListLoads).toBe(0)
    expect(get(activeCommunityPermissionStatus)).toMatchObject({
      loading: false,
      loaded: true,
      complete: true,
      hasCachedEvents: true,
    })
  })

  it("keeps partial authority evidence usable when other referenced lists are pending", async () => {
    loadMock.mockImplementation(({relays, filters, onClosed, onEvent}: any) => {
      if (hasKind(filters, COMMUNITY_DEFINITION_KIND)) {
        return Promise.resolve([twoListDefinitionEvent])
      }
      if (hasKind(filters, FORM_TEMPLATE_KIND)) return Promise.resolve([])
      if (hasKind(filters, PROFILE_LIST_KIND)) {
        if (relays[0] === relayA) {
          onEvent?.(profileListEvent, relayA)
          return Promise.resolve([profileListEvent])
        }

        onClosed?.("temporarily unavailable", relayB)
        return Promise.resolve([])
      }

      return Promise.resolve([])
    })

    await loadCommunityBootstrap(makeSession([relayA, relayB]))
    await flushPromises()

    const status = get(activeCommunityPermissionStatus)
    expect(status).toMatchObject({
      loaded: true,
      complete: false,
      hasCachedEvents: true,
    })
    expect(
      getCommunityPermissionReadiness({
        status,
        communityAddress: community.address,
        expectedKeyPrefix: `${status.key.slice(0, status.key.lastIndexOf(":"))}:`,
      }),
    ).toBe("ready")
  })

  it("keeps refreshing slower relays after partial authority becomes usable", async () => {
    let resolveSecondaryList: (events: TrustedEvent[]) => void = () => {}
    const secondaryListLoad = new Promise<TrustedEvent[]>(resolve => {
      resolveSecondaryList = resolve
    })
    loadMock.mockImplementation(({relays, filters}: {relays: string[]; filters: Filter[]}) => {
      if (hasKind(filters, COMMUNITY_DEFINITION_KIND)) {
        return Promise.resolve([twoListDefinitionEvent])
      }
      if (hasKind(filters, FORM_TEMPLATE_KIND)) return Promise.resolve([])
      if (hasKind(filters, PROFILE_LIST_KIND)) {
        return relays[0] === relayB ? secondaryListLoad : Promise.resolve([profileListEvent])
      }

      return Promise.resolve([])
    })

    await loadCommunityBootstrap(makeSession([relayA, relayB]))

    expect(get(activeCommunityPermissionStatus)).toMatchObject({
      loading: true,
      loaded: true,
      complete: false,
      hasCachedEvents: true,
    })

    resolveSecondaryList([secondProfileListEvent])
    await flushPromises()

    expect(get(activeCommunityPermissionStatus)).toMatchObject({
      loading: false,
      loaded: true,
      complete: true,
      hasCachedEvents: true,
    })
  })

  it("keeps newer viewer and generation permission status when older loads finish later", async () => {
    let resolveGuestLoad: (events: TrustedEvent[]) => void = () => {}
    let resolveSignerLoad: (events: TrustedEvent[]) => void = () => {}
    let resolveNewestSignerLoad: (events: TrustedEvent[]) => void = () => {}
    let profileLoadCount = 0
    const guestLoad = new Promise<TrustedEvent[]>(resolve => {
      resolveGuestLoad = resolve
    })
    const signerLoad = new Promise<TrustedEvent[]>(resolve => {
      resolveSignerLoad = resolve
    })
    const newestSignerLoad = new Promise<TrustedEvent[]>(resolve => {
      resolveNewestSignerLoad = resolve
    })

    repository.publish(singleRelayDefinitionEvent)
    loadMock.mockImplementation(({filters}: {filters: Filter[]}) => {
      if (hasKind(filters, PROFILE_LIST_KIND)) {
        profileLoadCount += 1
        return [guestLoad, signerLoad, newestSignerLoad][profileLoadCount - 1]
      }
      if (hasKind(filters, COMMUNITY_DEFINITION_KIND)) {
        return Promise.resolve([singleRelayDefinitionEvent])
      }
      if (hasKind(filters, FORM_TEMPLATE_KIND)) return Promise.resolve([admissionFormEvent])

      return Promise.resolve([])
    })

    await loadCommunityBootstrap(communitySession)
    pubkey.set(memberPubkey)
    await loadCommunityBootstrap(communitySession)
    const olderSignerStatusKey = get(activeCommunityPermissionStatus).key
    await loadCommunityBootstrap(communitySession)

    const signerStatusKey = get(activeCommunityPermissionStatus).key
    expect(signerStatusKey.startsWith(`${memberPubkey}:`)).toBe(true)
    expect(signerStatusKey).not.toBe(olderSignerStatusKey)

    resolveNewestSignerLoad([profileListEvent])
    await flushPromises()
    expect(get(activeCommunityPermissionStatus)).toMatchObject({
      key: signerStatusKey,
      loaded: true,
      complete: true,
      hasCachedEvents: true,
    })

    resolveSignerLoad([])
    resolveGuestLoad([])
    await flushPromises()
    expect(get(activeCommunityPermissionStatus)).toMatchObject({
      key: signerStatusKey,
      loaded: true,
      complete: true,
      hasCachedEvents: true,
    })
  })

  it("refreshes incomplete permissions when a completed bootstrap is cached", async () => {
    const session = communitySession
    let profileLoadCount = 0

    clearCommunityBootstrapCache(communityPubkey)
    repository.publish(singleRelayDefinitionEvent)
    loadMock.mockImplementation(({filters, onClosed}: any) => {
      if (hasKind(filters, PROFILE_LIST_KIND)) {
        profileLoadCount += 1
        if (profileLoadCount === 1) {
          onClosed?.("restricted: denied", relayA)
          return Promise.resolve([])
        }

        return Promise.resolve([profileListEvent])
      }
      if (hasKind(filters, COMMUNITY_DEFINITION_KIND)) {
        return Promise.resolve([singleRelayDefinitionEvent])
      }
      if (hasKind(filters, FORM_TEMPLATE_KIND)) return Promise.resolve([admissionFormEvent])

      return Promise.resolve([])
    })

    await ensureCommunityBootstrap(session)
    await flushPromises()
    expect(get(activeCommunityPermissionStatus)).toMatchObject({
      loading: false,
      loaded: true,
      complete: false,
      hasCachedEvents: false,
    })

    await ensureCommunityBootstrap(session)
    await flushPromises()

    expect(profileLoadCount).toBe(2)
    expect(get(activeCommunityPermissionStatus)).toMatchObject({
      loaded: true,
      complete: true,
      hasCachedEvents: true,
    })
  })

  it("hydrates the live replacement instead of the completed bootstrap's old revision", async () => {
    const pointer = makeCommunityPointer({
      ownerPubkey: communityPubkey,
      communityId: getPublicKey(new Uint8Array(32).fill(29)),
      relayHints: [relayA],
    })!
    const session = makeExactCommunitySession(pointer)
    const initial = makeEvent({
      ...singleRelayDefinitionEvent,
      id: "completed-bootstrap-before-live-replacement",
      tags: singleRelayDefinitionEvent.tags.map(tag =>
        tag.map(value => value.replaceAll(communityId, pointer.communityId)),
      ),
    })
    const scopedProfileList = makeEvent({
      ...profileListEvent,
      id: "live-replacement-profile-list",
      tags: profileListEvent.tags.map(tag =>
        tag.map(value => value.replaceAll(communityId, pointer.communityId)),
      ),
    })
    const replacement = makeEvent({
      ...initial,
      id: "live-definition-after-completed-bootstrap",
      created_at: initial.created_at + 1,
    })
    setActiveExactCommunityPointer(pointer)
    repository.publish(initial)
    loadMock.mockImplementation(({filters}: {filters: Filter[]}) => {
      if (hasKind(filters, COMMUNITY_DEFINITION_KIND)) {
        return Promise.resolve([initial])
      }
      if (hasKind(filters, PROFILE_LIST_KIND)) return Promise.resolve([scopedProfileList])
      return Promise.resolve([])
    })
    try {
      await ensureCommunityBootstrap(session)
      await flushPromises()
      expect(get(activeCommunityPermissionStatus)).toMatchObject({complete: true})

      repository.publish(replacement)
      await ensureCommunityBootstrap(session, {updateStatus: false})
      await flushPromises()
      expect(get(activeCommunityPermissionStatus).key).toContain(`:${replacement.id}:`)
      expect(get(activeCommunityPermissionStatus)).toMatchObject({complete: true, loading: false})
      expect(get(activeCommunityAdmissionFormStatus).key).toContain(`:${replacement.id}:`)
    } finally {
      clearCommunityBootstrapCache(pointer.address)
      repository.removeEvent(initial.id)
      repository.removeEvent(replacement.id)
      repository.removeEvent(scopedProfileList.id)
    }
  })

  it("refreshes incomplete admission forms after authority completes", async () => {
    const session = communitySession
    let admissionFormLoadCount = 0

    clearCommunityBootstrapCache(communityPubkey)
    repository.publish(singleRelayDefinitionEvent)
    loadMock.mockImplementation(({filters, onClosed}: any) => {
      if (hasKind(filters, PROFILE_LIST_KIND)) return Promise.resolve([profileListEvent])
      if (hasKind(filters, COMMUNITY_DEFINITION_KIND)) {
        return Promise.resolve([singleRelayDefinitionEvent])
      }
      if (hasKind(filters, FORM_TEMPLATE_KIND)) {
        admissionFormLoadCount += 1
        if (admissionFormLoadCount === 1) {
          onClosed?.("restricted: denied", relayA)
          return Promise.resolve([])
        }

        return Promise.resolve([admissionFormEvent])
      }

      return Promise.resolve([])
    })

    await ensureCommunityBootstrap(session)
    await flushPromises()
    expect(get(activeCommunityPermissionStatus)).toMatchObject({complete: true})
    const authorityStatusKey = get(activeCommunityPermissionStatus).key
    expect(get(activeCommunityAdmissionFormStatus)).toMatchObject({
      loading: false,
      loaded: true,
      complete: false,
      hasCachedEvents: false,
    })

    await ensureCommunityBootstrap(session)
    await flushPromises()

    expect(admissionFormLoadCount).toBe(2)
    expect(get(activeCommunityPermissionStatus).key).toBe(authorityStatusKey)
    expect(get(activeCommunityAdmissionFormStatus)).toMatchObject({
      loading: false,
      loaded: true,
      complete: true,
      hasCachedEvents: true,
    })
  })

  it("retries one evidence stream without invalidating its active sibling", async () => {
    const session = communitySession
    let profileLoadCount = 0
    let admissionFormLoadCount = 0

    clearCommunityBootstrapCache(communityPubkey)
    repository.publish(singleRelayDefinitionEvent)
    loadMock.mockImplementation(({filters}: {filters: Filter[]}) => {
      if (hasKind(filters, PROFILE_LIST_KIND)) {
        profileLoadCount += 1
        return Promise.resolve([profileListEvent])
      }
      if (hasKind(filters, FORM_TEMPLATE_KIND)) {
        admissionFormLoadCount += 1
        return Promise.resolve([admissionFormEvent])
      }
      if (hasKind(filters, COMMUNITY_DEFINITION_KIND)) {
        return Promise.resolve([singleRelayDefinitionEvent])
      }

      return Promise.resolve([])
    })

    await ensureCommunityBootstrap(session)
    await flushPromises()
    const authorityKey = get(activeCommunityPermissionStatus).key
    profileLoadCount = 0
    admissionFormLoadCount = 0
    activeCommunityPermissionStatus.set({
      communityAddress: community.address,
      key: authorityKey,
      loading: true,
      loaded: false,
      complete: false,
      hasCachedEvents: false,
    })
    activeCommunityAdmissionFormStatus.set({
      communityAddress: community.address,
      key: authorityKey,
      loading: false,
      loaded: true,
      complete: false,
      hasCachedEvents: false,
    })

    await ensureCommunityBootstrap(session)
    await flushPromises()

    expect(profileLoadCount).toBe(0)
    expect(admissionFormLoadCount).toBe(1)
    expect(get(activeCommunityPermissionStatus)).toMatchObject({
      key: authorityKey,
      loading: true,
      loaded: false,
    })
    expect(get(activeCommunityAdmissionFormStatus)).toMatchObject({
      complete: true,
      hasCachedEvents: true,
    })
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

    const bootstrap = await loadCommunityBootstrap(communitySession)

    expect(bootstrap.definition?.event.id).toBe(singleRelayDefinitionEvent.id)
    expect(bootstrap.profileListEvents).toEqual([])
    expect(get(activeCommunityPermissionStatus)).toMatchObject({
      communityAddress: community.address,
      loading: true,
      loaded: false,
      hasCachedEvents: false,
    })

    resolveProfileListLoad([profileListEvent])
    await flushPromises()

    expect(get(activeCommunityPermissionStatus)).toMatchObject({
      communityAddress: community.address,
      loading: false,
      loaded: true,
      complete: true,
    })
  })

  it("does not reactivate a bootstrap after navigation changed communities", async () => {
    const otherCommunityPubkey = getPublicKey(new Uint8Array(32).fill(9))
    const otherCommunity = makeCommunityPointer({
      ownerPubkey: otherCommunityPubkey,
      communityId: getPublicKey(new Uint8Array(32).fill(10)),
    })!
    repository.publish(singleRelayDefinitionEvent)
    loadMock.mockResolvedValue([])

    setActiveExactCommunityPointer(community)
    const staleBootstrap = loadCommunityBootstrap(communitySession)
    setActiveExactCommunityPointer(otherCommunity)
    activeCommunityPermissionStatus.set({
      communityAddress: otherCommunity.address,
      key: "other-permission-generation",
      loading: false,
      loaded: true,
      complete: true,
      hasCachedEvents: true,
    })

    await staleBootstrap
    const activeCommunity = get(activeExactCommunitySession)?.definition.ownerPubkey
    const activePermission = get(activeCommunityPermissionStatus)

    expect(activeCommunity).toBe(otherCommunityPubkey)
    expect(activePermission).toMatchObject({
      communityAddress: otherCommunity.address,
      key: "other-permission-generation",
    })
  })

  it("does not reactivate a bootstrap after active community state is cleared", async () => {
    repository.publish(singleRelayDefinitionEvent)
    loadMock.mockResolvedValue([])
    setActiveExactCommunityPointer(community)

    const staleBootstrap = loadCommunityBootstrap(communitySession)
    clearActiveCommunityState()
    await staleBootstrap

    expect(get(activeExactCommunitySession)).toBeUndefined()
    expect(get(activeCommunityPermissionStatus).communityAddress).toBe("")
  })

  it("waits for community relay auth before loading bootstrap content", async () => {
    let releaseSignature: (event: ReturnType<typeof makeAuthEvent>) => void = () => {}
    const socket = getRelaySocket(requiredRelay)
    signMock.mockImplementation(
      () =>
        new Promise(resolve => {
          releaseSignature = resolve
        }),
    )

    pubkey.set(memberPubkey)
    sendAuthChallenge(socket)
    repository.publish(requiredRelayDefinitionEvent)
    loadMock.mockImplementation(({filters}: {relays: string[]; filters: Filter[]}) => {
      if (hasKind(filters, COMMUNITY_DEFINITION_KIND)) {
        return Promise.resolve([requiredRelayDefinitionEvent])
      }
      if (hasKind(filters, PROFILE_LIST_KIND)) return Promise.resolve([profileListEvent])

      return Promise.resolve([])
    })

    let settled = false
    const bootstrapPromise = loadCommunityBootstrap(makeSession([requiredRelay])).then(
      bootstrap => {
        settled = true

        return bootstrap
      },
    )

    await flushPromises()

    expect(settled).toBe(false)
    expect(socket.auth.status).toBe(AuthStatus.PendingSignature)
    expect(loadMock.mock.calls.some(([args]) => hasKind(args.filters, PROFILE_LIST_KIND))).toBe(
      false,
    )

    releaseSignature(makeAuthEvent())
    await flushPromises()
    acceptAuth(socket)
    const bootstrap = await bootstrapPromise
    await flushPromises()

    expect(bootstrap.definition?.event.id).toBe(requiredRelayDefinitionEvent.id)
    expect(loadMock.mock.calls.some(([args]) => hasKind(args.filters, PROFILE_LIST_KIND))).toBe(
      true,
    )
  })

  it("fails bootstrap when no community definition loads", async () => {
    loadMock.mockResolvedValue([])

    await expect(loadCommunityBootstrap(communitySession)).rejects.toThrow(
      "Community definition unavailable",
    )
  })

  it("discovers moderator communities from indexed definitions before loading profile lists", async () => {
    pubkey.set(moderatorPubkey)
    loadMock.mockImplementation(({relays, filters}: {relays: string[]; filters: Filter[]}) => {
      if (relays[0] === discoveryRelay && hasBroadCommunityDefinitionFilter(filters)) {
        return Promise.resolve([moderatorPreferenceDefinitionEvent])
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

  it("discovers member communities from profile lists on their scoped relays", async () => {
    pubkey.set(memberPubkey)
    loadMock.mockImplementation(({relays, filters}: {relays: string[]; filters: Filter[]}) => {
      if (relays[0] === discoveryRelay && hasBroadCommunityDefinitionFilter(filters)) {
        return Promise.resolve([preferenceDefinitionEvent])
      }

      if (
        relays[0] === relayA &&
        hasProfileListFilter(filters, listPubkey, generalListIdentifier)
      ) {
        return Promise.resolve([profileListEvent])
      }

      return Promise.resolve([])
    })

    await hydrateCommunityPreferences({relayHints: [discoveryRelay], force: true})
    await Promise.resolve()

    expect(get(activePreferredCommunities)).toContainEqual(
      expect.objectContaining({
        communityPubkey,
        isMember: true,
      }),
    )

    const memberDiscoveryRelays = loadMock.mock.calls.flatMap(call => {
      const {relays, filters} = call[0] as {relays: string[]; filters: Filter[]}

      return hasMemberProfileListFilter(filters, listPubkey, generalListIdentifier, memberPubkey)
        ? relays
        : []
    })

    expect(memberDiscoveryRelays).toEqual([relayA])
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
        return Promise.resolve([preferenceDefinitionEvent])
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

  it("hydrates permissions for a newer background definition", async () => {
    const newerDefinition = makeEvent({
      ...singleRelayDefinitionEvent,
      id: "definition-newer",
      created_at: singleRelayDefinitionEvent.created_at + 1,
    })
    const newerProfileList = makeEvent({...profileListEvent, id: "general-list-newer"})
    repository.publish(singleRelayDefinitionEvent)
    setActiveExactCommunityPointer(community)
    loadMock.mockImplementation(({filters}: {filters: Filter[]}) => {
      if (hasKind(filters, COMMUNITY_DEFINITION_KIND)) return Promise.resolve([newerDefinition])
      if (hasKind(filters, PROFILE_LIST_KIND)) return Promise.resolve([newerProfileList])

      return Promise.resolve([])
    })

    await loadCommunityBootstrap(communitySession)
    await flushPromises(30)
    const refreshedDefinitionIds = repository
      .query([{ids: [newerDefinition.id]}])
      .map(event => event.id)
    const permissionStatus = get(activeCommunityPermissionStatus)
    repository.removeEvent(newerDefinition.id)
    repository.removeEvent(newerProfileList.id)

    expect(refreshedDefinitionIds).toEqual([newerDefinition.id])
    expect(permissionStatus.key).toContain(`:${newerDefinition.id}:`)
    expect(permissionStatus).toMatchObject({loaded: true})
  })
})
