import {derived, get, writable, type Readable} from "svelte/store"
import {repository, pubkey} from "@welshman/app"
import {load} from "@welshman/net"
import {Router} from "@welshman/router"
import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
import {isRelayUrl, normalizeRelayUrl, type Filter, type TrustedEvent} from "@welshman/util"
import {GIT_RELAYS} from "@app/core/git-state"
import {
  makeRecentRepoStarDeleteFilter,
  makeRepoStarDeleteFilter,
  makeRepoStarReactionFilter,
  selectActiveRepoStars,
  type RepoStarRef,
} from "@app/util/repo-stars"

const REPO_STAR_HYDRATION_TTL = 30_000
const REPO_STAR_LOAD_TIMEOUT = 5_000

const normalizeRelay = (url?: string) => {
  if (!url) return ""

  try {
    const normalized = normalizeRelayUrl(url)
    return isRelayUrl(normalized) ? normalized : ""
  } catch {
    return ""
  }
}

const normalizeRelays = (relays: string[]) =>
  Array.from(new Set(relays.map(normalizeRelay).filter(Boolean)))

const getUserOutboxRelays = () => {
  try {
    return Router.get().FromUser().getUrls() || []
  } catch {
    return []
  }
}

export const getRepoStarRelays = (relayHints: string[] = []) =>
  normalizeRelays([...relayHints, ...getUserOutboxRelays(), ...GIT_RELAYS])

export const repoStarsLoading = writable(false)

export const repoStarReactionEvents: Readable<TrustedEvent[]> = derived(
  pubkey,
  ($pubkey, set) => {
    const filter = $pubkey ? makeRepoStarReactionFilter($pubkey) : undefined

    if (!filter) {
      set([])
      return
    }

    // Network page limits must not truncate the shared, already hydrated index.
    const localFilter = {...filter}
    delete localFilter.limit
    return deriveEventsAsc(deriveEventsById({repository, filters: [localFilter]})).subscribe(set)
  },
  [] as TrustedEvent[],
)

export const repoStarDeleteEvents: Readable<TrustedEvent[]> = derived(
  [pubkey, repoStarReactionEvents],
  ([$pubkey, $repoStarReactionEvents], set) => {
    const deleteFilter = $pubkey
      ? makeRepoStarDeleteFilter($pubkey, $repoStarReactionEvents)
      : undefined

    if (!deleteFilter) {
      set([])
      return
    }

    return deriveEventsAsc(deriveEventsById({repository, filters: [deleteFilter]})).subscribe(set)
  },
  [] as TrustedEvent[],
)

export const activeRepoStars: Readable<RepoStarRef[]> = derived(
  [pubkey, repoStarReactionEvents, repoStarDeleteEvents],
  ([$pubkey, $repoStarReactionEvents, $repoStarDeleteEvents]) =>
    selectActiveRepoStars({
      reactions: $repoStarReactionEvents,
      deleteEvents: $repoStarDeleteEvents,
      author: $pubkey || undefined,
    }),
  [] as RepoStarRef[],
)

export const activeRepoStarByAddress: Readable<Map<string, RepoStarRef>> = derived(
  activeRepoStars,
  $activeRepoStars => new Map($activeRepoStars.map(star => [star.address, star])),
)

const repoStarHydrations = new Map<string, Promise<boolean>>()
const repoStarHydratedAt = new Map<string, number>()
let activeRepoStarHydrations = 0

const loadRepoStarEvents = async ({
  relays,
  filters,
  signal,
}: {
  relays: string[]
  filters: Filter[]
  signal?: AbortSignal
}) => {
  const timeoutController = new AbortController()
  const requestSignal = signal
    ? AbortSignal.any([signal, timeoutController.signal])
    : timeoutController.signal
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    timeoutController.abort()
  }, REPO_STAR_LOAD_TIMEOUT + 500)

  try {
    await load({relays, filters, signal: requestSignal})
    return !timedOut && !signal?.aborted
  } catch (error) {
    if (requestSignal.aborted) return false
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

export const hydrateRepoStars = ({
  relayHints = [],
  repoAddress = "",
  repoAddresses = [],
  force = false,
  signal,
}: {
  relayHints?: string[]
  repoAddress?: string
  repoAddresses?: string[]
  force?: boolean
  signal?: AbortSignal
} = {}): Promise<boolean> => {
  const user = pubkey.get()
  const reactionFilter = user ? makeRepoStarReactionFilter(user) : undefined
  const relays = getRepoStarRelays(relayHints)
  const addresses = Array.from(new Set([repoAddress, ...repoAddresses].filter(Boolean))).sort()
  const key = `${user || ""}:${addresses.join(",") || "*"}:${relays.slice().sort().join(",")}`

  if (!user || !reactionFilter || relays.length === 0) {
    return Promise.resolve(false)
  }

  const existing = repoStarHydrations.get(key)
  if (!force && existing) return existing

  if (
    !force &&
    (repoStarHydratedAt.get(key) || 0) > 0 &&
    Date.now() - (repoStarHydratedAt.get(key) || 0) < REPO_STAR_HYDRATION_TTL
  ) {
    return Promise.resolve(true)
  }

  activeRepoStarHydrations += 1
  repoStarsLoading.set(true)
  let hydration = Promise.resolve(false)
  hydration = (async () => {
    let completed = false
    try {
      const scopedReactionFilter = addresses.length
        ? {...reactionFilter, "#a": addresses}
        : reactionFilter
      completed = await loadRepoStarEvents({
        relays,
        filters: [scopedReactionFilter] as Filter[],
        signal,
      })
      if (!completed) return false

      const cachedReactions = get(repoStarReactionEvents).filter(
        event =>
          addresses.length === 0 ||
          event.tags.some(tag => tag[0] === "a" && addresses.includes(tag[1])),
      )
      const deleteFilters = [
        makeRepoStarDeleteFilter(user, cachedReactions),
        ...(addresses.length === 0 ? [makeRecentRepoStarDeleteFilter(user)] : []),
      ].filter(Boolean) as Filter[]

      if (deleteFilters.length > 0) {
        completed = await loadRepoStarEvents({relays, filters: deleteFilters, signal})
      }
    } finally {
      repoStarHydratedAt.set(key, completed ? Date.now() : 0)
      if (repoStarHydrations.get(key) === hydration) repoStarHydrations.delete(key)
      activeRepoStarHydrations = Math.max(0, activeRepoStarHydrations - 1)
      repoStarsLoading.set(activeRepoStarHydrations > 0)
    }
    return completed
  })()
  repoStarHydrations.set(key, hydration)
  return hydration
}
