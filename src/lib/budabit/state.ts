import {writable, derived, get as getStore, type Writable} from "svelte/store"
import {load, request} from "@welshman/net"
import {
  groupByEuc,
  deriveMaintainers,
  buildPatchGraph,
  assembleIssueThread,
  resolveIssueStatus,
  extractSelfLabels,
  extractLabelEvents,
  mergeEffectiveLabels,
  GIT_REPO_ANNOUNCEMENT,
  parseRepoAnnouncementEvent,
  type RepoGroup,
  type RepoAnnouncementEvent,
} from "@nostr-git/core/events"
import {RepoCore} from "@nostr-git/core/git"
import {repository, pubkey} from "@welshman/app"
import {deriveEventsAsc, deriveEventsById, withGetter} from "@welshman/store"
import {
  PLATFORM_RELAYS,
  deriveEvent,
  roomComparator,
  membershipsByPubkey,
  getMembershipRoomsByUrl,
  fromCsv,
} from "@app/core/state"
import {Router} from "@welshman/router"
import {
  isRelayUrl,
  normalizeRelayUrl,
  type TrustedEvent,
  ROOM_META,
  getTag,
  getTagValue,
  getAddress,
} from "@welshman/util"
import {nip19} from "nostr-tools"
import {fromPairs, pushToMapKey, sortBy, uniq, uniqBy} from "@welshman/lib"
import {extractRoleAssignments} from "./labels"
import type {Repo} from "@nostr-git/ui"

export const shouldReloadRepos = writable(false)

export const activeRepoClass = writable<Repo | undefined>(undefined)

export const REPO_KEY = Symbol("repo")

export const REPO_RELAYS_KEY = Symbol("repo-relays")

export const STATUS_EVENTS_BY_ROOT_KEY = Symbol("status-events-by-root")

export const PULL_REQUESTS_KEY = Symbol("pull-requests")

export const GIT_CLIENT_ID = import.meta.env.VITE_GH_CLIENT_ID

export const FREELANCE_JOB = 32767

export const DEFAULT_WORKER_PUBKEY =
  "d70d50091504b992d1838822af245d5f6b3a16b82d917acb7924cef61ed4acee"

export const GIT_RELAYS = fromCsv(import.meta.env.VITE_GIT_RELAYS)

const safeNormalizeRelayUrl = (url: string) => {
  try {
    return normalizeRelayUrl(url)
  } catch {
    return ""
  }
}

const isHexPubkey = (value: string) => /^[0-9a-f]{64}$/i.test(value)

const normalizePubkey = (value: string) => {
  if (!value) return ""
  if (isHexPubkey(value)) return value
  if (value.startsWith("npub")) {
    try {
      const decoded = nip19.decode(value)
      if (decoded.type === "npub" && typeof decoded.data === "string") {
        return decoded.data
      }
    } catch {
      return ""
    }
  }
  return ""
}

const getRepoEuc = (event: RepoAnnouncementEvent) => {
  const tag = (event.tags || []).find((t: string[]) => t[0] === "r" && t[2] === "euc")
  return tag?.[1] || ""
}

export const getRepoAnnouncementRelays = (extra: string[] = []) => {
  let userRelays: string[] = []
  try {
    userRelays = Router.get().FromUser().getUrls()
  } catch {
    userRelays = []
  }
  const merged = [...userRelays, ...GIT_RELAYS, ...extra]
  return Array.from(
    new Set(merged.map(u => safeNormalizeRelayUrl(u)).filter(isRelayUrl)),
  ) as string[]
}

export const ROOMS = 10009

export const GENERAL = "_"

// Job-related types and stores
export interface JobRequestEvent {
  id: string
  pubkey: string
  content: string
  created_at: number
  tags: string[][]
}

export interface JobRequestStatus {
  status: "pending" | "success" | "error"
  eventId?: string
  relays: Array<{url: string; status: "success" | "error"; error?: string}>
  error?: string
}

export const jobRequestStatus = writable<JobRequestStatus | null>(null)

export const jobLink = (naddr: string) => `https://test.satshoot.com/${naddr}`
export const gitLink = (naddr: string) => `https://gitworkshop.dev/${naddr}`

// Repositories adapter (NIP-34 repo announcements)
// - derive announcements (30617)
// - group by r:euc using core's groupByEuc
// - expose lookups and maintainer derivation helpers

