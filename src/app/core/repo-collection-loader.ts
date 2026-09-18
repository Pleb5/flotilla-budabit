import {writable, type Readable} from "svelte/store"
import {REACTION, matchFilters, type Filter, type TrustedEvent} from "@welshman/util"
import {TARGETED_PUBLICATION_KIND, parseTargetedPublication} from "@app/core/community"
import {makeTargetedPublicationOriginalFilterPlan} from "@app/core/community-feeds"
import {normalizeRepoRelays} from "@app/core/repo-relays"
import {makeRepoStarReactionFilter, selectActiveRepoStars} from "@app/util/repo-stars"
import {
  buildRepoCommunityStarCollections,
  getDeletedRepoCollectionTargetIds,
  type RepoCollectionCommunityOption,
  type RepoCollectionReadState,
} from "@app/core/repo-collection-read-model"
import {
  makeSameAuthorDeleteFilters,
  type BoundedCommunityHistoryOptions,
  type BoundedCommunityHistoryResult,
} from "./requests"

export const REPO_COLLECTION_CONTEXT_KEY = Symbol("repo-collections")
const BATCH_MS = 75
const TAG_CHUNK_SIZE = 100

export type RepoCollectionSnapshot = RepoCollectionReadState & {
  viewerPubkey: string
  personalHistorySettled: boolean
  personalHistoryComplete: boolean
  personalHistoryCompleteByAddress: ReadonlySet<string>
}

export type RepoCollectionDemand = {address: string; relays: string[]}

export type RepoCollectionContext = Readable<RepoCollectionSnapshot> & {
  ensureRepositories: (repositories: RepoCollectionDemand[]) => void
  retry: () => void
}

export type RepoCollectionScope = {
  viewerPubkey: string
  personalRelays: string[]
  communityOptions: RepoCollectionCommunityOption[]
  communitiesReady?: boolean
  authorizeTargets: (
    events: TrustedEvent[],
    community: RepoCollectionCommunityOption,
  ) => TrustedEvent[]
}

type Dependencies = {
  load: (options: BoundedCommunityHistoryOptions) => Promise<BoundedCommunityHistoryResult>
  query: (filters: Filter[]) => TrustedEvent[]
  watch: (filters: Filter[], onChange: () => void) => () => void
}

type HistoryRead = {
  key: string
  phase: string
  relay: string
  filter: Filter
  complete: boolean
  settled: boolean
  pending: boolean
  saturated: boolean
  attempts: number
  retryAt: number
}

const normalizeFilter = (filter: Filter): Filter =>
  Object.fromEntries(
    Object.entries(filter)
      .filter(([key]) => key !== "limit")
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [
        key,
        Array.isArray(value) ? [...new Set<string | number>(value)].sort() : value,
      ]),
  ) as Filter

const deleteFilters = (events: TrustedEvent[]) =>
  makeSameAuthorDeleteFilters(events.slice().sort((a, b) => a.id.localeCompare(b.id)))

const emptySnapshot = (viewerPubkey = ""): RepoCollectionSnapshot => ({
  viewerPubkey,
  personalStars: [],
  communityOptions: [],
  communityStars: [],
  communityHistoryComplete: !viewerPubkey,
  personalHistorySettled: !viewerPubkey,
  personalHistoryComplete: !viewerPubkey,
  personalHistoryCompleteByAddress: new Set(),
})

