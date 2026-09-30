import {fromPairs, batch, indexBy} from "@welshman/lib"
import {throttled} from "@welshman/store"
import {
  APP_DATA,
  BLOSSOM_SERVERS,
  EVENT_TIME,
  FOLLOWS,
  MESSAGE,
  MUTES,
  PROFILE,
  RELAYS,
  THREAD,
  ZAP_GOAL,
  verifiedSymbol,
  MESSAGING_RELAYS,
  BADGE_AWARD,
  BADGES,
  BADGE_DEFINITION,
  DELETE,
  REACTION,
  getTagValue,
  sanitizeRelayUrls,
} from "@welshman/util"
import type {Zapper, TrustedEvent, RelayProfile} from "@welshman/util"
import type {Handle, RelayStats} from "@welshman/app"
import type {RepositoryUpdate} from "@welshman/net"
import {DM_KIND} from "@app/core/state"
import {GIT_USER_GRASP_LIST} from "@nostr-git/core/events"
import {FORM_TEMPLATE_KIND, PROFILE_LIST_KIND} from "@app/core/community"
import {COMMUNITY_DEFINITION_KIND} from "@app/core/community-protocol"
import {COMMUNITY_REPORT_KIND} from "@app/core/community-reports"
import {PROFILE_BADGES_KIND} from "@app/core/community-badges"
import {EMAIL_DIGEST_STATUS_KIND, EMAIL_DIGEST_SUBSCRIPTION_KIND} from "@app/core/email-digest"
import {
  tracker,
  plaintext,
  repository,
  relaysByUrl,
  handlesByNip05,
  zappersByLnurl,
  onZapper,
  onHandle,
  onRelay,
  relayStatsByUrl,
  onRelayStats,
} from "@welshman/app"
import {isMobile} from "@lib/html"
import type {IDBTable} from "@lib/indexeddb"
import {measurePerformanceDiagnosticsWork} from "@app/core/performance-diagnostics"
import {
  isPersistedCommunityReportDeleteEvent,
  isPersistedCommunityDefinitionEvent,
  isPersistedMobileContentEvent,
  isPersistedGitDeleteEvent,
} from "@app/util/storage-events"

const kinds = {
  meta: [
    PROFILE,
    FOLLOWS,
    MUTES,
    RELAYS,
    BLOSSOM_SERVERS,
    MESSAGING_RELAYS,
    GIT_USER_GRASP_LIST,
    APP_DATA,
  ],
  digest: [EMAIL_DIGEST_SUBSCRIPTION_KIND, EMAIL_DIGEST_STATUS_KIND],
  content: [EVENT_TIME, THREAD, MESSAGE, ZAP_GOAL, DM_KIND],
  community: [
    PROFILE_LIST_KIND,
    BADGE_AWARD,
    BADGES,
    BADGE_DEFINITION,
    PROFILE_BADGES_KIND,
    FORM_TEMPLATE_KIND,
    COMMUNITY_REPORT_KIND,
  ],
}

const persistedRepositoryKinds = Array.from(
  new Set([
    ...kinds.meta,
    ...kinds.digest,
    ...kinds.content,
    ...kinds.community,
    COMMUNITY_DEFINITION_KIND,
    DELETE,
    REACTION,
  ]),
)

const isCommunityStarReaction = (event: TrustedEvent) =>
  event.kind === REACTION &&
  event.content === "+" &&
  getTagValue("k", event.tags) === String(COMMUNITY_DEFINITION_KIND)

const isCommunityStarDelete = (event: TrustedEvent) =>
  event.kind === DELETE && getTagValue("k", event.tags) === String(REACTION)

const rankEvent = (event: TrustedEvent) => {
  if (kinds.meta.includes(event.kind)) return 9
  if (
    kinds.community.includes(event.kind) ||
    isPersistedCommunityDefinitionEvent(event) ||
    isCommunityStarReaction(event)
  ) {
    return 9
  }
  if (isPersistedCommunityReportDeleteEvent(event)) return 9
  if (isCommunityStarDelete(event)) return 8
  if (kinds.digest.includes(event.kind)) return 8
  if (kinds.content.includes(event.kind) && (!isMobile || isPersistedMobileContentEvent(event))) {
    return 5
  }
  if (isPersistedGitDeleteEvent(event)) return 4
  return 0
}

export const mergePersistedEvents = (events: TrustedEvent[]) => {
  measurePerformanceDiagnosticsWork(
    {owner: "indexeddb", phase: "merge-events", detail: {events: events.length}},
    () => {
      const cachedEvents: TrustedEvent[] = []

      for (const event of events) {
        // Persisted events were verified before storage. Keep newer in-memory
        // replaceable events when IndexedDB finishes opening after network startup.
        event[verifiedSymbol] = true
        if (!repository.hasEvent(event)) cachedEvents.push(event)
      }

      // Preserve in-memory deletion evidence (including compact tombstones) and
      // avoid rebuilding the whole repository when IndexedDB opens late.
      if (cachedEvents.length > 0)
        repository.batch(() => cachedEvents.forEach(event => repository.publish(event)))
    },
  )
}

