import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {get, writable, type Writable} from "svelte/store"
import {Pool, AuthStatus, type RequestOptions} from "@welshman/net"
import type {FiniteRelayRequestOptions} from "./finite-relay-request"

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  finite: vi.fn(),
  userRelay: vi.fn().mockResolvedValue(undefined),
  ownList: vi.fn().mockResolvedValue(undefined),
  partnerList: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@welshman/net", async original => ({
  ...(await original<typeof import("@welshman/net")>()),
  request: mocks.request,
}))
vi.mock("@welshman/app", async () => {
  const {writable} = await import("svelte/store")
  return {
    pubkey: writable(undefined),
    signer: writable(undefined),
    userMessagingRelayList: writable(undefined),
    messagingRelayListsByPubkey: writable(new Map()),
    forceLoadUserMessagingRelayList: mocks.ownList,
    loadMessagingRelayList: mocks.partnerList,
    loadUserRelayList: mocks.userRelay,
  }
})
vi.mock("$app/stores", async () => {
  const {writable} = await import("svelte/store")
  return {page: writable({url: {pathname: "/home"}})}
})
vi.mock("./finite-relay-request", () => ({requestFiniteRelay: mocks.finite}))
vi.mock("./dm", () => ({
  getDmRelayUrls: (list: any) => (list?.publicTags || []).map((tag: string[]) => tag[1]),
  getMessagingRelayHints: () => ["wss://hint.example/"],
}))
vi.mock("./relay-policy", () => ({
  getRelayPolicy: () => ({maxLimit: 100}),
  RELAY_AUTH_SIGN_TIMEOUT: 90_000,
  RELAY_AUTH_ACK_TIMEOUT: 10_000,
  RELAY_REQUEST_PRIORITY: {live: 200},
}))

import {
  pubkey,
  signer as signerStore,
  userMessagingRelayList as relayListStore,
  messagingRelayListsByPubkey as relayListsStore,
} from "@welshman/app"
import {page} from "$app/stores"
import {startDmSync, dmHistoryState, retryDmHistory} from "./dm-sync"

const self = "a".repeat(64),
  partner = "b".repeat(64)
const signer = signerStore as unknown as Writable<any>
const userMessagingRelayList = relayListStore as Writable<any>
const messagingRelayListsByPubkey = relayListsStore as Writable<Map<string, any>>
const relay = "wss://dm.example/"
let cleanup: (() => void) | undefined
const navigate = (pathname: string) =>
  (page as unknown as ReturnType<typeof writable>).set({url: {pathname}})

describe("DM synchronization lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    pubkey.set(undefined)
    signer.set(undefined)
    userMessagingRelayList.set(undefined)
    messagingRelayListsByPubkey.set(new Map())
    navigate("/home")
    mocks.request.mockImplementation(
      (options: RequestOptions) =>
        new Promise(resolve => {
          options.signal?.addEventListener("abort", () => resolve([]))
        }),
    )
    mocks.finite.mockImplementation(async (options: FiniteRelayRequestOptions) => ({
      relay: options.relay,
      events: [],
      outcome: "eose",
      queuedAt: Date.now(),
      finishedAt: Date.now(),
    }))
  })
  afterEach(() => {
    cleanup?.()
    cleanup = undefined
    Pool.get().clear()
    vi.useRealTimers()
  })

  const login = () => {
    pubkey.set(self)
    signer.set({} as any)
    userMessagingRelayList.set({event: {pubkey: self}, publicTags: [["relay", relay]]} as any)
  }

  it("waits for signer hydration and starts a single live tail on the inbox relay", async () => {
    pubkey.set(self)
    userMessagingRelayList.set({event: {pubkey: self}, publicTags: [["relay", relay]]} as any)
    cleanup = startDmSync()
    await vi.advanceTimersByTimeAsync(1000)
    expect(mocks.finite).not.toHaveBeenCalled()
    signer.set({} as any)
    await vi.advanceTimersByTimeAsync(1000)
    expect(mocks.request).toHaveBeenCalledTimes(1)
    expect(mocks.request.mock.calls[0][0]).toMatchObject({
      lifetime: "live",
      priority: 200,
      filters: [
        expect.objectContaining({limit: 0, "#p": [self]}),
        expect.objectContaining({limit: 0, authors: [self]}),
      ],
    })
    expect(mocks.finite).toHaveBeenCalledTimes(2)
  })

  it("starts foreground scoped reads on a direct conversation URL before partner metadata", async () => {
    login()
    navigate(`/chat/${partner}`)
    cleanup = startDmSync()
    await vi.advanceTimersByTimeAsync(500)
    expect(mocks.finite.mock.calls[0][0]).toMatchObject({
      priority: 350,
      filters: [expect.objectContaining({authors: [partner], "#p": [self]})],
    })
    expect(get(dmHistoryState).get(partner)?.exhausted).toBe(true)
    expect(mocks.partnerList).toHaveBeenCalledWith(partner, ["wss://hint.example/"])
  })

  it("coalesces navigation and metadata churn without duplicating live subscriptions", async () => {
    login()
    cleanup = startDmSync()
    await vi.advanceTimersByTimeAsync(500)
    navigate("/chat")
    for (let index = 0; index < 20; index++) {
      messagingRelayListsByPubkey.set(new Map())
      navigate(`/chat/${partner}`)
      navigate("/chat")
    }
    await vi.advanceTimersByTimeAsync(1000)
    expect(mocks.request).toHaveBeenCalledTimes(1)
    expect(mocks.ownList).toHaveBeenCalledTimes(1)
    expect(mocks.partnerList).toHaveBeenCalledTimes(1)
    expect(mocks.finite).toHaveBeenCalledTimes(2)
  })

  it("connects finite deadlines to the shared socket AUTH lifecycle and cleans up listeners", async () => {
    login()
    navigate("/chat")
    cleanup = startDmSync()
    await vi.advanceTimersByTimeAsync(30)
    const options = mocks.finite.mock.calls[0][0] as FiniteRelayRequestOptions
    expect(options.authTimeoutMs).toBe(100_000)
    const observed = vi.fn()
    const stop = options.subscribeAuth!(observed)
    const socket = Pool.get().get(relay)
    socket.auth.setStatus(AuthStatus.PendingSignature)
    expect(observed).toHaveBeenLastCalledWith(true)
    socket.auth.setStatus(AuthStatus.Ok)
    expect(observed).toHaveBeenLastCalledWith(false)
    stop()
    observed.mockClear()
    socket.auth.setStatus(AuthStatus.PendingSignature)
    expect(observed).not.toHaveBeenCalled()
  })

  it("aborts old account subscriptions and clears history state on logout", async () => {
    login()
    cleanup = startDmSync()
    await vi.advanceTimersByTimeAsync(500)
    const signal = mocks.request.mock.calls[0][0].signal as AbortSignal
    pubkey.set(undefined)
    expect(signal.aborted).toBe(true)
    expect(get(dmHistoryState).size).toBe(0)
    retryDmHistory()
  })
})