const repoAnnouncementsRaw = deriveEventsAsc(
  deriveEventsById({repository, filters: [{kinds: [30617]}]}),
)

export const repoAnnouncements = derived(repoAnnouncementsRaw, $events => {
  const isDeletedRepoAnnouncement = (event: {tags?: string[][]}) =>
    (event.tags || []).some(tag => tag[0] === "deleted")
  const latestByAddress = new Map<string, RepoAnnouncementEvent>()
  for (const event of ($events as RepoAnnouncementEvent[]) || []) {
    const address = getAddress(event)
    latestByAddress.set(address, event)
  }
  return Array.from(latestByAddress.values()).filter(event => !isDeletedRepoAnnouncement(event))
})

export const repoAnnouncementsByAddress = derived(repoAnnouncements, $events => {
  const map = new Map<string, RepoAnnouncementEvent>()
  for (const event of ($events as RepoAnnouncementEvent[]) || []) {
    try {
      const address = getAddress(event)
      map.set(address, event)
    } catch {
      continue
    }
  }
  return map
})

export const effectiveMaintainersByRepoAddress = derived(
  [repoAnnouncements, repoAnnouncementsByAddress],
  ([$events, $byAddress]) => {
    const map = new Map<string, Set<string>>()

    for (const ownerEvent of $events as RepoAnnouncementEvent[]) {
      const repoId = getTagValue("d", ownerEvent.tags) || ""
      if (!repoId) continue
      const ownerEuc = getRepoEuc(ownerEvent)
      const owner = normalizePubkey(ownerEvent.pubkey)
      if (!owner) continue

      let maintainers: string[] = []
      try {
        const parsed = parseRepoAnnouncementEvent(ownerEvent)
        maintainers = (parsed.maintainers || []).map(normalizePubkey).filter(Boolean)
      } catch {
        maintainers = []
      }

      const candidates = new Set<string>([owner, ...maintainers])
      const effective = new Set<string>()
      const ownerAddress = `${GIT_REPO_ANNOUNCEMENT}:${owner}:${repoId}`
      effective.add(owner)

      for (const pubkey of candidates) {
        const candidateAddress = `${GIT_REPO_ANNOUNCEMENT}:${pubkey}:${repoId}`
        const candidateEvent = $byAddress.get(candidateAddress)
        if (!candidateEvent) continue
        const candidateEuc = getRepoEuc(candidateEvent)
        if (ownerEuc || candidateEuc) {
          if (ownerEuc && candidateEuc && ownerEuc === candidateEuc) {
            effective.add(pubkey)
          }
        } else {
          effective.add(pubkey)
        }
      }

      if (effective.size > 0) {
        map.set(ownerAddress, effective)
      }
    }

    return map
  },
)

export const effectiveRepoAddressesByRepoAddress = derived(
  effectiveMaintainersByRepoAddress,
  $byMaintainers => {
    const map = new Map<string, Set<string>>()
    for (const [repoAddress, maintainers] of $byMaintainers.entries()) {
      const parts = repoAddress.split(":")
      if (parts.length < 3) continue
      const [kind, , identifier] = parts
      const addresses = new Set<string>()
      for (const pubkey of maintainers) {
        if (!pubkey) continue
        addresses.add(`${kind}:${pubkey}:${identifier}`)
      }
      if (addresses.size > 0) {
        map.set(repoAddress, addresses)
      }
    }
    return map
  },
)

export const repoGroups = derived(repoAnnouncements, ($events): RepoGroup[] => {
  return groupByEuc($events as any)
})

// Map of euc -> count of repo announcement events (30617) in that group
export const repoCountsByEuc = derived(repoAnnouncements, $events => {
  const counts = new Map<string, number>()
  for (const ev of $events) {
    const t = (ev.tags || []).find((t: string[]) => t[0] === "r" && t[2] === "euc")
    const euc = t ? t[1] : ""
    if (!euc) continue
    counts.set(euc, (counts.get(euc) || 0) + 1)
  }
  return counts
})

// Map groups by EUC for backward compatibility
// Note: With composite keys, multiple groups may share the same EUC (forks)
// This map returns the first group found for each EUC
export const repoGroupsByEuc = derived(repoGroups, $groups => {
  const map = new Map<string, RepoGroup>()
  for (const g of $groups) {
    // Only set if not already present (first wins)
    if (!map.has(g.euc)) map.set(g.euc, g)
  }
  return map
})

