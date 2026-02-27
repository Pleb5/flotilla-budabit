import {
  setNotificationCandidates,
  setNotificationsConfig,
  type NotificationCandidate,
} from "@app/util/notifications"
import {makeSpacePath} from "@app/util/routes"
import {PLATFORM_RELAYS, getSpaceUrlsFromGroupList} from "@app/core/state"
import {pubkey, repository} from "@welshman/app"
import {derived, get, type Readable} from "svelte/store"
import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
import {load, request} from "@welshman/net"
import {now} from "@welshman/lib"
import {
  Address,
  getTagValue,
  isRelayUrl,
  normalizeRelayUrl,
  type TrustedEvent,
} from "@welshman/util"
import {RepoCore} from "@nostr-git/core/git"
import {
  GIT_COMMENT,
  GIT_ISSUE,
  GIT_LABEL,
  GIT_PATCH,
  GIT_PULL_REQUEST,
  GIT_PULL_REQUEST_UPDATE,
  GIT_STATUS_APPLIED,
  GIT_STATUS_CLOSED,
  GIT_STATUS_DRAFT,
  GIT_STATUS_OPEN,
  parseRepoAnnouncementEvent,
  parseRoleLabelEvent,
  type RepoAnnouncementEvent,
} from "@nostr-git/core/events"
import {makeGitPath} from "@lib/budabit/routes"
import {
  GIT_RELAYS,
  loadRepoContext,
  repoAnnouncements,
  repoAnnouncementsByAddress,
  effectiveRepoAddressesByRepoAddress,
  loadRepoAnnouncementByAddress,
  loadRepoMaintainerAnnouncements,
} from "@lib/budabit/state"
import {defaultRepoWatchOptions, userRepoWatchValues} from "@lib/budabit/repo-watch"
import {bookmarksStore} from "@nostr-git/ui"

type RootType = "issue" | "patch"

const getRepoAddressParts = (repoAddr: string) => {
  const [kind, author, identifier] = repoAddr.split(":")
  if (!kind || !author || !identifier) return null
  const kindNumber = Number.parseInt(kind, 10)
  if (Number.isNaN(kindNumber)) return null
  return {kind: kindNumber, author, identifier}
}

const toRepoNaddr = (repoAddr: string, relays?: string[]) => {
  const parts = getRepoAddressParts(repoAddr)
  if (!parts) return ""
  try {
    return new Address(parts.kind, parts.author, parts.identifier, relays || []).toNaddr()
  } catch {
    return ""
  }
}

const getRootTag = (event: TrustedEvent) => {
  const tags = event.tags || []
  const explicitRoot = tags.find(tag => tag[0] === "E" || tag[0] === "A" || tag[0] === "I")
  if (explicitRoot) return explicitRoot
  const markedRoot = tags.find(
    tag => (tag[0] === "e" || tag[0] === "a" || tag[0] === "i") && tag[3] === "root",
  )
  if (markedRoot) return markedRoot
  const refs = tags.filter(tag => tag[0] === "e" || tag[0] === "a" || tag[0] === "i")
  if (refs.length === 1) return refs[0]
  return refs[0]
}

const hasParentReference = (event: TrustedEvent) => {
  const rootTag = getRootTag(event)
  if (!rootTag) return false
  return (event.tags || []).some(tag => {
    if (tag[0] !== "e" && tag[0] !== "a" && tag[0] !== "i") return false
    if (tag[3] === "root") return false
    return tag[1] !== rootTag[1]
  })
}

const getRootId = (event: TrustedEvent) => getRootTag(event)?.[1]

const getStatusRootId = (event: TrustedEvent) => {
  const rootTag = event.tags.find(tag => tag[0] === "e" && tag[3] === "root")
  return rootTag?.[1] || getTagValue("e", event.tags)
}

const isStatusKindAllowed = (kind: number, options: typeof defaultRepoWatchOptions) => {
  if (kind === GIT_STATUS_OPEN) return options.status.open
  if (kind === GIT_STATUS_DRAFT) return options.status.draft
  if (kind === GIT_STATUS_APPLIED) return options.status.applied
  if (kind === GIT_STATUS_CLOSED) return options.status.closed
  return false
}

