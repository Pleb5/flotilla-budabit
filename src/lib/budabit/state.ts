
import { writable, derived, } from "svelte/store"
import { load } from "@welshman/net"
import {
  groupByEuc,
  deriveMaintainers,
  mergeRepoStateByMaintainers,
  buildPatchGraph,
  assembleIssueThread,
  resolveIssueStatus,
  buildRepoSubscriptions,
  extractSelfLabels,
  extractLabelEvents,
  mergeEffectiveLabels,
  type RepoGroup
} from "@nostr-git/core"
import { repository } from "@welshman/app"
import { collection, deriveEvents, withGetter } from "@welshman/store"
import { INDEXER_RELAYS, channelEvents, deriveEvent, messages, getUrlsForEvent, memberships, roomComparator, splitChannelId, userRoomsByUrl, type Channel, getMembershipRooms, ROOM } from "@app/core/state"
import { normalizeRelayUrl, type TrustedEvent, ROOM_META, getTag } from "@welshman/util"
import { nip19 } from "nostr-tools"
import { fromPairs, nthEq, pushToMapKey, sortBy, uniq, uniqBy } from "@welshman/lib"
import { extractRoleAssignments } from "./labels"

export const shouldReloadRepos = writable(false)

export const REPO_KEY = Symbol("repo")

export const REPO_RELAYS_KEY = Symbol("repo-relays")

export const GIT_CLIENT_ID = import.meta.env.VITE_GH_CLIENT_ID

export const FREELANCE_JOB = 32767

export const GIT_RELAYS = import.meta.env.VITE_GIT_RELAYS

export const ROOMS = 10009

export const GENERAL = "_"

export const jobLink = (naddr: string) => `https://test.satshoot.com/${naddr}`
export const gitLink = (naddr: string) => `https://gitworkshop.dev/${naddr}`

// Repositories adapter (NIP-34 repo announcements)
// - derive announcements (30617)
// - group by r:euc using core's groupByEuc
// - expose lookups and maintainer derivation helpers

export const repoAnnouncements = deriveEvents(repository, { filters: [{ kinds: [30617] }] })

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

export const loadRepoAnnouncements = (relays: string[] = INDEXER_RELAYS) =>
  load({
    relays: relays.map(u => normalizeRelayUrl(u)).filter(Boolean) as string[],
    filters: [{ kinds: [30617] }],
  })

// ---------------------------------------------------------------------------
// NIP-34 / 22 / 32 convergence helpers

/**
 * Derive merged ref heads for a repo group by euc, bounded by recognized maintainers.
 */
export const deriveRepoRefState = (euc: string) =>
  withGetter(
    derived(
      [deriveEvents(repository, { filters: [{ kinds: [30618] }] }), deriveRepoGroup(euc)],
      ([$states, $group]) => {
        const maintainers = $group ? deriveMaintainers($group) : new Set<string>()
        return mergeRepoStateByMaintainers({ states: $states as unknown as any[], maintainers })
      },
    ),
  )

/**
 * Derive role assignments for a given root id.
 */
export const deriveRoleAssignments = (rootId: string) =>
  withGetter(
    derived(
      deriveEvents(repository, { filters: [{ kinds: [1985], "#e": [rootId] }] }),
      ($events) => extractRoleAssignments($events as any[], rootId)
    )
  )

/**
 * Derive combined role assignments for a list of root ids.
 */
