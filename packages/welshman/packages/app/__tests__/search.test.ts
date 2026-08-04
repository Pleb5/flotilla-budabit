import type {PublishedProfile} from "@welshman/util"
import {get, type Writable} from "svelte/store"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {handlesByNip05, type Handle} from "../src/handles.js"
import {profiles} from "../src/profiles.js"
import {profileSearch} from "../src/search.js"

vi.mock("@welshman/net", () => ({load: vi.fn()}))
vi.mock("@welshman/router", () => ({
  Router: {get: () => ({Search: () => ({getUrls: () => []})})},
}))
vi.mock("@welshman/store", () => ({
  throttled: (_delay: number, store: unknown) => store,
}))
vi.mock("../src/handles.js", async () => {
  const {writable} = await import("svelte/store")

  return {handlesByNip05: writable(new Map())}
})
vi.mock("../src/profiles.js", async () => {
  const {writable} = await import("svelte/store")

  return {profiles: writable([])}
})
vi.mock("../src/relays.js", async () => {
  const {writable} = await import("svelte/store")

  return {relays: writable([])}
})
vi.mock("../src/topics.js", async () => {
  const {writable} = await import("svelte/store")

  return {topics: writable([])}
})
vi.mock("../src/wot.js", () => ({
  getWotGraph: () => new Map([["fuzzy", 100]]),
  getMaxWot: () => 100,
}))

const profileStore = profiles as Writable<PublishedProfile[]>
const handleStore = handlesByNip05 as Writable<Map<string, Handle>>
const makeProfile = (pubkey: string, profile: Partial<PublishedProfile>) =>
  ({...profile, event: {pubkey}}) as PublishedProfile

describe("profileSearch", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    profileStore.set([])
    handleStore.set(new Map())
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it("sorts matches by Fuse textual relevance instead of insertion order or WOT", () => {
    profileStore.set([
      makeProfile("fuzzy", {name: "alexander"}),
      makeProfile("exact", {name: "alex"}),
    ])

    const matches = get(profileSearch).searchOptions("alex")

    expect(matches.map(profile => profile.event.pubkey)).toEqual(["exact", "fuzzy"])
  })

  it("does not search an unvalidated NIP-05 identifier", () => {
    profileStore.set([makeProfile("invalid", {name: "Unrelated", nip05: "alice@example.com"})])

    expect(get(profileSearch).searchOptions("alice@example.com")).toEqual([])
  })
})
