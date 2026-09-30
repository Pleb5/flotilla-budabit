import {describe, expect, it, vi} from "vitest"
import {get} from "svelte/store"
import {Repository} from "@welshman/net"
import {getAddress, type TrustedEvent} from "@welshman/util"
import type {RepoAnnouncementEvent} from "@nostr-git/core/events"
import {matchBookmarkedRepoEvents} from "@app/util/bookmarks"
import type {LoadedRepoSearchItem} from "@app/util/repo-discovery-search"
import {
  deriveRetainedRepoSearchItems,
  isDeletedRepoAnnouncement,
  makeRepoDeletionSourcePlans,
} from "./repo-announcement-lifecycle"

const repo = (name: string, created_at = 10): RepoAnnouncementEvent => ({
  id: `${name}-${created_at}`,
  pubkey: "a".repeat(64),
  kind: 30617,
  created_at,
  tags: [
    ["d", name],
    ["name", name],
  ],
  content: "",
  sig: "",
})
const item = (event: RepoAnnouncementEvent): LoadedRepoSearchItem => ({
  address: getAddress(event),
  event,
  relayHint: "wss://hint.example/",
})
const deleted = (event: RepoAnnouncementEvent): TrustedEvent => ({
  ...event,
  id: `delete-${event.id}`,
  kind: 5,
  created_at: 11,
  tags: [["a", getAddress(event)]],
})

describe("retained repository card lifecycle", () => {
  it("removes a completed search result, preserves survivor identity, and accepts newer replacements", async () => {
    const repository = new Repository()
    const first = repo("first")
    const survivor = item(repo("survivor"))
    repository.publish(first)
    repository.publish(survivor.event)
    const search = deriveRetainedRepoSearchItems(repository, [item(first), survivor])
    const updates = vi.fn()
    const unsubscribe = search.subscribe(updates)
    expect(get(search)).toHaveLength(2)
    repository.publish(deleted(first))
    await Promise.resolve()
    expect(get(search)).toEqual([survivor])
    expect(get(search)[0]).toBe(survivor)
    const newer = repo("first", 12)
    repository.publish(newer)
    await Promise.resolve()
    expect(get(search).map(result => result.event)).toEqual([newer, survivor.event])
    expect(get(search)[1]).toBe(survivor)
    const count = updates.mock.calls.length
    repository.publish(repo("unrelated"))
    repository.publish({...deleted(first), id: "foreign", pubkey: "b".repeat(64)})
    await Promise.resolve()
    expect(updates).toHaveBeenCalledTimes(count)
    unsubscribe()
  })

  it.each(["live", "compact"])(
    "reacts to %s evidence even for a pool-only event and excludes stale late responses",
    async mode => {
      const repository = new Repository()
      const event = repo("pool-only")
      const search = deriveRetainedRepoSearchItems(repository, [item(event)])
      const unsubscribe = search.subscribe(() => {})
      expect(get(search)).toHaveLength(1)
      if (mode === "live") repository.publish(deleted(event))
      else
        repository.restoreDeletions([
          {target: getAddress(event), pubkey: event.pubkey, created_at: 11},
        ])
      await Promise.resolve()
      expect(get(search)).toEqual([])
      expect(get(deriveRetainedRepoSearchItems(repository, [item(event)]))).toEqual([])
      repository.publish(repo("pool-only", 12))
      await Promise.resolve()
      expect(get(search)[0].event.created_at).toBe(12)
      unsubscribe()
    },
  )

  it("coalesces a deletion burst and detaches when search leaves the foreground", async () => {
    const repository = new Repository()
    const items = Array.from({length: 100}, (_, index) => item(repo(`repo-${index}`)))
    const updates = vi.fn()
    const unsubscribe = deriveRetainedRepoSearchItems(repository, items).subscribe(updates)
    const lookups = vi.spyOn(repository, "getEvent")
    repository.restoreDeletions(
      items.map(({event, address}) => ({target: address, pubkey: event.pubkey, created_at: 11})),
    )
    lookups.mockClear()
    await Promise.resolve()
    expect(lookups).toHaveBeenCalledTimes(100)
    expect(updates).toHaveBeenCalledTimes(2)
    expect(updates.mock.calls[1][0]).toEqual([])
    unsubscribe()
    lookups.mockClear()
    repository.publish(repo("repo-0", 12))
    await Promise.resolve()
    expect(lookups).not.toHaveBeenCalled()
  })

  it("prevents Starred cache fallback from restoring a deleted card after a compact-only restart", () => {
    const event = repo("starred")
    const repository = new Repository()
    repository.restoreDeletions([{target: getAddress(event), pubkey: event.pubkey, created_at: 11}])
    repository.publish(event)
    const project = () =>
      matchBookmarkedRepoEvents({
        bookmarks: [
          {address: getAddress(event), author: event.pubkey, identifier: "starred", relayHint: ""},
        ],
        events: repository.query([{kinds: [30617]}]) as RepoAnnouncementEvent[],
        getCachedEvent: address => repository.getEvent(address) as RepoAnnouncementEvent,
        isDeleted: event => isDeletedRepoAnnouncement(repository, event),
      })
    expect(repository.getEvent(getAddress(event))).toBe(event)
    expect(project()).toEqual([])
    const newer = repo("starred", 12)
    repository.publish(newer)
    expect(project().map(result => result.event)).toEqual([newer])
  })

  it("keeps relay provenance scoped to displayed targets rather than multiplying every hint", () => {
    const first = item(repo("first"))
    const second = {...item(repo("second")), relayHint: "wss://community-star.example/"}
    const unseen = {...item(repo("unseen")), relayHint: "wss://unseen.example/"}
    first.sourceRelays = ["wss://discovery.example/"]
    const plans = makeRepoDeletionSourcePlans(
      [first.event, second.event],
      [first, second, unseen],
      id => (id === first.event.id ? ["wss://actual-source.example/"] : []),
    )
    expect(plans).toEqual([
      {relays: ["wss://actual-source.example/"], localFilters: [{ids: [first.event.id]}]},
      {relays: ["wss://community-star.example/"], localFilters: [{ids: [second.event.id]}]},
      {relays: ["wss://discovery.example/"], localFilters: [{ids: [first.event.id]}]},
      {relays: ["wss://hint.example/"], localFilters: [{ids: [first.event.id]}]},
    ])
  })
})
