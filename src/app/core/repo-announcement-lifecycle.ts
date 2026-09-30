import {readable} from "svelte/store"
import {getAddress, sanitizeRelayUrls, type TrustedEvent} from "@welshman/util"
import type {Repository} from "@welshman/net"
import {GIT_REPO_ANNOUNCEMENT, type RepoAnnouncementEvent} from "@nostr-git/core/events"
import type {LoadedRepoSearchItem} from "@app/util/repo-discovery-search"

export const isDeletedRepoAnnouncement = (
  repository: Pick<Repository, "isDeleted">,
  event?: RepoAnnouncementEvent | null,
) => Boolean(event && (event.tags.some(tag => tag[0] === "deleted") || repository.isDeleted(event)))

/** Retain discovery membership, while resolving its displayed revision against
 * the repository. Subscribe only while the foreground search uses this pool. */
export const deriveRetainedRepoSearchItems = (
  repository: Repository,
  items: LoadedRepoSearchItem[],
) =>
  readable<LoadedRepoSearchItem[]>([], set => {
    if (!items.length) {
      set([])
      return
    }
    const addresses = new Set(items.map(item => item.address))
    let ids = new Set<string>()
    let visible: LoadedRepoSearchItem[] = []
    let queued = false
    let active = true
    const reconcile = () => {
      const previous = new Map(visible.map(item => [item.address, item]))
      const next: LoadedRepoSearchItem[] = []
      ids = new Set(items.map(item => item.event.id))
      for (const item of items) {
        const current = repository.getEvent(item.address) as RepoAnnouncementEvent | undefined
        const event = current && current.created_at >= item.event.created_at ? current : item.event
        ids.add(event.id)
        if (isDeletedRepoAnnouncement(repository, event)) continue
        const previousItem = previous.get(item.address)
        next.push(
          previousItem?.event.id === event.id
            ? previousItem
            : event === item.event
              ? item
              : {...item, event},
        )
      }
      if (next.length !== visible.length || next.some((item, index) => item !== visible[index])) {
        visible = next
        set(visible)
      }
    }
    const schedule = () => {
      if (queued) return
      queued = true
      queueMicrotask(() => {
        queued = false
        if (active) reconcile()
      })
    }
    const unsubscribe = repository.onRoutedUpdate(
      {name: "git-search-repo-lifecycle"},
      {kinds: [GIT_REPO_ANNOUNCEMENT]},
      ({added, removed}) => {
        if (
          [...removed].some(id => ids.has(id)) ||
          added.some(
            event => event.kind === GIT_REPO_ANNOUNCEMENT && addresses.has(getAddress(event)),
          )
        )
          schedule()
      },
    )
    const unsubscribeDeletions = repository.onDeletionEvidence(target => {
      if (addresses.has(target)) schedule()
    })
    reconcile()
    return () => {
      active = false
      unsubscribe()
      unsubscribeDeletions()
    }
  })

/** Preserve source provenance without querying every target against every hint. */
export const makeRepoDeletionSourcePlans = (
  events: TrustedEvent[],
  items: LoadedRepoSearchItem[],
  getSeenRelays: (id: string) => Iterable<string>,
) => {
  const hints = new Map<string, string[]>()
  for (const item of items) {
    hints.set(item.address, [
      ...(hints.get(item.address) || []),
      item.relayHint,
      ...(item.sourceRelays || []),
    ])
  }
  const targets = new Map<string, Set<string>>()
  for (const event of events) {
    for (const relay of sanitizeRelayUrls([
      ...(hints.get(getAddress(event)) || []),
      ...getSeenRelays(event.id),
    ])) {
      const ids = targets.get(relay) || new Set<string>()
      ids.add(event.id)
      targets.set(relay, ids)
    }
  }
  return [...targets]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([relay, ids]) => ({
      relays: [relay],
      localFilters: [{ids: [...ids].sort()}],
    }))
}
