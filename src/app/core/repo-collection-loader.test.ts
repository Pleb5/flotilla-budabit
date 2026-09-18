// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {get} from "svelte/store"
import {getPublicKey} from "nostr-tools/pure"
import {makeEvent, matchFilters, type Filter, type TrustedEvent} from "@welshman/util"
import type {RepoAnnouncementEvent} from "@nostr-git/core/events"
import {makeCommunityPointer, TARGETED_PUBLICATION_KIND} from "./community"
import {makeTargetedPublicationForCommunity} from "./community-targeting"
import {getRepoCollectionStatus} from "./repo-collection-read-model"
import {createRepoCollectionLoader, type RepoCollectionScope} from "./repo-collection-loader"
import type {BoundedCommunityHistoryOptions, BoundedCommunityHistoryResult} from "./requests"
import {makeRepoStarReaction} from "@app/util/repo-stars"

vi.mock("@app/core/storage", () => ({kv: {get: vi.fn(), set: vi.fn()}, db: {}}))

const viewer = getPublicKey(new Uint8Array(32).fill(21))
const other = getPublicKey(new Uint8Array(32).fill(22))
const repoRelay = "wss://repos.example/"
const communityRelay = "wss://community.example/"
const sourceRelay = "wss://original.example/"
const community = makeCommunityPointer({ownerPubkey: other, communityId: viewer})!
const option = {...community, relays: [communityRelay]}
const repo = {
  ...makeEvent(30617, {
    tags: [
      ["d", "demo"],
      ["relays", repoRelay],
    ],
  }),
  id: "a".repeat(64),
  pubkey: other,
  sig: "f".repeat(128),
} as RepoAnnouncementEvent
const address = `30617:${other}:demo`
const star = {
  ...makeRepoStarReaction({event: repo}),
  pubkey: viewer,
  id: "b".repeat(64),
  sig: "f".repeat(128),
} as TrustedEvent
const sharedStar = {...star, pubkey: other}
const target = {
  ...makeEvent(TARGETED_PUBLICATION_KIND, {
    ...makeTargetedPublicationForCommunity({
      targetingId: "collection",
      originalKind: 7,
      community,
      originalRef: {type: "e", value: sharedStar.id, relay: sourceRelay},
    }),
  }),
  pubkey: viewer,
  id: "c".repeat(64),
  sig: "f".repeat(128),
} as TrustedEvent
const success = (events: TrustedEvent[] = []): BoundedCommunityHistoryResult => ({
  events,
  complete: true,
  saturated: false,
  timedOut: false,
})

const setup = ({
  seeds = new Map<string, TrustedEvent[]>(),
  outcome,
}: {
  seeds?: Map<string, TrustedEvent[]>
  outcome?: (options: BoundedCommunityHistoryOptions) => BoundedCommunityHistoryResult | undefined
} = {}) => {
  const cached = new Map<string, TrustedEvent>()
  let watcher: {filters: Filter[]; onChange: () => void} | undefined
  const add = (events: TrustedEvent[]) => {
    for (const event of events) cached.set(event.id, event)
    if (watcher && events.some(event => matchFilters(watcher!.filters, event))) watcher.onChange()
  }
  const load = vi.fn(async (options: BoundedCommunityHistoryOptions) => {
    const result = outcome?.(options)
    if (result) return result
    const events = (seeds.get(options.relays[0]) || []).filter(event =>
      matchFilters(options.localFilters, event),
    )
    add(events)
    return success(events)
  })
  const reader = createRepoCollectionLoader({
    load,
    query: filters => [...cached.values()].filter(event => matchFilters(filters, event)),
    watch: (filters, onChange) => {
      watcher = {filters, onChange}
      onChange()
      return () => {
        watcher = undefined
      }
    },
  })
  const scope: RepoCollectionScope = {
    viewerPubkey: viewer,
    personalRelays: [repoRelay],
    communityOptions: [option],
    authorizeTargets: events => events,
  }
  reader.configure(scope)
  reader.ensureRepositories([{address, relays: [repoRelay]}])
  return {reader, scope, load, add}
}