const updateLatest = (map: Map<string, TrustedEvent>, repoAddr: string, event: TrustedEvent) => {
  const existing = map.get(repoAddr)
  if (!existing || event.created_at > existing.created_at) {
    map.set(repoAddr, event)
  }
}

const normalizeRelays = (relays: string[] | undefined) => {
  const out = new Set<string>()
  for (const relay of relays || []) {
    try {
      const normalized = normalizeRelayUrl(relay)
      if (isRelayUrl(normalized)) out.add(normalized)
    } catch {
      // ignore invalid
    }
  }
  return Array.from(out)
}

const repoRelaysByAddress = derived(repoAnnouncements, $events => {
  const map = new Map<string, string[]>()
  for (const event of ($events as RepoAnnouncementEvent[]) || []) {
    let address = ""
    try {
      address = Address.fromEvent(event).toString()
    } catch {
      continue
    }
    try {
      const parsed = parseRepoAnnouncementEvent(event)
      map.set(address, normalizeRelays(parsed.relays))
    } catch {
      map.set(address, [])
    }
  }
  return map
})

const listedRepoAddresses = derived(
  [pubkey, repoAnnouncementsByAddress, bookmarksStore],
  ([$pubkey, $repoAnnouncementsByAddress, $bookmarks]) => {
    const listedAddresses = new Set<string>()

    if ($pubkey) {
      for (const [address, event] of $repoAnnouncementsByAddress.entries()) {
        if (event.pubkey === $pubkey) {
          listedAddresses.add(address)
        }
      }
    }

    for (const bookmark of $bookmarks || []) {
      if (bookmark?.address) listedAddresses.add(bookmark.address)
    }

    return listedAddresses
  },
)

const watchedRepoRelays = derived(
  [userRepoWatchValues, repoRelaysByAddress],
  ([$watchValues, $relaysByAddress]) => {
    const relays = new Set<string>(GIT_RELAYS)
    for (const repoAddr of Object.keys($watchValues.repos || {})) {
      const repoRelays = $relaysByAddress.get(repoAddr) || []
      for (const relay of repoRelays) relays.add(relay)
    }
    return Array.from(relays)
  },
)

const issueEventsStore = deriveEventsAsc(
  deriveEventsById({repository, filters: [{kinds: [GIT_ISSUE]}]}),
)

const patchEventsStore = deriveEventsAsc(
  deriveEventsById({repository, filters: [{kinds: [GIT_PATCH, GIT_PULL_REQUEST]}]}),
)

const prUpdateEventsStore = deriveEventsAsc(
  deriveEventsById({repository, filters: [{kinds: [GIT_PULL_REQUEST_UPDATE]}]}),
)

const statusEventsStore = deriveEventsAsc(
  deriveEventsById({
    repository,
    filters: [{kinds: [GIT_STATUS_OPEN, GIT_STATUS_APPLIED, GIT_STATUS_CLOSED, GIT_STATUS_DRAFT]}],
  }),
)

const roleEventsStore = deriveEventsAsc(
  deriveEventsById({repository, filters: [{kinds: [GIT_LABEL]}]}),
)

const commentEventsStore = deriveEventsAsc(
  deriveEventsById({repository, filters: [{kinds: [GIT_COMMENT]}]}),
)