export const deriveRepoGroup = (euc: string) =>
  withGetter(derived(repoGroupsByEuc, $by => $by.get(euc)))

export const deriveMaintainersForEuc = (euc: string) =>
  withGetter(derived(deriveRepoGroup(euc), g => (g ? deriveMaintainers(g) : new Set<string>())))

export const loadRepoAnnouncements = (relays?: string[]) => {
  const targetRelays = (relays && relays.length > 0 ? relays : getRepoAnnouncementRelays())
    .map(u => safeNormalizeRelayUrl(u))
    .filter(isRelayUrl) as string[]
  return load({
    relays: targetRelays,
    filters: [{kinds: [30617]}],
  })
}

export const loadRepoAnnouncementsForPubkeys = (
  pubkeys: string[],
  repoId: string,
  euc?: string,
) => {
  const normalized = Array.from(new Set(pubkeys.map(normalizePubkey).filter(Boolean)))
  if (normalized.length === 0 || !repoId) return
  let outboxRelays: string[] = []
  try {
    outboxRelays = Router.get().FromPubkeys(normalized).getUrls()
  } catch {
    outboxRelays = []
  }
  const relays = Array.from(new Set([...GIT_RELAYS, ...outboxRelays]))
  const filters = [
    {
      kinds: [GIT_REPO_ANNOUNCEMENT],
      authors: normalized,
      ...(euc ? {"#r": [euc]} : {"#d": [repoId]}),
    },
  ]
  return load({relays, filters})
}

export const loadRepoAnnouncementByAddress = (repoAddr: string) => {
  const parts = repoAddr.split(":")
  if (parts.length < 3) return
  const [, pubkey, repoId] = parts
  return loadRepoAnnouncementsForPubkeys([pubkey], repoId)
}

export const loadRepoMaintainerAnnouncements = (repoEvent: RepoAnnouncementEvent) => {
  const repoId = getTagValue("d", repoEvent.tags) || ""
  if (!repoId) return
  const owner = normalizePubkey(repoEvent.pubkey)
  let maintainers: string[] = []
  try {
    const parsed = parseRepoAnnouncementEvent(repoEvent)
    maintainers = (parsed.maintainers || []).map(normalizePubkey).filter(Boolean)
  } catch {
    maintainers = []
  }
  const pubkeys = Array.from(new Set([owner, ...maintainers].filter(Boolean)))
  const euc = getRepoEuc(repoEvent)
  return loadRepoAnnouncementsForPubkeys(pubkeys, repoId, euc || undefined)
}

// ---------------------------------------------------------------------------
// NIP-34 / 22 / 32 convergence helpers

/**
 * Derive merged ref heads for a repo group by euc, bounded by recognized maintainers.
 */
export const deriveRepoRefState = (euc: string) =>
  withGetter(
    derived(
      [
        deriveEventsAsc(deriveEventsById({repository, filters: [{kinds: [30618]}]})),
        deriveRepoGroup(euc),
      ],
      ([$states, $group]) => {
        const maintainers = $group ? deriveMaintainers($group) : new Set<string>()
        const ctx = {maintainers: Array.from(maintainers)}
        return RepoCore.mergeRepoStateByMaintainers(ctx as any, $states as unknown as any[])
      },
    ),
  )

/**
 * Derive role assignments for a given root id.
 */
export const deriveRoleAssignments = (rootId: string) =>
  withGetter(
    derived(
      deriveEventsAsc(deriveEventsById({repository, filters: [{kinds: [1985], "#e": [rootId]}]})),
      $events => extractRoleAssignments($events as any[], rootId),
    ),
  )

/**
 * Derive combined role assignments for a list of root ids.
 */
