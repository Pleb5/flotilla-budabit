import {describe, expect, it, vi} from "vitest"
import type {RequestOptions} from "@welshman/net"
import type {TrustedEvent} from "@welshman/util"
import {
  buildRepoExactThreadLiveFilters,
  buildRepoDeletionTargetLiveFilters,
  buildRepoStableLiveFilters,
  batchRepoLiveRelays,
  createRepoLiveRequester,
  selectRepoLiveRelays,
} from "./repo-live-session"

const relay = "wss://repo.example"
const address = `30617:${"a".repeat(64)}:repo`
const event: TrustedEvent = {
  id: "1".repeat(64),
  pubkey: "2".repeat(64),
  created_at: 120,
  kind: 1621,
  tags: [["a", address]],
  content: "issue",
  sig: "3".repeat(128),
}

const pendingRequest = (options: RequestOptions) =>
  new Promise<TrustedEvent[]>(resolve => {
    options.signal?.addEventListener("abort", () => resolve([]), {once: true})
  })

describe("repository live session", () => {
  it("batches every declared relay without truncating coverage", () => {
    const relays = Array.from({length: 14}, (_, index) => `wss://relay-${index}.example`)
    const batches = batchRepoLiveRelays(relays, 6)

    expect(batches.map(batch => batch.length)).toEqual([6, 6, 2])
    expect(batches.flat().sort()).toEqual([...relays].sort())
  })

  it("bounds continuous live relays while preserving declared preference order", () => {
    const relays = Array.from({length: 10}, (_, index) => `wss://relay-${index}.example`)
    expect(
      selectRepoLiveRelays([relays[0], "", "not-a-relay", relays[0], ...relays.slice(1)]),
    ).toHaveLength(6)
    expect(selectRepoLiveRelays([relays[0], "", relays[0], ...relays.slice(1)])[0]).toContain(
      "relay-0.example",
    )
  })

  it("builds stable coordinate, comment, metadata, and viewer filters", () => {
    const filters = buildRepoStableLiveFilters({
      addresses: [address],
      repoPubkey: "a".repeat(64),
      repoName: "repo",
      ownerPubkeys: ["a".repeat(64), "b".repeat(64)],
      viewer: "c".repeat(64),
      includeAnnouncement: true,
      includeActivity: true,
    })

    expect(filters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({kinds: [30617], "#d": ["repo"]}),
        expect.objectContaining({kinds: [30618], "#d": ["repo"]}),
        expect.objectContaining({"#a": [address]}),
        {kinds: [1111], "#q": [address]},
        {kinds: [5], "#repo": [address]},
        expect.objectContaining({"#p": ["c".repeat(64)]}),
      ]),
    )
    expect(filters.some(filter => "#e" in filter || "#E" in filter)).toBe(false)
  })

  it("subscribes to deletions for discovered child event IDs", () => {
    const ids = Array.from({length: 101}, (_, index) => String(index).padStart(64, "0"))
    const filters = buildRepoDeletionTargetLiveFilters([ids[0], ...ids])

    expect(filters).toHaveLength(2)
    expect(filters.flatMap(filter => filter["#e"] || [])).toEqual([...ids].sort())
    expect(filters.every(filter => filter.kinds?.includes(5))).toBe(true)
  })

  it("keeps exact legacy thread filters separate from stable filters", () => {
    const filters = buildRepoExactThreadLiveFilters(event.id)

    expect(filters).toEqual(
      expect.arrayContaining([
        {kinds: [1111], "#E": [event.id]},
        {kinds: [1111], "#e": [event.id]},
      ]),
    )
    expect(filters.some(filter => "ids" in filter)).toBe(false)
  })

  it("replays bounded repository-scoped filters until the first EOSE", () => {
    const calls: RequestOptions[] = []
    const request = vi.fn((options: RequestOptions) => {
      calls.push(options)
      return pendingRequest(options)
    })
    const start = createRepoLiveRequester({request})
    const routeController = new AbortController()
    const stop = start({
      relay,
      filters: [
        {kinds: [1621], "#a": [address]},
        {kinds: [1111], "#E": [event.id]},
        {kinds: [1621], "#p": [event.pubkey]},
      ],
      signal: routeController.signal,
      priority: 200,
      owner: "repo-foreground:stable",
      initialReplayLimit: 100,
      onEvent: vi.fn(),
    })

    try {
      expect(calls[0].filters).toEqual([
        {kinds: [1621], "#a": [address], limit: 100},
        {kinds: [1111], "#E": [event.id], limit: 100},
        {kinds: [1621], "#p": [event.pubkey], limit: 0},
      ])
      expect(calls[0].filters.every(filter => filter.since === undefined)).toBe(true)
    } finally {
      stop()
    }
  })

  it("keeps initial replay armed when an attempt closes before EOSE", async () => {
    vi.useFakeTimers()
    const calls: RequestOptions[] = []
    let firstResolve: ((events: TrustedEvent[]) => void) | undefined
    const request = vi.fn((options: RequestOptions) => {
      calls.push(options)
      if (calls.length === 1) {
        options.onClosed?.("rate-limited", relay)
        return new Promise<TrustedEvent[]>(resolve => {
          firstResolve = resolve
        })
      }
      return pendingRequest(options)
    })
    const start = createRepoLiveRequester({request, random: () => 0, onError: vi.fn()})
    const routeController = new AbortController()
    const stop = start({
      relay,
      filters: [{kinds: [1621], "#a": [address]}],
      signal: routeController.signal,
      priority: 200,
      owner: "repo-foreground:stable",
      initialReplayLimit: 100,
      onEvent: vi.fn(),
      retryBaseMs: 1000,
    })

    try {
      firstResolve?.([])
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(1000)

      expect(calls).toHaveLength(2)
      expect(calls[0].filters[0]).toMatchObject({limit: 100})
      expect(calls[1].filters[0]).toMatchObject({limit: 100})
      expect(calls[1].filters[0].since).toBeUndefined()
    } finally {
      stop()
      vi.useRealTimers()
    }
  })

  it("covers an old-timestamp event retained after finite history reaches EOSE", () => {
    const received = vi.fn()
    const retainedAfterHistory = {...event, created_at: 1}
    let finiteHistoryComplete = false
    const request = vi.fn((options: RequestOptions) => {
      if (finiteHistoryComplete && Number(options.filters[0]?.limit || 0) > 0) {
        options.onEvent?.(retainedAfterHistory, relay)
      }
      options.onEose?.(relay)
      return pendingRequest(options)
    })
    const start = createRepoLiveRequester({request, now: () => 100_000})
    const routeController = new AbortController()

    finiteHistoryComplete = true
    const stop = start({
      relay,
      filters: [{kinds: [1621], "#a": [address]}],
      signal: routeController.signal,
      priority: 200,
      owner: "repo-foreground:stable",
      initialReplayLimit: 100,
      onEvent: received,
    })

    try {
      expect(received).toHaveBeenCalledWith(retainedAfterHistory, relay)
      expect(request.mock.calls[0][0].filters[0]).toMatchObject({limit: 100})
      expect(request.mock.calls[0][0].filters[0].since).toBeUndefined()
    } finally {
      stop()
    }
  })

  it("retries an unexpectedly closed relay with overlap from the last event", async () => {
    vi.useFakeTimers()
    const calls: RequestOptions[] = []
    let firstResolve: ((events: TrustedEvent[]) => void) | undefined
    const request = vi.fn((options: RequestOptions) => {
      calls.push(options)
      if (calls.length === 1) {
        options.onEvent?.(event, relay)
        options.onEose?.(relay)
        options.onClosed?.("rate-limited", relay)
        return new Promise<TrustedEvent[]>(resolve => {
          firstResolve = resolve
        })
      }
      return pendingRequest(options)
    })
    const start = createRepoLiveRequester({
      request,
      now: () => 100_000,
      random: () => 0,
      onError: vi.fn(),
    })
    const routeController = new AbortController()
    const stop = start({
      relay,
      filters: [{kinds: [1621], "#a": [address]}],
      signal: routeController.signal,
      priority: 200,
      owner: "repo-foreground:stable",
      onEvent: vi.fn(),
      initialReplayLimit: 100,
      retryBaseMs: 1000,
    })

    try {
      firstResolve?.([])
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(1000)

      expect(calls).toHaveLength(2)
      expect(calls[0].filters[0]).toMatchObject({limit: 100})
      expect(calls[0].filters[0].since).toBeUndefined()
      expect(calls[1].filters[0].since).toBe(110)
    } finally {
      stop()
      vi.useRealTimers()
    }
  })

  it("does not retry after route abort", async () => {
    vi.useFakeTimers()
    const calls: RequestOptions[] = []
    const request = vi.fn((options: RequestOptions) => {
      calls.push(options)
      return pendingRequest(options)
    })
    const start = createRepoLiveRequester({request, random: () => 0})
    const routeController = new AbortController()
    const stop = start({
      relay,
      filters: [{kinds: [1621]}],
      signal: routeController.signal,
      priority: 200,
      owner: "repo-foreground:stable",
      onEvent: vi.fn(),
    })

    try {
      routeController.abort()
      await Promise.resolve()
      await vi.runAllTimersAsync()
      expect(calls).toHaveLength(1)
    } finally {
      stop()
      vi.useRealTimers()
    }
  })
})