export const mergePersistedRelayProvenance = (items: TrackerItem[]) => {
  const relaysById = new Map(
    Array.from(tracker.relaysById, ([id, relays]) => [id, new Set(relays)] as const),
  )
  let changed = false
  const migratedIds = new Set<string>()

  for (const {id, relays} of items) {
    const merged = relaysById.get(id) || new Set<string>()
    const canonicalRelays = sanitizeRelayUrls(relays)
    if (
      canonicalRelays.length !== relays.length ||
      canonicalRelays.some((relay, index) => relay !== relays[index])
    ) {
      migratedIds.add(id)
    }

    for (const relay of canonicalRelays) {
      if (!merged.has(relay)) changed = true
      merged.add(relay)
    }
    if (merged.size > 0) relaysById.set(id, merged)
  }

  if (changed || migratedIds.size > 0) tracker.load(relaysById)

  return migratedIds
}

const pendingEventPersistence = new Map<string, Promise<boolean>>()
const resolveEventPersistence = new Map<string, (persisted: boolean) => void>()

const markEventPersistencePending = (id: string) => {
  if (pendingEventPersistence.has(id)) return

  pendingEventPersistence.set(
    id,
    new Promise<boolean>(resolve => {
      resolveEventPersistence.set(id, resolve)
    }),
  )
}

const markEventPersistenceSettled = (ids: Iterable<string>, persisted: boolean) => {
  for (const id of ids) {
    resolveEventPersistence.get(id)?.(persisted)
    resolveEventPersistence.delete(id)
    pendingEventPersistence.delete(id)
  }
}

export const eventsAdapter = {
  name: "events",
  keyPath: "id",
  init: async (table: IDBTable<TrustedEvent>) => {
    mergePersistedEvents(await table.getAll())

    const persistUpdates = batch(3000, async (updates: RepositoryUpdate[]) => {
      const add: TrustedEvent[] = []
      const remove = new Set<string>()

      for (const update of updates) {
        for (const event of update.added) {
          if (rankEvent(event) > 0) {
            add.push(event)
            remove.delete(event.id)
          }
        }

        for (const id of update.removed) {
          remove.add(id)
        }
      }

      let addPersisted = true
      try {
        if (add.length > 0) {
          await table.bulkPut(add)
        }

        if (remove.size > 0) {
          await table.bulkDelete(remove)
        }
      } catch (error) {
        addPersisted = false
        throw error
      } finally {
        markEventPersistenceSettled(
          add.map(event => event.id),
          addPersisted,
        )
      }
    })
    const unsubscribe = repository.onRoutedUpdate(
      {name: "event-persistence"},
      {kinds: persistedRepositoryKinds},
      update => {
        for (const event of update.added) {
          if (rankEvent(event) > 0) markEventPersistencePending(event.id)
        }
        persistUpdates(update)
      },
    )

    return () => {
      unsubscribe()
      markEventPersistenceSettled(pendingEventPersistence.keys(), false)
    }
  },
}

export type TrackerItem = {id: string; relays: string[]}

export const migratePersistedRelayRecords = <T extends {url: string}>(items: T[]) => {
  const records = new Map<string, {record: T; canonicalSource: boolean; hadLegacy: boolean}>()
  const staleKeys = new Set<string>()

  for (const item of items) {
    const canonicalUrl = sanitizeRelayUrls([item.url])[0]
    if (!canonicalUrl) {
      staleKeys.add(item.url)
      continue
    }

    const canonicalSource = item.url === canonicalUrl
    const existing = records.get(canonicalUrl)
    if (!existing || canonicalSource || !existing.canonicalSource) {
      records.set(canonicalUrl, {
        record: {...item, url: canonicalUrl},
        canonicalSource,
        hadLegacy: !canonicalSource || existing?.hadLegacy || false,
      })
    } else if (!canonicalSource) {
      existing.hadLegacy = true
    }
    if (!canonicalSource) staleKeys.add(item.url)
  }

  return {
    records: Array.from(records.values(), ({record}) => record),
    writeRecords: Array.from(records.values())
      .filter(({canonicalSource, hadLegacy}) => hadLegacy && !canonicalSource)
      .map(({record}) => record),
    staleKeys: Array.from(staleKeys),
  }
}