export const deriveAssignmentsFor = (rootIds: string[]) =>
  withGetter(
    derived(
      deriveEventsAsc(deriveEventsById({repository, filters: [{kinds: [1985], "#e": rootIds}]})),
      $events => {
        const assignmentsByRoot = new Map<
          string,
          {assignees: Set<string>; reviewers: Set<string>}
        >()

        // Initialize empty sets for each root ID
        for (const rootId of rootIds) {
          assignmentsByRoot.set(rootId, {
            assignees: new Set<string>(),
            reviewers: new Set<string>(),
          })
        }

        // Parse events and assign to appropriate root IDs
        for (const ev of $events) {
          if (!ev || ev.kind !== 1985 || !Array.isArray(ev.tags)) continue

          const hasRoleNs = ev.tags.some(
            (t: string[]) => t[0] === "L" && t[1] === "org.nostr.git.role",
          )
          if (!hasRoleNs) continue

          const rootTags = ev.tags.filter((t: string[]) => t[0] === "e")
          const roleTags = ev.tags.filter(
            (t: string[]) => t[0] === "l" && t[2] === "org.nostr.git.role",
          )
          const people = ev.tags.filter((t: string[]) => t[0] === "p").map((t: string[]) => t[1])

          for (const rootTag of rootTags) {
            const rootId = rootTag[1]
            if (!rootId || !assignmentsByRoot.has(rootId)) continue

            const assignment = assignmentsByRoot.get(rootId)!
            const hasAssignee = roleTags.some((t: string[]) => t[1] === "assignee")
            const hasReviewer = roleTags.some((t: string[]) => t[1] === "reviewer")

            if (hasAssignee) for (const p of people) assignment.assignees.add(p)
            if (hasReviewer) for (const p of people) assignment.reviewers.add(p)
          }
        }

        return assignmentsByRoot
      },
    ),
  )

/**
 * Build a patch DAG for patches addressed to a given repo address (a-tag value).
 */
export const derivePatchGraph = (addressA: string) =>
  withGetter(
    derived(
      deriveEventsAsc(deriveEventsById({repository, filters: [{kinds: [1617], "#a": [addressA]}]})),
      $patches => buildPatchGraph($patches as unknown as any[]),
    ),
  )

/**
 * Assemble an issue thread (root + NIP-22 comments + statuses) for a given root id.
 */
export const deriveIssueThread = (rootId: string) =>
  withGetter(
    derived(
      [
        deriveEvent(rootId),
        deriveEventsAsc(deriveEventsById({repository, filters: [{kinds: [1111], "#e": [rootId]}]})),
        deriveEventsAsc(
          deriveEventsById({
            repository,
            filters: [{kinds: [1630, 1631, 1632, 1633], "#e": [rootId]}],
          }),
        ),
      ],
      ([$root, $comments, $statuses]) =>
        $root
          ? assembleIssueThread({
              root: $root as unknown as any,
              comments: $comments as unknown as any[],
              statuses: $statuses as unknown as any[],
            })
          : undefined,
    ),
  )

/**
 * Resolve final status for an issue or patch root using precedence rules.
 */
export const deriveStatus = (rootId: string, rootAuthor: string, euc: string) =>
  withGetter(
    derived([deriveIssueThread(rootId), deriveRepoGroup(euc)], ([$thread, $group]) => {
      if (!$thread) return undefined
      const maintainers = $group ? deriveMaintainers($group) : new Set<string>()
      return resolveIssueStatus($thread as unknown as any, rootAuthor, maintainers)
    }),
  )

/**
 * Effective labels for an event id by combining self labels, external 1985 labels, and legacy #t.
 */
export const deriveEffectiveLabels = (eventId: string) =>
  withGetter(
    derived(
      [
        deriveEvent(eventId),
        deriveEventsAsc(
          deriveEventsById({repository, filters: [{kinds: [1985], "#e": [eventId]}]}),
        ),
      ],
      ([$evt, $external]) => {
        if (!$evt) return undefined
        const self = extractSelfLabels($evt as unknown as any)
        const external = extractLabelEvents($external as unknown as any[])
        const t = (($evt as any).tags || [])
          .filter((t: string[]) => t[0] === "t")
          .map((t: string[]) => t[1])
        return mergeEffectiveLabels({self, external, t})
      },
    ),
  )

/**
 * Load repo context using redundant subscriptions with client-side dedupe.
 */
export const loadRepoContext = (args: {
  addressA?: string
  rootId?: string
  euc?: string
  relays?: string[]
}) => {
  const {filters} = RepoCore.buildRepoSubscriptions({
    addressA: args.addressA,
    rootEventId: args.rootId,
    euc: args.euc,
  })
  const defaults = GIT_RELAYS
  const relays = (args.relays || defaults)
    .map((u: string) => normalizeRelayUrl(u))
    .filter(isRelayUrl) as string[]
  return load({relays, filters})
}