/** One reader per /git layout. Pages contribute demand; only this owner issues requests. */
export const createRepoCollectionLoader = (dependencies: Dependencies) => {
  const state = writable(emptySnapshot())
  let scope: RepoCollectionScope = {
    viewerPubkey: "",
    personalRelays: [],
    communityOptions: [],
    authorizeTargets: events => events,
  }
  const repositories = new Map<string, string[]>()
  const reads = new Map<string, HistoryRead>()
  let controller = new AbortController()
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let unwatch: (() => void) | undefined
  let watchKey = ""

  const schedule = () => {
    if (disposed || timer) return
    timer = setTimeout(() => {
      timer = undefined
      reconcile()
    }, BATCH_MS)
  }

  const reconcile = () => {
    if (disposed) return
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = undefined
    const user = scope.viewerPubkey
    if (!user) {
      state.set(emptySnapshot())
      return
    }

    const needed = new Set<HistoryRead>()
    const localFilters: Filter[] = []
    const query = (filters: Filter[]) => {
      localFilters.push(...filters)
      return filters.length ? dependencies.query(filters) : []
    }
    const history = (phase: string, relays: string[], filters: Filter[]) =>
      relays.flatMap(relay =>
        filters.map(rawFilter => {
          const filter = normalizeFilter(rawFilter)
          const key = JSON.stringify([phase, relay, filter])
          let read = reads.get(key)
          if (!read) {
            read = {
              key,
              phase,
              relay,
              filter,
              complete: false,
              settled: false,
              pending: false,
              saturated: false,
              attempts: 0,
              retryAt: 0,
            }
            reads.set(key, read)
          }
          needed.add(read)
          return read
        }),
      )
    const complete = (items: HistoryRead[]) => items.every(read => read.complete)
    const deletionHistory = (phase: string, relays: string[], filters: Filter[]) =>
      relays.flatMap(relay =>
        filters.flatMap(filter => {
          const tag = filter["#e"] ? "#e" : "#a"
          const missing = new Set(filter[tag])
          const covered: HistoryRead[] = []
          // Preserve completed/in-flight chunks as new history pages arrive. A
          // growing ID array must not re-read deletions for every earlier page.
          for (const read of reads.values()) {
            if (
              read.phase !== phase ||
              read.relay !== relay ||
              read.filter.authors?.[0] !== filter.authors?.[0] ||
              !read.filter[tag]?.some(value => missing.has(value))
            )
              continue
            for (const value of read.filter[tag]!) missing.delete(value)
            needed.add(read)
            covered.push(read)
          }
          if (missing.size)
            covered.push(...history(phase, [relay], [{...filter, [tag]: [...missing]}]))
          return covered
        }),
      )

    const reactionFilter = normalizeFilter(makeRepoStarReactionFilter(user)!)
    const reactions = query([reactionFilter])
    const personalDeleteFilters = deleteFilters(reactions)
    const personalDeletes = query(personalDeleteFilters)
    const personalStars = selectActiveRepoStars({
      reactions,
      deleteEvents: personalDeletes,
      author: user,
    })
    const personalRelays = normalizeRepoRelays(scope.personalRelays)
    const allPersonalRelays = normalizeRepoRelays([
      ...personalRelays,
      ...Array.from(repositories.values()).flat(),
    ])
    const personalReads = new Map(
      allPersonalRelays.map(relay => [
        relay,
        history("personal-stars", [relay], [reactionFilter])[0],
      ]),
    )
    const personalDeleteReads = new Map(
      allPersonalRelays.map(relay => [
        relay,
        deletionHistory("personal-deletes", [relay], personalDeleteFilters),
      ]),
    )
    const personalHistoryCompleteByAddress = new Set<string>()

    // A large user history may exhaust its budget. Resolve visible addresses in
    // batches on that relay, without repeating the saturated account-wide scan.
    const scopedPersonalReads = new Map<string, HistoryRead[]>()
    for (const relay of allPersonalRelays) {
      if (!personalReads.get(relay)?.saturated) continue
      const addresses = Array.from(repositories)
        .filter(([, relays]) => (relays.length ? relays : personalRelays).includes(relay))
        .map(([address]) => address)
        .sort()
      const missing: string[] = []
      for (const address of addresses) {
        const existing = Array.from(reads.values()).find(
          read =>
            read.phase === "personal-scoped" &&
            read.relay === relay &&
            read.filter["#a"]?.includes(address),
        )
        if (existing) {
          needed.add(existing)
          scopedPersonalReads.set(`${relay}:${address}`, [existing])
        } else missing.push(address)
      }
      for (let i = 0; i < missing.length; i += TAG_CHUNK_SIZE) {
        const batch = missing.slice(i, i + TAG_CHUNK_SIZE)
        const batchReads = history("personal-scoped", [relay], [{...reactionFilter, "#a": batch}])
        for (const address of batch) scopedPersonalReads.set(`${relay}:${address}`, batchReads)
      }
    }
    for (const [address, declaredRelays] of repositories) {
      const relays = declaredRelays.length ? declaredRelays : personalRelays
      if (
        relays.length &&
        relays.every(
          relay =>
            (personalReads.get(relay)?.complete ||
              scopedPersonalReads.get(`${relay}:${address}`)?.every(read => read.complete)) &&
            complete(personalDeleteReads.get(relay) || []),
        )
      )
        personalHistoryCompleteByAddress.add(address)
    }

    let communityHistoryComplete = scope.communitiesReady !== false
    const communityStars: RepoCollectionReadState["communityStars"] = []
    for (const community of scope.communityOptions) {
      const relays = normalizeRepoRelays([community.relay || "", ...(community.relays || [])])
      // This is an exact viewer lookup, not an ACL-derived community writer list.
      const filters: Filter[] = [
        {
          kinds: [TARGETED_PUBLICATION_KIND],
          authors: [user],
          "#h": [community.communityId],
          "#k": [String(REACTION)],
        },
      ]
      const targets = scope.authorizeTargets(query(filters), community)
      const targetReads = history("community-targets", relays, filters)
      const targetDeleteFilters = deleteFilters(targets)
      const targetDeletes = query(targetDeleteFilters)
      const targetDeleteReads = deletionHistory("community-deletes", relays, targetDeleteFilters)
      const deletedIds = getDeletedRepoCollectionTargetIds(targets, targetDeletes)
      const eligible = targets.filter(event => !deletedIds.has(event.id))
      const originals =
        makeTargetedPublicationOriginalFilterPlan(eligible).localFilters.map(normalizeFilter)
      const originalEvents = query(originals)
      let originalsComplete = true
      for (const event of eligible) {
        const originalFilters = makeTargetedPublicationOriginalFilterPlan([event]).localFilters.map(
          normalizeFilter,
        )
        if (
          originalFilters.length &&
          originalEvents.some(original => matchFilters(originalFilters, original))
        )
          continue
        originalsComplete = false
        const source = parseTargetedPublication(event)?.source
        // Exact originals can be published on a repository relay rather than the
        // community relay. Once found, optional discovery relays cannot veto them.
        history(
          "community-originals",
          normalizeRepoRelays([
            ...(source?.relay ? [source.relay] : []),
            ...relays,
            ...personalRelays,
          ]),
          originalFilters,
        )
      }
      communityHistoryComplete &&=
        relays.length > 0 &&
        complete(targetReads) &&
        complete(targetDeleteReads) &&
        originalsComplete
      communityStars.push(
        ...buildRepoCommunityStarCollections({
          viewerPubkey: user,
          communityOptions: [community],
          targetEvents: targets,
          targetDeleteEvents: targetDeletes,
          reactionEvents: originalEvents,
        }),
      )
    }

    const baselineReads = personalRelays.flatMap(relay => [
      personalReads.get(relay)!,
      ...(personalDeleteReads.get(relay) || []),
    ])
    state.set({
      viewerPubkey: user,
      personalStars,
      communityOptions: scope.communityOptions,
      communityStars,
      communityHistoryComplete,
      personalHistoryCompleteByAddress,
      personalHistoryComplete: personalRelays.length > 0 && complete(baselineReads),
      personalHistorySettled:
        personalRelays.length === 0 || baselineReads.every(read => read.settled),
    })

    const uniqueFilters = Array.from(
      new Map(
        localFilters.map(filter => {
          const normalized = normalizeFilter(filter)
          return [JSON.stringify(normalized), normalized] as const
        }),
      ).values(),
    )
    const nextWatchKey = JSON.stringify(uniqueFilters.map(filter => JSON.stringify(filter)).sort())
    if (watchKey !== nextWatchKey) {
      unwatch?.()
      watchKey = nextWatchKey
      unwatch = dependencies.watch(uniqueFilters, schedule)
    }

    const batches = new Map<string, HistoryRead[]>()
    let nextRetry = Infinity
    for (const read of needed) {
      if (read.complete || read.pending || read.saturated) continue
      if (read.retryAt > Date.now()) {
        nextRetry = Math.min(nextRetry, read.retryAt)
        continue
      }
      const key = `${read.phase}:${read.relay}`
      const batch = batches.get(key) || []
      batch.push(read)
      batches.set(key, batch)
      read.pending = true
    }
    if (Number.isFinite(nextRetry))
      retryTimer = setTimeout(schedule, Math.max(0, nextRetry - Date.now()))
    for (const batch of batches.values()) {
      const signal = controller.signal
      void dependencies
        .load({
          relays: [batch[0].relay],
          relayFilters: batch.map(read => read.filter),
          localFilters: batch.map(read => read.filter),
          signal,
          owner: `git-collections:${batch[0].phase}`,
          verifyTimestampBoundaries: true,
        })
        .catch(() => ({events: [], complete: false, timedOut: false, saturated: false}))
        .then(result => {
          if (disposed || signal.aborted) return
          for (const read of batch) {
            read.pending = false
            read.settled = true
            read.complete =
              result.complete &&
              (read.phase !== "community-originals" ||
                result.events.some(event => matchFilters([read.filter], event)))
            read.saturated = result.saturated
            read.attempts += 1
            read.retryAt = Date.now() + Math.min(60_000, 5000 * 2 ** Math.min(read.attempts - 1, 4))
          }
          schedule()
        })
    }
  }

  return {
    subscribe: state.subscribe,
    configure(next: RepoCollectionScope) {
      if (disposed) return
      if (next.viewerPubkey !== scope.viewerPubkey) {
        controller.abort()
        controller = new AbortController()
        reads.clear()
        unwatch?.()
        unwatch = undefined
        watchKey = ""
        state.set(emptySnapshot(next.viewerPubkey))
      }
      scope = next
      schedule()
    },
    ensureRepositories(targets: RepoCollectionDemand[]) {
      if (disposed) return
      let changed = false
      for (const {address, relays} of targets) {
        if (!address) continue
        const normalized = normalizeRepoRelays(relays).sort()
        if (JSON.stringify(repositories.get(address)) === JSON.stringify(normalized)) continue
        repositories.set(address, normalized)
        changed = true
      }
      if (changed) schedule()
    },
    retry() {
      for (const read of reads.values()) {
        if (read.complete) continue
        read.saturated = false
        read.retryAt = 0
      }
      schedule()
    },
    dispose() {
      disposed = true
      controller.abort()
      if (timer) clearTimeout(timer)
      if (retryTimer) clearTimeout(retryTimer)
      unwatch?.()
      reads.clear()
      repositories.clear()
    },
  }
}