export const trackerAdapter = {
  name: "tracker",
  keyPath: "id",
  init: async (table: IDBTable<TrackerItem>) => {
    const persistedItems = await table.getAll()

    const _onAdd = async (ids: Iterable<string>) => {
      const items: TrackerItem[] = []

      for (const id of ids) {
        if ((await pendingEventPersistence.get(id)) === false) continue
        const event = repository.getEvent(id)

        if (!event || rankEvent(event) === 0) continue

        const relays = Array.from(tracker.getRelays(id))

        if (relays.length === 0) continue

        items.push({id, relays})
      }

      await table.bulkPut(items)
    }

    const _onRemove = async (ids: Iterable<string>) => {
      await table.bulkDelete(Array.from(ids))
    }

    const onAdd = batch(3000, _onAdd)

    const onRemove = batch(3000, async (ids: string[]) => {
      const uniqueIds = Array.from(new Set(ids))
      const populatedIds = uniqueIds.filter(id => tracker.getRelays(id).size > 0)
      const emptyIds = uniqueIds.filter(id => tracker.getRelays(id).size === 0)

      if (populatedIds.length > 0) await _onAdd(populatedIds)
      if (emptyIds.length > 0) await _onRemove(emptyIds)
    })

    const onLoad = () => _onAdd(tracker.relaysById.keys())

    const onClear = (ids: Iterable<string>) => _onRemove(ids)

    // Relay intake records provenance before publishing to the repository.
    // Persist again from repository evidence so a short batch cannot observe
    // provenance before its eligible event exists.
    const onRepositoryUpdate = batch(3000, (updates: RepositoryUpdate[]) =>
      _onAdd(updates.flatMap(update => Array.from(update.added, event => event.id))),
    )

    tracker.on("add", onAdd)
    tracker.on("remove", onRemove)
    tracker.on("load", onLoad)
    tracker.on("clear", onClear)
    const unsubscribeRepository = repository.onRoutedUpdate(
      {name: "relay-provenance-persistence"},
      {kinds: persistedRepositoryKinds},
      onRepositoryUpdate,
    )

    const migratedIds = mergePersistedRelayProvenance(persistedItems)
    const populatedIds = Array.from(migratedIds).filter(id => tracker.getRelays(id).size > 0)
    const emptyIds = Array.from(migratedIds).filter(id => tracker.getRelays(id).size === 0)
    if (populatedIds.length > 0) {
      await table.bulkPut(populatedIds.map(id => ({id, relays: Array.from(tracker.getRelays(id))})))
    }
    if (emptyIds.length > 0) await _onRemove(emptyIds)

    return () => {
      tracker.off("add", onAdd)
      tracker.off("remove", onRemove)
      tracker.off("load", onLoad)
      tracker.off("clear", onClear)
      unsubscribeRepository()
    }
  },
}

const relaysAdapter = {
  name: "relays",
  keyPath: "url",
  init: async (table: IDBTable<RelayProfile>) => {
    const {records, writeRecords, staleKeys} = migratePersistedRelayRecords(await table.getAll())
    relaysByUrl.set(indexBy(r => r.url, records))
    if (writeRecords.length > 0) await table.bulkPut(writeRecords)
    if (staleKeys.length > 0) await table.bulkDelete(staleKeys)

    return onRelay(batch(1000, table.bulkPut))
  },
}

const relayStatsAdapter = {
  name: "relayStats",
  keyPath: "url",
  init: async (table: IDBTable<RelayStats>) => {
    const {records, writeRecords, staleKeys} = migratePersistedRelayRecords(await table.getAll())
    relayStatsByUrl.set(indexBy(r => r.url, records))
    if (writeRecords.length > 0) await table.bulkPut(writeRecords)
    if (staleKeys.length > 0) await table.bulkDelete(staleKeys)

    return onRelayStats(batch(1000, table.bulkPut))
  },
}

const handlesAdapter = {
  name: "handles",
  keyPath: "nip05",
  init: async (table: IDBTable<Handle>) => {
    handlesByNip05.set(indexBy((r: Handle) => r.nip05, await table.getAll()))

    return onHandle(batch(1000, table.bulkPut))
  },
}

const zappersAdapter = {
  name: "zappers",
  keyPath: "lnurl",
  init: async (table: IDBTable<Zapper>) => {
    zappersByLnurl.set(indexBy(z => z.lnurl, await table.getAll()))

    return onZapper(batch(3000, table.bulkPut))
  },
}

type PlaintextItem = {key: string; value: string}

const plaintextAdapter = {
  name: "plaintext",
  keyPath: "key",
  init: async (table: IDBTable<PlaintextItem>) => {
    const initialRecords = await table.getAll()

    plaintext.set(fromPairs(initialRecords.map(({key, value}) => [key, value])))

    return throttled(3000, plaintext).subscribe($plaintext => {
      table.bulkPut(Object.entries($plaintext).map(([key, value]) => ({key, value})))
    })
  },
}

export const adapters = [
  eventsAdapter,
  trackerAdapter,
  relaysAdapter,
  relayStatsAdapter,
  handlesAdapter,
  zappersAdapter,
  plaintextAdapter,
]
