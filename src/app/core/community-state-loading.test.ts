import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {get} from "svelte/store"
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
import {COMMUNITY_DEFINITION_KIND, FORM_TEMPLATE_KIND, PROFILE_LIST_KIND} from "./community"

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

  return {
    ...actual,
    forceLoadRelay: forceLoadRelayMock,
    forceLoadRelayList: forceLoadRelayListMock,
    sign: signMock,
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
  activeCommunityDefinition,
  activeCommunityBootstrapStatus,
  activeCommunityPermissionStatus,
  activeCommunitySession,
  activePreferredCommunities,
  authenticateCommunityRelays,
  clearActiveCommunity,
  clearCommunityBootstrapCache,
  ensureCommunityBootstrap,
  hasCommunityHydrationCompleted,
  hydrateCommunityEventsWithStatus,
  hydrateCommunityPreferences,
  loadCommunityDefinitionWithOutboxFallback,
  loadCommunityBootstrap,
  loadCommunityEvents,
  loadCommunityEventsWithStatus,
  recoverCommunityRelayAuth,
  recoverCommunityBootstrap,
  RelayAuthenticationTimeoutError,
  waitForCommunityRelayAuth,
  setActiveCommunityInput,
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

const admissionFormEvent = makeEvent({
  id: "admission-form",
  kind: FORM_TEMPLATE_KIND,
  pubkey: listPubkey,
  tags: [["a", `${COMMUNITY_DEFINITION_KIND}:${communityPubkey}:`]],
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

const requiredRelayDefinitionEvent = makeEvent({
  id: "definition-required-relay",
  kind: COMMUNITY_DEFINITION_KIND,
  tags: [
    ["r", requiredRelay],
    ["content", "General"],
    ["k", "1111"],
    ["a", `${PROFILE_LIST_KIND}:${listPubkey}:General`, requiredRelay],
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

const hasMemberProfileListFilter = (
  filters: Filter[],
  author: string,
  identifier: string,
  member: string,
) =>
  filters.some(filter => {
    const dTags = (filter as Filter & {"#d"?: string[]})["#d"] || []
    const pTags = (filter as Filter & {"#p"?: string[]})["#p"] || []

    return (
      filter.kinds?.includes(PROFILE_LIST_KIND) &&
      filter.authors?.includes(author) &&
      dTags.includes(identifier) &&
      pTags.includes(member)
    )
  })

const flushPromises = async (count = 10) => {
  for (let i = 0; i < count; i += 1) await Promise.resolve()
}

const getRelaySocket = (relay: string) => Pool.get().get(relay) as Socket

const makeAuthEvent = (event: Record<string, unknown>) => ({
  ...event,
  id: "auth-event",
  pubkey: memberPubkey,
  sig: "auth-signature",
})

const sendAuthChallenge = (socket: Socket, challenge = "challenge") => {
  socket.emit(SocketEvent.Receive, [RelayMessageType.Auth, challenge], socket.url)
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
    singleRelayDefinitionEvent,
    requiredRelayDefinitionEvent,
    profileListEvent,
    admissionFormEvent,
    moderatorDefinitionEvent,
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
    signMock.mockImplementation(async event => ({
      ...event,
      id: "auth-event",
      pubkey: memberPubkey,
      sig: "auth-signature",
    }))
    removeTestEvents()
    clearActiveCommunity()
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

  it("waits through nonterminal auth transitions until the relay accepts", async () => {
    let releaseSignature: (event: Record<string, unknown>) => void = () => {}
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

    releaseSignature(makeAuthEvent({kind: 22242, created_at: 1, tags: [], content: ""}))
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

  it("derives relay auth errors without starting authentication", async () => {
    const socket = getRelaySocket(requiredRelay)
    const attemptAuth = vi.spyOn(socket.auth, "attemptAuth")
    const {deriveRelayAuthError} = await import("./state")
    let authError: string | undefined
    const unsubscribe = deriveRelayAuthError(requiredRelay).subscribe(error => {
      authError = error
    })

    socket.auth.details = "restricted: denied"
    socket.auth.setStatus(AuthStatus.Forbidden)
    await flushPromises()

    expect(authError).toBe("denied")
    expect(attemptAuth).not.toHaveBeenCalled()
    unsubscribe()
  })

  it("shares one in-flight authentication attempt per relay socket", async () => {
    let releaseSignature: (event: Record<string, unknown>) => void = () => {}
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

    releaseSignature(makeAuthEvent({kind: 22242, created_at: 1, tags: [], content: ""}))
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

    await expect(recoverCommunityRelayAuth(requiredRelay)).rejects.toThrow("Authentication failed")
    expect(retryAuth).not.toHaveBeenCalled()
    expect(signMock).not.toHaveBeenCalled()
  })

  it("does not overwrite bootstrap status when recovery is superseded", async () => {
    let releaseSignature: (event: Record<string, unknown>) => void = () => {}
    const otherCommunityPubkey = "f".repeat(64)
    const socket = getRelaySocket(requiredRelay)
    repository.publish(requiredRelayDefinitionEvent)
    setActiveCommunityInput(communityPubkey)
    pubkey.set(memberPubkey)
    signMock.mockImplementation(
      () =>
        new Promise(resolve => {
          releaseSignature = resolve
        }),
    )
    sendAuthChallenge(socket)

    const recovery = recoverCommunityBootstrap(
      {communityPubkey, communityRelayHints: [requiredRelay]},
      {recoverAuth: true, authTimeout: 1000},
    )
    await flushPromises()
    setActiveCommunityInput(otherCommunityPubkey)
    activeCommunityBootstrapStatus.set({
      key: `:${otherCommunityPubkey}:`,
      loading: true,
      loaded: false,
    })
    releaseSignature(makeAuthEvent({kind: 22242, created_at: 1, tags: [], content: ""}))
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
    expect(socket.auth.status).toBe(AuthStatus.PendingSignature)

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
      if (hasKind(filters, FORM_TEMPLATE_KIND)) return Promise.resolve([admissionFormEvent])

      return Promise.resolve([])
    })

    const bootstrap = await loadCommunityBootstrap({
      communityPubkey,
      communityRelayHints: [relayA, relayB],
    })

    expect(bootstrap.definition?.event.id).toBe(definitionEvent.id)
    expect(bootstrap.profileListEvents.map(event => event.id)).toEqual([profileListEvent.id])
    expect(get(activeCommunityDefinition)?.event.id).toBe(definitionEvent.id)
    expect(get(activeCommunityPermissionStatus)).toMatchObject({
      loaded: true,
      complete: false,
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

    await loadCommunityBootstrap({communityPubkey, communityRelayHints: [relayA]})
    pubkey.set(memberPubkey)
    await loadCommunityBootstrap({communityPubkey, communityRelayHints: [relayA]})
    const olderSignerStatusKey = get(activeCommunityPermissionStatus).key
    await loadCommunityBootstrap({communityPubkey, communityRelayHints: [relayA]})

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
    const session = {communityPubkey, communityRelayHints: [relayA]}
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
    expect(get(activeCommunityPermissionStatus)).toMatchObject({loaded: true, complete: false})

    await ensureCommunityBootstrap(session)
    await flushPromises()

    expect(profileLoadCount).toBe(2)
    expect(get(activeCommunityPermissionStatus)).toMatchObject({
      loaded: true,
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
      complete: true,
    })
  })

  it("does not reactivate a bootstrap after navigation changed communities", async () => {
    const otherCommunityPubkey = "f".repeat(64)
    const otherDefinition = makeEvent({
      id: "other-definition",
      kind: COMMUNITY_DEFINITION_KIND,
      pubkey: otherCommunityPubkey,
      tags: [["r", relayA]],
    })
    repository.publish(singleRelayDefinitionEvent)
    repository.publish(otherDefinition)
    loadMock.mockResolvedValue([])

    setActiveCommunityInput(communityPubkey)
    const staleBootstrap = loadCommunityBootstrap({
      communityPubkey,
      communityRelayHints: [relayA],
    })
    setActiveCommunityInput(otherCommunityPubkey)
    activeCommunityPermissionStatus.set({
      communityPubkey: otherCommunityPubkey,
      key: "other-permission-generation",
      loading: false,
      loaded: true,
      complete: true,
      hasCachedEvents: true,
    })

    await staleBootstrap
    const activeCommunity = get(activeCommunitySession)?.communityPubkey
    const activePermission = get(activeCommunityPermissionStatus)
    repository.removeEvent(otherDefinition.id)

    expect(activeCommunity).toBe(otherCommunityPubkey)
    expect(activePermission).toMatchObject({
      communityPubkey: otherCommunityPubkey,
      key: "other-permission-generation",
    })
  })

  it("does not reactivate a bootstrap after active community state is cleared", async () => {
    repository.publish(singleRelayDefinitionEvent)
    loadMock.mockResolvedValue([])
    setActiveCommunityInput(communityPubkey)

    const staleBootstrap = loadCommunityBootstrap({
      communityPubkey,
      communityRelayHints: [relayA],
    })
    clearActiveCommunity()
    await staleBootstrap

    expect(get(activeCommunitySession)).toBeUndefined()
    expect(get(activeCommunityPermissionStatus).communityPubkey).toBe("")
  })

  it("waits for community relay auth before loading bootstrap content", async () => {
    let releaseSignature: (event: Record<string, unknown>) => void = () => {}
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
    const bootstrapPromise = loadCommunityBootstrap({
      communityPubkey,
      communityRelayHints: [requiredRelay],
    }).then(bootstrap => {
      settled = true

      return bootstrap
    })

    await flushPromises()

    expect(settled).toBe(false)
    expect(socket.auth.status).toBe(AuthStatus.PendingSignature)
    expect(loadMock.mock.calls.some(([args]) => hasKind(args.filters, PROFILE_LIST_KIND))).toBe(
      false,
    )

    releaseSignature(makeAuthEvent({kind: 22242, created_at: 1, tags: [], content: ""}))
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

  it("discovers member communities from profile lists on their scoped relays", async () => {
    pubkey.set(memberPubkey)
    loadMock.mockImplementation(({relays, filters}: {relays: string[]; filters: Filter[]}) => {
      if (relays[0] === discoveryRelay && hasBroadCommunityDefinitionFilter(filters)) {
        return Promise.resolve([singleRelayDefinitionEvent])
      }

      if (relays[0] === relayA && hasProfileListFilter(filters, listPubkey, "General")) {
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

      return hasMemberProfileListFilter(filters, listPubkey, "General", memberPubkey) ? relays : []
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

  it("hydrates permissions for a newer background definition", async () => {
    const newerDefinition = makeEvent({
      ...singleRelayDefinitionEvent,
      id: "definition-newer",
      created_at: singleRelayDefinitionEvent.created_at + 1,
    })
    const newerProfileList = makeEvent({...profileListEvent, id: "general-list-newer"})
    repository.publish(singleRelayDefinitionEvent)
    setActiveCommunityInput(communityPubkey)
    loadMock.mockImplementation(({filters}: {filters: Filter[]}) => {
      if (hasKind(filters, COMMUNITY_DEFINITION_KIND)) return Promise.resolve([newerDefinition])
      if (hasKind(filters, PROFILE_LIST_KIND)) return Promise.resolve([newerProfileList])

      return Promise.resolve([])
    })

    await loadCommunityBootstrap({communityPubkey, communityRelayHints: [relayA]})
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