export const repoNotificationCandidates = derived(
  [
    pubkey,
    userRepoWatchValues,
    repoAnnouncementsByAddress,
    effectiveRepoAddressesByRepoAddress,
    issueEventsStore,
    patchEventsStore,
    prUpdateEventsStore,
    statusEventsStore,
    roleEventsStore,
    commentEventsStore,
  ],
  ([
    $pubkey,
    $watchValues,
    $repoAnnouncementsByAddress,
    $effectiveRepoAddressesByRepoAddress,
    $issueEvents,
    $patchEvents,
    $prUpdateEvents,
    $statusEvents,
    $roleEvents,
    $commentEvents,
  ]) => {
    if (!$pubkey) return []

    const watchedRepos = $watchValues.repos || {}
    const repoAddresses = Object.keys(watchedRepos)
    if (repoAddresses.length === 0) return []

    const repoByEffectiveAddress = new Map<string, string>()
    const allEffectiveAddresses = new Set<string>()
    for (const repoAddr of repoAddresses) {
      const effective =
        $effectiveRepoAddressesByRepoAddress.get(repoAddr) || new Set<string>([repoAddr])
      for (const address of effective) {
        allEffectiveAddresses.add(address)
        if (!repoByEffectiveAddress.has(address)) {
          repoByEffectiveAddress.set(address, repoAddr)
        }
      }
    }

    const issueEvents = ($issueEvents as TrustedEvent[]).filter(event =>
      allEffectiveAddresses.has(getTagValue("a", event.tags) || ""),
    )
    const patchEvents = ($patchEvents as TrustedEvent[]).filter(event =>
      allEffectiveAddresses.has(getTagValue("a", event.tags) || ""),
    )
    const prUpdateEvents = ($prUpdateEvents as TrustedEvent[]).filter(event =>
      allEffectiveAddresses.has(getTagValue("a", event.tags) || ""),
    )
    const statusEvents = ($statusEvents as TrustedEvent[]).filter(event =>
      allEffectiveAddresses.has(getTagValue("a", event.tags) || ""),
    )
    const roleEvents = ($roleEvents as TrustedEvent[]).filter(event => {
      const repoAddr = getTagValue("a", event.tags)
      const rootRepoAddr = repoAddr ? repoByEffectiveAddress.get(repoAddr) : undefined
      if (!rootRepoAddr) return false
      return event.tags.some(tag => tag[0] === "p" && tag[1] === $pubkey)
    })

    const rootMeta = new Map<string, {repoAddr: string; type: RootType}>()
    for (const event of issueEvents) {
      const repoAddr = getTagValue("a", event.tags)
      const rootRepoAddr = repoAddr ? repoByEffectiveAddress.get(repoAddr) : undefined
      if (rootRepoAddr) rootMeta.set(event.id, {repoAddr: rootRepoAddr, type: "issue"})
    }
    for (const event of patchEvents) {
      const repoAddr = getTagValue("a", event.tags)
      const rootRepoAddr = repoAddr ? repoByEffectiveAddress.get(repoAddr) : undefined
      if (rootRepoAddr) rootMeta.set(event.id, {repoAddr: rootRepoAddr, type: "patch"})
    }

    const wantsIssueComments = repoAddresses.some(addr => watchedRepos[addr]?.issues?.comments)
    const wantsPatchComments = repoAddresses.some(addr => watchedRepos[addr]?.patches?.comments)
    const rootIds = Array.from(rootMeta.keys())

    const commentEvents =
      rootIds.length > 0 && (wantsIssueComments || wantsPatchComments)
        ? ($commentEvents as TrustedEvent[]).filter(event => {
            const rootId = getRootId(event)
            return Boolean(rootId && rootMeta.has(rootId))
          })
        : []

    const latestIssueEvents = new Map<string, TrustedEvent>()
    const latestPatchEvents = new Map<string, TrustedEvent>()
    const latestIssueComments = new Map<string, TrustedEvent>()
    const latestPatchComments = new Map<string, TrustedEvent>()

    for (const event of issueEvents) {
      if (event.pubkey === $pubkey) continue
      const repoAddr = getTagValue("a", event.tags)
      const rootRepoAddr = repoAddr ? repoByEffectiveAddress.get(repoAddr) : undefined
      if (!rootRepoAddr) continue
      const options = watchedRepos[rootRepoAddr]
      if (!options?.issues?.new) continue
      updateLatest(latestIssueEvents, rootRepoAddr, event)
    }

    for (const event of patchEvents) {
      if (event.pubkey === $pubkey) continue
      const repoAddr = getTagValue("a", event.tags)
      const rootRepoAddr = repoAddr ? repoByEffectiveAddress.get(repoAddr) : undefined
      if (!rootRepoAddr) continue
      const options = watchedRepos[rootRepoAddr]
      if (!options?.patches?.new) continue
      updateLatest(latestPatchEvents, rootRepoAddr, event)
    }

    for (const event of prUpdateEvents) {
      if (event.pubkey === $pubkey) continue
      const repoAddr = getTagValue("a", event.tags)
      const rootRepoAddr = repoAddr ? repoByEffectiveAddress.get(repoAddr) : undefined
      if (!rootRepoAddr) continue
      const options = watchedRepos[rootRepoAddr]
      if (!options?.patches?.updates) continue
      updateLatest(latestPatchEvents, rootRepoAddr, event)
    }

    for (const event of commentEvents) {
      if (event.pubkey === $pubkey) continue
      if (hasParentReference(event)) continue
      const rootId = getRootId(event)
      if (!rootId) continue
      const root = rootMeta.get(rootId)
      if (!root) continue
      const options = watchedRepos[root.repoAddr]
      if (!options) continue
      if (root.type === "issue" && options.issues.comments) {
        updateLatest(latestIssueComments, root.repoAddr, event)
      }
      if (root.type === "patch" && options.patches.comments) {
        updateLatest(latestPatchComments, root.repoAddr, event)
      }
    }

    for (const event of statusEvents) {
      if (event.pubkey === $pubkey) continue
      const repoAddr = getTagValue("a", event.tags)
      const rootRepoAddr = repoAddr ? repoByEffectiveAddress.get(repoAddr) : undefined
      if (!rootRepoAddr) continue
      const options = watchedRepos[rootRepoAddr]
      if (!options) continue
      if (!isStatusKindAllowed(event.kind, options)) continue
      const rootId = getStatusRootId(event)
      if (!rootId) continue
      const root = rootMeta.get(rootId)
      if (!root) continue
      if (root.type === "issue") {
        updateLatest(latestIssueEvents, rootRepoAddr, event)
      } else {
        updateLatest(latestPatchEvents, rootRepoAddr, event)
      }
    }

    for (const event of roleEvents) {
      if (event.pubkey === $pubkey) continue
      const parsed = parseRoleLabelEvent(event as any)
      if (parsed.namespace !== "org.nostr.git.role") continue
      if (!parsed.rootId) continue
      const repoAddr = parsed.repoAddr || getTagValue("a", event.tags)
      const rootRepoAddr = repoAddr ? repoByEffectiveAddress.get(repoAddr) : undefined
      if (!rootRepoAddr) continue
      const options = watchedRepos[rootRepoAddr]
      if (!options) continue
      const isAssignee = parsed.role === "assignee"
      const isReviewer = parsed.role === "reviewer"
      if (isAssignee && !options.assignments) continue
      if (isReviewer && !options.reviews) continue
      if (!isAssignee && !isReviewer) continue
      const root = rootMeta.get(parsed.rootId)
      if (!root) continue
      if (root.type === "issue") {
        updateLatest(latestIssueEvents, rootRepoAddr, event)
      } else {
        updateLatest(latestPatchEvents, rootRepoAddr, event)
      }
    }

    const uiRelays = PLATFORM_RELAYS.length > 0 ? PLATFORM_RELAYS : GIT_RELAYS
    if (uiRelays.length === 0) return []

    const candidates: NotificationCandidate[] = []

    const addRepoCandidates = (repoAddr: string) => {
      const naddrCandidates = new Set<string>()
      const repoEvent = $repoAnnouncementsByAddress.get(repoAddr)
      if (repoEvent) {
        try {
          naddrCandidates.add(Address.fromEvent(repoEvent).toNaddr())
        } catch {
          // ignore
        }
      }
      const unhinted = toRepoNaddr(repoAddr)
      if (unhinted) naddrCandidates.add(unhinted)
      const hinted = toRepoNaddr(repoAddr, uiRelays)
      if (hinted) naddrCandidates.add(hinted)
      if (naddrCandidates.size === 0) return

      for (const naddr of naddrCandidates) {
        for (const relay of uiRelays) {
          const base = makeGitPath(relay, naddr)
          const issueEvent = latestIssueEvents.get(repoAddr)
          const issueCommentEvent = latestIssueComments.get(repoAddr)
          const patchEvent = latestPatchEvents.get(repoAddr)
          const patchCommentEvent = latestPatchComments.get(repoAddr)
          if (issueEvent) {
            candidates.push({path: `${base}/issues`, latestEvent: issueEvent})
          }
          if (issueCommentEvent) {
            candidates.push({path: `${base}/issues`, latestEvent: issueCommentEvent})
          }
          if (patchEvent) {
            candidates.push({path: `${base}/patches`, latestEvent: patchEvent})
          }
          if (patchCommentEvent) {
            candidates.push({path: `${base}/patches`, latestEvent: patchCommentEvent})
          }
        }
      }
    }

    for (const repoAddr of new Set([
      ...latestIssueEvents.keys(),
      ...latestPatchEvents.keys(),
      ...latestIssueComments.keys(),
      ...latestPatchComments.keys(),
    ])) {
      addRepoCandidates(repoAddr)
    }

    return candidates
  },
)

