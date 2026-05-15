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

const withTimeout = async <T>(promise: Promise<T>, timeout: number, fallback: T): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  return Promise.race([
    promise,
    new Promise<T>(resolve => {
      timeoutId = setTimeout(() => resolve(fallback), timeout)
    }),
  ]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId)
  })
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

    return deriveEventsAsc(deriveEventsById({repository, filters: [filter]})).subscribe(set)
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

let repoStarHydrationKey = ""
let repoStarHydrationRequestId = 0
let repoStarHydratedAt = 0

export const hydrateRepoStars = async ({
  relayHints = [],
  repoAddress = "",
  force = false,
}: {
  relayHints?: string[]
  repoAddress?: string
  force?: boolean
} = {}) => {
  const user = pubkey.get()
  const reactionFilter = user ? makeRepoStarReactionFilter(user) : undefined
  const relays = getRepoStarRelays(relayHints)
  const key = `${user || ""}:${repoAddress || "*"}:${relays.slice().sort().join(",")}`

  if (!user || !reactionFilter || relays.length === 0) {
    repoStarsLoading.set(false)
    repoStarHydrationKey = ""
    repoStarHydratedAt = 0
    return
  }

  if (
    !force &&
    repoStarHydrationKey === key &&
    Date.now() - repoStarHydratedAt < REPO_STAR_HYDRATION_TTL
  ) {
    return
  }

  const requestId = ++repoStarHydrationRequestId
  repoStarHydrationKey = key
  repoStarHydratedAt = Date.now()
  repoStarsLoading.set(true)

  try {
    const scopedReactionFilter = repoAddress
      ? {...reactionFilter, "#a": [repoAddress]}
      : reactionFilter

    await withTimeout(
      load({relays, filters: [scopedReactionFilter] as Filter[]}),
      REPO_STAR_LOAD_TIMEOUT + 500,
      [],
    )

    if (requestId !== repoStarHydrationRequestId) return

    const cachedReactions = get(repoStarReactionEvents)
    const deleteFilters = [
      makeRepoStarDeleteFilter(user, cachedReactions),
      makeRecentRepoStarDeleteFilter(user),
    ].filter(Boolean) as Filter[]

    if (deleteFilters.length > 0) {
      await withTimeout(load({relays, filters: deleteFilters}), REPO_STAR_LOAD_TIMEOUT + 500, [])
    }
  } finally {
    if (requestId === repoStarHydrationRequestId) repoStarsLoading.set(false)
  }
}