describe("layout-owned repository collections", () => {
  const readers: Array<ReturnType<typeof createRepoCollectionLoader>> = []
  const trackedSetup = (options?: Parameters<typeof setup>[0]) => {
    const context = setup(options)
    readers.push(context.reader)
    return context
  }
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    readers.splice(0).forEach(reader => reader.dispose())
    vi.useRealTimers()
  })

  it("resolves empty reads and reuses them for more cards, reordered lists and returning pages", async () => {
    const {reader, scope, load} = trackedSetup()
    reader.ensureRepositories(
      Array.from({length: 80}, (_, i) => ({address: `${address}-${i}`, relays: [repoRelay]})),
    )
    expect(get(reader).communityHistoryComplete).toBe(false)
    await vi.advanceTimersByTimeAsync(500)
    expect(load).toHaveBeenCalledTimes(2)
    expect(get(reader).communityHistoryComplete).toBe(true)
    expect(get(reader).personalHistoryCompleteByAddress.size).toBe(81)
    expect(getRepoCollectionStatus(false, get(reader).communityHistoryComplete)).toBe("uncollected")

    const stopPage = reader.subscribe(() => {})
    stopPage()
    reader.configure({...scope, communityOptions: [{...option, label: "New name"}]})
    reader.ensureRepositories([
      {address: `${address}-next`, relays: [repoRelay]},
      {address, relays: [repoRelay]},
    ])
    await vi.advanceTimersByTimeAsync(500)
    expect(load).toHaveBeenCalledTimes(2)
    expect(get(reader).personalHistoryCompleteByAddress.has(`${address}-next`)).toBe(true)
    const targets = load.mock.calls.find(([options]) =>
      options.owner?.endsWith("community-targets"),
    )![0]
    expect(targets.relays).toEqual([communityRelay])
    expect(targets.relayFilters[0].authors).toEqual([viewer])
  })

  it("follows another author's exact original on its source relay without unrelated relay vetoes", async () => {
    const failingDiscoveryRelay = "wss://unrelated.example/"
    const outsiderTargets = Array.from({length: 120}, (_, i) => ({
      ...target,
      pubkey: other,
      id: String(i).padStart(64, "0"),
    }))
    const {reader, scope, load} = trackedSetup({
      seeds: new Map([
        [communityRelay, [target, ...outsiderTargets]],
        [sourceRelay, [sharedStar]],
      ]),
      outcome: options =>
        options.relays[0] === failingDiscoveryRelay
          ? {...success(), complete: false, timedOut: true}
          : undefined,
    })
    reader.configure({...scope, personalRelays: [repoRelay, failingDiscoveryRelay]})
    await vi.advanceTimersByTimeAsync(1000)
    expect(get(reader).communityStars).toHaveLength(1)
    expect(get(reader).communityStars[0].star.reaction.pubkey).toBe(other)
    expect(get(reader).communityHistoryComplete).toBe(true)
    expect(get(reader).personalHistoryCompleteByAddress.has(address)).toBe(true)
    expect(
      load.mock.calls.filter(([options]) => options.owner?.endsWith("community-targets")),
    ).toHaveLength(1)
    expect(
      load.mock.calls.some(
        ([options]) =>
          options.relays[0] === sourceRelay && options.relayFilters[0].ids?.includes(sharedStar.id),
      ),
    ).toBe(true)
  })

  it("retries only the failed community scope and retains successful reads", async () => {
    let failed = true
    const {reader, load} = trackedSetup({
      outcome: options =>
        failed && options.relays[0] === communityRelay
          ? {...success(), complete: false, timedOut: true}
          : undefined,
    })
    await vi.advanceTimersByTimeAsync(500)
    expect(get(reader).communityHistoryComplete).toBe(false)
    expect(get(reader).personalHistoryCompleteByAddress.has(address)).toBe(true)
    failed = false
    await vi.advanceTimersByTimeAsync(5500)
    expect(get(reader).communityHistoryComplete).toBe(true)
    expect(load.mock.calls.filter(([options]) => options.relays[0] === repoRelay)).toHaveLength(1)
    expect(
      load.mock.calls.filter(([options]) => options.relays[0] === communityRelay),
    ).toHaveLength(2)
  })

  it("keeps missing originals unknown until the referenced event actually arrives", async () => {
    const {reader, add} = trackedSetup({seeds: new Map([[communityRelay, [target]]])})
    await vi.advanceTimersByTimeAsync(500)
    expect(get(reader).communityHistoryComplete).toBe(false)
    add([sharedStar])
    await vi.advanceTimersByTimeAsync(500)
    expect(get(reader).communityHistoryComplete).toBe(true)
    expect(get(reader).communityStars).toHaveLength(1)
  })

  it("does not treat an unhydrated community list as an authoritative empty list", async () => {
    const {reader, scope, load} = trackedSetup()
    reader.configure({...scope, communityOptions: [], communitiesReady: false})
    await vi.advanceTimersByTimeAsync(500)
    expect(get(reader).communityHistoryComplete).toBe(false)
    reader.configure({...scope, communityOptions: [], communitiesReady: true})
    await vi.advanceTimersByTimeAsync(500)
    expect(get(reader).communityHistoryComplete).toBe(true)
    expect(load).toHaveBeenCalledOnce()
  })

  it("loads only new deletion IDs when additional star history arrives", async () => {
    const {reader, load, add} = trackedSetup({seeds: new Map([[repoRelay, [star]]])})
    await vi.advanceTimersByTimeAsync(500)
    expect(get(reader).personalHistoryComplete).toBe(true)
    const nextStar = {...star, id: "e".repeat(64), tags: [...star.tags, ["alt", "another star"]]}
    add([nextStar])
    await vi.advanceTimersByTimeAsync(500)
    const deletes = load.mock.calls.filter(([options]) =>
      options.owner?.endsWith("personal-deletes"),
    )
    expect(deletes).toHaveLength(2)
    expect(deletes[0][0].relayFilters[0]["#e"]).toEqual([star.id])
    expect(deletes[1][0].relayFilters[0]["#e"]).toEqual([nextStar.id])
    expect(get(reader).personalHistoryComplete).toBe(true)
  })

  it("preserves known stars during incomplete history, then applies same-author deletes", async () => {
    const {reader, add} = trackedSetup({
      seeds: new Map([[repoRelay, [star]]]),
      outcome: options =>
        options.relays[0] === communityRelay ? {...success(), complete: false} : undefined,
    })
    await vi.advanceTimersByTimeAsync(500)
    expect(get(reader).personalStars).toHaveLength(1)
    expect(getRepoCollectionStatus(true, get(reader).communityHistoryComplete)).toBe("collected")
    add([
      {
        ...makeEvent(5, {tags: [["e", star.id]], created_at: star.created_at + 1}),
        pubkey: viewer,
        id: "d".repeat(64),
        sig: "f".repeat(128),
      } as TrustedEvent,
    ])
    await vi.advanceTimersByTimeAsync(500)
    expect(get(reader).personalStars).toHaveLength(0)
  })

  it("batches visible fallback after saturation without repeating the account-wide read", async () => {
    const {reader, load} = trackedSetup({
      outcome: options =>
        options.owner?.endsWith("personal-stars")
          ? {...success(), complete: false, saturated: true}
          : undefined,
    })
    reader.ensureRepositories(
      Array.from({length: 30}, (_, i) => ({address: `${address}-${i}`, relays: [repoRelay]})),
    )
    await vi.advanceTimersByTimeAsync(1000)
    expect(get(reader).personalHistoryComplete).toBe(false)
    expect(get(reader).personalHistoryCompleteByAddress.size).toBe(31)
    expect(
      load.mock.calls.filter(([options]) => options.owner?.endsWith("personal-stars")),
    ).toHaveLength(1)
    const batches = load.mock.calls.filter(([options]) =>
      options.owner?.endsWith("personal-scoped"),
    )
    expect(batches).toHaveLength(1)
    expect(batches[0][0].relayFilters[0]["#a"]).toHaveLength(31)
    reader.ensureRepositories([{address: `${address}-new`, relays: [repoRelay]}])
    await vi.advanceTimersByTimeAsync(500)
    const nextBatch = load.mock.calls
      .filter(([options]) => options.owner?.endsWith("personal-scoped"))
      .at(-1)![0]
    expect(nextBatch.relayFilters[0]["#a"]).toEqual([`${address}-new`])
    await vi.advanceTimersByTimeAsync(60_000)
    expect(
      load.mock.calls.filter(([options]) => options.owner?.endsWith("personal-stars")),
    ).toHaveLength(1)
  })

  it("aborts old identity work and ignores its completion after account switch or disposal", async () => {
    const {reader, scope, load} = trackedSetup()
    let finish: ((result: BoundedCommunityHistoryResult) => void) | undefined
    load.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve
        }),
    )
    await vi.advanceTimersByTimeAsync(100)
    const oldSignal = load.mock.calls[0][0].signal!
    reader.configure({...scope, viewerPubkey: other})
    expect(oldSignal.aborted).toBe(true)
    finish?.(success([star]))
    await vi.advanceTimersByTimeAsync(500)
    expect(get(reader).viewerPubkey).toBe(other)
    expect(get(reader).personalStars).toEqual([])
    const calls = load.mock.calls.length
    reader.dispose()
    reader.ensureRepositories([{address: "another", relays: [sourceRelay]}])
    await vi.advanceTimersByTimeAsync(60_000)
    expect(load).toHaveBeenCalledTimes(calls)
    expect(load.mock.calls.at(-1)![0].signal!.aborted).toBe(true)
  })

  it("refilters permission changes while retaining completed history for unchanged communities", async () => {
    const {reader, scope, load} = trackedSetup({
      seeds: new Map([
        [communityRelay, [target]],
        [sourceRelay, [sharedStar]],
      ]),
    })
    await vi.advanceTimersByTimeAsync(1000)
    expect(get(reader).communityStars).toHaveLength(1)
    const before = load.mock.calls.length
    reader.configure({...scope, authorizeTargets: () => []})
    await vi.advanceTimersByTimeAsync(500)
    expect(get(reader).communityStars).toHaveLength(0)
    reader.configure(scope)
    await vi.advanceTimersByTimeAsync(500)
    expect(get(reader).communityStars).toHaveLength(1)
    expect(load).toHaveBeenCalledTimes(before)
  })
})