export type Channel = {
  id: string
  url: string
  room: string
  event: TrustedEvent
  name: string
  closed: boolean
  private: boolean
  picture?: string
  about?: string
}

export const splitChannelId = (id: string) => id.split("'")

export const channelEvents = deriveEventsAsc(
  deriveEventsById({repository, filters: [{kinds: [ROOM_META]}]}),
)

export const getUrlsForEvent = withGetter(
  derived([], () => (id: string) => PLATFORM_RELAYS as string[]),
)

export const userRoomsByUrl = derived([pubkey, membershipsByPubkey], ([$pubkey, $mb]) => {
  const result = new Map<string, Set<string>>()
  const list = $pubkey ? $mb.get($pubkey) : undefined

  for (const url of PLATFORM_RELAYS) {
    result.set(url, new Set(getMembershipRoomsByUrl(url, list)))
  }

  return result
})

export const deriveNaddrEvent = (naddr: string, hints: string[] = []) => {
  let attempted = false
  const decoded = nip19.decode(naddr).data as nip19.AddressPointer
  const fallbackRelays = [...hints, ...GIT_RELAYS]
  const relays = (decoded.relays && decoded.relays.length > 0 ? decoded.relays : fallbackRelays)
    .map(u => normalizeRelayUrl(u))
    .filter(isRelayUrl)
  const filters = [
    {
      authors: [decoded.pubkey],
      kinds: [decoded.kind],
      "#d": [decoded.identifier],
    },
  ]

  return derived(
    deriveEventsAsc(deriveEventsById({repository, filters})),
    (events: TrustedEvent[]) => {
      if (!attempted && events.length === 0) {
        load({relays: relays as string[], filters})
        attempted = true
      }
      return events[0]
    },
  )
}

export const makeChannelId = (url: string, room: string): string => {
  if (room.startsWith("naddr1")) {
    return "naddr1"
  }
  return `${url}'${room}`
}

export const displayChannel = (url: string, room: string) => {
  if (room === GENERAL) {
    return "generalisimo"
  }
  return channelsById.get().get(makeChannelId(url, room))?.name || room
}

export const deriveUserRooms = (url: string) =>
  derived(userRoomsByUrl, $userRoomsByUrl =>
    sortBy(roomComparator(url), uniq(Array.from($userRoomsByUrl.get(url) || [GENERAL]))),
  )

export const deriveOtherRooms = (url: string) =>
  derived([deriveUserRooms(url), channelsByUrl], ([$userRooms, $channelsByUrl]) =>
    sortBy(
      roomComparator(url),
      ($channelsByUrl.get(url) || []).filter(c => !$userRooms.includes(c.room)).map(c => c.room),
    ),
  )

export const channels = derived(
  [channelEvents, getUrlsForEvent],
  ([$channelEvents, $getUrlsForEvent]) => {
    const $channels: Channel[] = []
    for (const event of $channelEvents) {
      const meta = fromPairs(event.tags)
      const room = meta.d
      if (room) {
        for (const url of $getUrlsForEvent(event.id)) {
          const id = makeChannelId(url, room)

          $channels.push({
            id,
            url,
            room,
            event,
            name: meta.name || room,
            closed: Boolean(getTag("closed", event.tags)),
            private: Boolean(getTag("private", event.tags)),
            picture: meta.picture,
            about: meta.about,
          })
        }
      }
    }

    return uniqBy(c => c.id, $channels)
  },
)

export const channelsById = withGetter(
  derived(channels, $channels => {
    const m = new Map<string, Channel>()
    for (const c of $channels) m.set(c.id, c)
    return m
  }),
)

export const _loadChannel = async (id: string) => {
  const [url, room] = splitChannelId(id)
  await load({
    relays: [normalizeRelayUrl(url)],
    filters: [{kinds: [ROOM_META], "#d": [room]}],
  })
}

export const _deriveChannel = (id: string) => withGetter(derived(channelsById, $m => $m.get(id)))

export const channelsByUrl = derived(channelsById, $channelsById => {
  const $channelsByUrl = new Map<string, Channel[]>()

  for (const channel of $channelsById.values()) {
    pushToMapKey($channelsByUrl, channel.url, channel)
  }

  return $channelsByUrl
})

export async function loadPlatformChannels() {
  await request({
    relays: PLATFORM_RELAYS,
    filters: [{kinds: [ROOM_META]}],
    autoClose: true,
  })
}