const repoCommentRoots = derived(
  [userRepoWatchValues, issueEventsStore, patchEventsStore, effectiveRepoAddressesByRepoAddress],
  ([$watchValues, $issueEvents, $patchEvents, $effectiveRepoAddressesByRepoAddress]) => {
    const watchedRepos = $watchValues.repos || {}
    const repoAddresses = Object.keys(watchedRepos)
    if (repoAddresses.length === 0) return []

    const repoByEffectiveAddress = new Map<string, string>()
    for (const repoAddr of repoAddresses) {
      const effective =
        $effectiveRepoAddressesByRepoAddress.get(repoAddr) || new Set<string>([repoAddr])
      for (const address of effective) {
        if (!repoByEffectiveAddress.has(address)) {
          repoByEffectiveAddress.set(address, repoAddr)
        }
      }
    }

    const rootIds = new Set<string>()

    for (const event of $issueEvents as TrustedEvent[]) {
      const repoAddr = getTagValue("a", event.tags)
      const rootRepoAddr = repoAddr ? repoByEffectiveAddress.get(repoAddr) : undefined
      if (!rootRepoAddr) continue
      if (!watchedRepos[rootRepoAddr]?.issues?.comments) continue
      rootIds.add(event.id)
    }

    for (const event of $patchEvents as TrustedEvent[]) {
      const repoAddr = getTagValue("a", event.tags)
      const rootRepoAddr = repoAddr ? repoByEffectiveAddress.get(repoAddr) : undefined
      if (!rootRepoAddr) continue
      if (!watchedRepos[rootRepoAddr]?.patches?.comments) continue
      rootIds.add(event.id)
    }

    return Array.from(rootIds)
  },
)