export const deriveAssignmentsFor = (rootIds: string[]) =>
  withGetter(
    derived(
      deriveEvents(repository, { filters: [{ kinds: [1985], "#e": rootIds }] }),
      ($events) => {
        const assignmentsByRoot = new Map<string, { assignees: Set<string>; reviewers: Set<string> }>()
        
        // Initialize empty sets for each root ID
        for (const rootId of rootIds) {
          assignmentsByRoot.set(rootId, { assignees: new Set<string>(), reviewers: new Set<string>() })
        }
        
        // Parse events and assign to appropriate root IDs
        for (const ev of $events) {
          if (!ev || ev.kind !== 1985 || !Array.isArray(ev.tags)) continue
          
          const hasRoleNs = ev.tags.some(
            (t: string[]) => t[0] === "L" && t[1] === "org.nostr.git.role"
          )
          if (!hasRoleNs) continue
          
          const rootTags = ev.tags.filter((t: string[]) => t[0] === "e" && t[1] === "root")
          const roleTags = ev.tags.filter(
            (t: string[]) => t[0] === "l" && t[2] === "org.nostr.git.role"
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
      }
    )
  )

/**
 * Build a patch DAG for patches addressed to a given repo address (a-tag value).
 */
export const derivePatchGraph = (addressA: string) =>
  withGetter(
    derived(deriveEvents(repository, { filters: [{ kinds: [1617], "#a": [addressA] }] }), $patches =>
      buildPatchGraph($patches as unknown as any[]),
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
        deriveEvents(repository, { filters: [{ kinds: [1111], "#e": [rootId] }] }),
        deriveEvents(repository, { filters: [{ kinds: [1630, 1631, 1632, 1633], "#e": [rootId] }] }),
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
        deriveEvents(repository, { filters: [{ kinds: [1985], "#e": [eventId] }] }),
      ],
      ([$evt, $external]) => {
        if (!$evt) return undefined
        const self = extractSelfLabels($evt as unknown as any)
        const external = extractLabelEvents($external as unknown as any[])
        const t = (($evt as any).tags || [])
          .filter((t: string[]) => t[0] === "t")
          .map((t: string[]) => t[1])
        return mergeEffectiveLabels({ self, external, t })
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
  const { filters } = buildRepoSubscriptions({
    addressA: args.addressA,
    rootEventId: args.rootId,
    euc: args.euc,
  })
  const defaults = GIT_RELAYS && GIT_RELAYS.length > 0 ? GIT_RELAYS : INDEXER_RELAYS
  const relays = (args.relays || defaults)
    .map((u: string) => normalizeRelayUrl(u))
    .filter(Boolean) as string[]
  return load({ relays, filters })
}

export const deriveNaddrEvent = (naddr: string, hints: string[] = []) => {
  let attempted = false
  const decoded = nip19.decode(naddr).data as nip19.AddressPointer
  const fallbackRelays = [...hints, ...INDEXER_RELAYS]
  const relays = (decoded.relays && decoded.relays.length > 0 ? decoded.relays : fallbackRelays)
    .map(u => normalizeRelayUrl(u))
    .filter(Boolean)
  const filters = [
    {
      authors: [decoded.pubkey],
      kinds: [decoded.kind],
      "#d": [decoded.identifier],
    },
  ]

  return derived(deriveEvents(repository, { filters }), (events: TrustedEvent[]) => {
    if (!attempted && events.length === 0) {
      load({ relays: relays as string[], filters })
      attempted = true
    }
    return events[0]
  })
}

export const makeChannelId = (url: string, room: string) => {
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
  [channelEvents, getUrlsForEvent, memberships, messages],
  ([$channelEvents, $getUrlsForEvent, $memberships, $messages]) => {
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

    // Add known rooms based on membership events
    for (const membership of $memberships) {
      for (const {url, room, name} of getMembershipRooms(membership)) {
        const id = makeChannelId(url, room)

        $channels.push({
          id,
          url,
          room,
          name,
          closed: false,
          private: false,
          event: membership.event,
          picture: undefined,
          about: undefined,
        })
      }
    }

    // Add rooms based on known messages
    for (const event of $messages) {
      const [_, room] = event.tags.find(nthEq(0, ROOM)) || []
      if (room) {
        for (const url of $getUrlsForEvent(event.id)) {
          const id = makeChannelId(url, room)

          $channels.push({
            id,
            url,
            room,
            name: room,
            event,
            closed: false,
            private: false,
          })
        }
      }
    }

    return uniqBy(c => c.id, $channels)
  },
)

export const {
  indexStore: channelsById,
  deriveItem: _deriveChannel,
  loadItem: _loadChannel,
} = collection({
  name: "channels",
  store: channels,
  getKey: channel => {
    return channel.id
  },
  load: async (id: string) => {
    const [url, room] = splitChannelId(id)
    await load({
      relays: [normalizeRelayUrl(url)],
      filters: [{kinds: [ROOM_META], "#d": [room]}, {kinds: [ROOMS]}],
    })
  },
})

export const channelsByUrl = derived(channelsById, $channelsById => {
  const $channelsByUrl = new Map<string, Channel[]>()

  for (const channel of $channelsById.values()) {
    pushToMapKey($channelsByUrl, channel.url, channel)
  }

  return $channelsByUrl
})