export const setupBudabitNotifications = () => {
  const augmentPaths = (paths: Set<string>) => {
    if (PLATFORM_RELAYS.length === 0) return paths
    const listedAddresses = get(listedRepoAddresses)
    if (listedAddresses.size === 0) return paths

    for (const path of Array.from(paths)) {
      const parts = path.split("/")
      if (parts.length < 5) continue
      if (parts[1] !== "spaces" || parts[3] !== "git") continue
      const naddr = parts[4]
      let isListed = false
      try {
        const address = Address.fromNaddr(naddr).toString()
        isListed = listedAddresses.has(address)
      } catch {
        isListed = false
      }
      if (!isListed) continue
      const relayPart = parts[2]
      if (!relayPart) continue
      paths.add(`/spaces/${relayPart}/git`)
    }

    return paths
  }

  const setConfig = () =>
    setNotificationsConfig({
      getSpaceUrls: groupList =>
        PLATFORM_RELAYS.length > 0 ? PLATFORM_RELAYS : getSpaceUrlsFromGroupList(groupList),
      augmentPaths,
    })

  setConfig()

  setNotificationCandidates(
    repoNotificationCandidates as unknown as Readable<NotificationCandidate[]>,
  )

  let lastKey = ""
  const liveControllers = new Map<string, AbortController>()
  const clearLiveControllers = () => {
    for (const controller of liveControllers.values()) {
      controller.abort()
    }
    liveControllers.clear()
  }

  const maintainerAnnouncementLoads = new Set<string>()
  const repoAnnouncementLoads = new Set<string>()

  const rebuildRepoSubscriptions = () => {
    const values = get(userRepoWatchValues)
    const repoAddresses = Object.keys(values.repos || {})
    if (repoAddresses.length === 0) {
      clearLiveControllers()
      lastKey = ""
      return
    }

    const effectiveByRepo = get(effectiveRepoAddressesByRepoAddress)
    const key = repoAddresses
      .map(repoAddr => {
        const effective = effectiveByRepo.get(repoAddr) || new Set<string>([repoAddr])
        return `${repoAddr}::${Array.from(effective).sort().join(",")}`
      })
      .sort()
      .join("|")
    if (key === lastKey) return
    lastKey = key

    clearLiveControllers()

    const relaysByAddress = get(repoRelaysByAddress)
    const announcementsByAddress = get(repoAnnouncementsByAddress)

    for (const repoAddr of repoAddresses) {
      if (!repoAnnouncementLoads.has(repoAddr)) {
        repoAnnouncementLoads.add(repoAddr)
        loadRepoAnnouncementByAddress(repoAddr)
      }
      const repoEvent = announcementsByAddress.get(repoAddr)
      if (repoEvent) {
        const maintainerKey = `${repoAddr}:${repoEvent.id}`
        if (!maintainerAnnouncementLoads.has(maintainerKey)) {
          maintainerAnnouncementLoads.add(maintainerKey)
          loadRepoMaintainerAnnouncements(repoEvent)
        }
      }

      const repoRelays = relaysByAddress.get(repoAddr) || []
      const relays = Array.from(new Set([...GIT_RELAYS, ...repoRelays]))
      const relayArgs = relays.length > 0 ? relays : undefined

      const effective = effectiveByRepo.get(repoAddr) || new Set<string>([repoAddr])
      for (const effectiveAddr of effective) {
        loadRepoContext({addressA: effectiveAddr, relays: relayArgs})
      }

      const controller = new AbortController()
      liveControllers.set(repoAddr, controller)

      const filters: any[] = []
      for (const effectiveAddr of effective) {
        const {filters: addressFilters} = RepoCore.buildRepoSubscriptions({addressA: effectiveAddr})
        filters.push(...addressFilters)
      }

      if (filters.length === 0) continue
      const since = now() - 600
      const liveFilters = filters.map(filter => ({...filter, since}))
      request({
        relays: relayArgs || GIT_RELAYS,
        filters: liveFilters,
        signal: controller.signal,
      })
    }
  }

  const unsubscribeWatch = userRepoWatchValues.subscribe(rebuildRepoSubscriptions)
  const unsubscribeEffective =
    effectiveRepoAddressesByRepoAddress.subscribe(rebuildRepoSubscriptions)

  let lastCommentsKey = ""
  let commentsController: AbortController | undefined
  const unsubscribeComments = repoCommentRoots.subscribe(rootIds => {
    const key = rootIds.sort().join(",")
    if (key === lastCommentsKey) return
    lastCommentsKey = key
    commentsController?.abort()
    commentsController = undefined
    if (rootIds.length === 0) return
    const relays = get(watchedRepoRelays)
    if (relays.length === 0) return
    const filters: any[] = [
      {kinds: [GIT_COMMENT], "#E": rootIds},
      {kinds: [GIT_COMMENT], "#e": rootIds},
    ]
    load({relays, filters})

    const controller = new AbortController()
    commentsController = controller
    const since = now() - 600
    const liveFilters = filters.map(filter => ({...filter, since}))
    request({
      relays,
      filters: liveFilters,
      signal: controller.signal,
      onEvent: event => {
        if (!repository.getEvent(event.id)) {
          repository.load([event as TrustedEvent])
        }
      },
    })
  })

  const unsubscribeListed = listedRepoAddresses.subscribe(() => {
    setConfig()
  })

  return () => {
    unsubscribeWatch()
    unsubscribeEffective()
    unsubscribeComments()
    unsubscribeListed()
    commentsController?.abort()
    clearLiveControllers()
  }
}
