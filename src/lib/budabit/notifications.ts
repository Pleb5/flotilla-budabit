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
import {load} from "@welshman/net"
import {
  Address,
  getTagValue,
  isRelayUrl,
  normalizeRelayUrl,
  type TrustedEvent,
} from "@welshman/util"
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
import {GIT_RELAYS, loadRepoContext, repoAnnouncements} from "@lib/budabit/state"
import {defaultRepoWatchOptions, userRepoWatchValues} from "@lib/budabit/repo-watch"

type RootType = "issue" | "patch"

const getRepoAddressParts = (repoAddr: string) => {
  const [kind, author, identifier] = repoAddr.split(":")
  if (!kind || !author || !identifier) return null
  const kindNumber = Number.parseInt(kind, 10)
  if (Number.isNaN(kindNumber)) return null
  return {kind: kindNumber, author, identifier}
}

const toRepoNaddr = (repoAddr: string, relays: string[]) => {
  const parts = getRepoAddressParts(repoAddr)
  if (!parts) return ""
  try {
    return new Address(parts.kind, parts.author, parts.identifier, relays).toNaddr()
  } catch {
    return ""
  }
}

const hasParentReference = (event: TrustedEvent) =>
  event.tags.some(tag => tag[0] === "e" || tag[0] === "a" || tag[0] === "i")

const getRootId = (event: TrustedEvent) =>
  getTagValue("E", event.tags) || getTagValue("e", event.tags)

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

    const issueEvents = ($issueEvents as TrustedEvent[]).filter(event =>
      repoAddresses.includes(getTagValue("a", event.tags) || ""),
    )
    const patchEvents = ($patchEvents as TrustedEvent[]).filter(event =>
      repoAddresses.includes(getTagValue("a", event.tags) || ""),
    )
    const prUpdateEvents = ($prUpdateEvents as TrustedEvent[]).filter(event =>
      repoAddresses.includes(getTagValue("a", event.tags) || ""),
    )
    const statusEvents = ($statusEvents as TrustedEvent[]).filter(event =>
      repoAddresses.includes(getTagValue("a", event.tags) || ""),
    )
    const roleEvents = ($roleEvents as TrustedEvent[]).filter(event => {
      const repoAddr = getTagValue("a", event.tags)
      if (!repoAddr || !repoAddresses.includes(repoAddr)) return false
      return event.tags.some(tag => tag[0] === "p" && tag[1] === $pubkey)
    })

    const rootMeta = new Map<string, {repoAddr: string; type: RootType}>()
    for (const event of issueEvents) {
      const repoAddr = getTagValue("a", event.tags)
      if (repoAddr) rootMeta.set(event.id, {repoAddr, type: "issue"})
    }
    for (const event of patchEvents) {
      const repoAddr = getTagValue("a", event.tags)
      if (repoAddr) rootMeta.set(event.id, {repoAddr, type: "patch"})
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

    const latestIssues = new Map<string, TrustedEvent>()
    const latestPatches = new Map<string, TrustedEvent>()

    for (const event of issueEvents) {
      const repoAddr = getTagValue("a", event.tags)
      if (!repoAddr) continue
      const options = watchedRepos[repoAddr]
      if (!options?.issues?.new) continue
      updateLatest(latestIssues, repoAddr, event)
    }

    for (const event of patchEvents) {
      const repoAddr = getTagValue("a", event.tags)
      if (!repoAddr) continue
      const options = watchedRepos[repoAddr]
      if (!options?.patches?.new) continue
      updateLatest(latestPatches, repoAddr, event)
    }

    for (const event of prUpdateEvents) {
      const repoAddr = getTagValue("a", event.tags)
      if (!repoAddr) continue
      const options = watchedRepos[repoAddr]
      if (!options?.patches?.updates) continue
      updateLatest(latestPatches, repoAddr, event)
    }

    for (const event of commentEvents) {
      if (hasParentReference(event)) continue
      const rootId = getRootId(event)
      if (!rootId) continue
      const root = rootMeta.get(rootId)
      if (!root) continue
      const options = watchedRepos[root.repoAddr]
      if (!options) continue
      if (root.type === "issue" && options.issues.comments) {
        updateLatest(latestIssues, root.repoAddr, event)
      }
      if (root.type === "patch" && options.patches.comments) {
        updateLatest(latestPatches, root.repoAddr, event)
      }
    }

    for (const event of statusEvents) {
      const repoAddr = getTagValue("a", event.tags)
      if (!repoAddr) continue
      const options = watchedRepos[repoAddr]
      if (!options) continue
      if (!isStatusKindAllowed(event.kind, options)) continue
      const rootId = getStatusRootId(event)
      if (!rootId) continue
      const root = rootMeta.get(rootId)
      if (!root) continue
      if (root.type === "issue") {
        updateLatest(latestIssues, repoAddr, event)
      } else {
        updateLatest(latestPatches, repoAddr, event)
      }
    }

    for (const event of roleEvents) {
      const parsed = parseRoleLabelEvent(event as any)
      if (parsed.namespace !== "org.nostr.git.role") continue
      if (!parsed.rootId) continue
      const repoAddr = parsed.repoAddr || getTagValue("a", event.tags)
      if (!repoAddr) continue
      const options = watchedRepos[repoAddr]
      if (!options) continue
      const isAssignee = parsed.role === "assignee"
      const isReviewer = parsed.role === "reviewer"
      if (isAssignee && !options.assignments) continue
      if (isReviewer && !options.reviews) continue
      if (!isAssignee && !isReviewer) continue
      const root = rootMeta.get(parsed.rootId)
      if (!root) continue
      if (root.type === "issue") {
        updateLatest(latestIssues, repoAddr, event)
      } else {
        updateLatest(latestPatches, repoAddr, event)
      }
    }

    const uiRelays = PLATFORM_RELAYS.length > 0 ? PLATFORM_RELAYS : GIT_RELAYS
    if (uiRelays.length === 0) return []

    const candidates: NotificationCandidate[] = []

    const addRepoCandidates = (repoAddr: string) => {
      const naddr = toRepoNaddr(repoAddr, uiRelays)
      if (!naddr) return
      for (const relay of uiRelays) {
        const base = makeGitPath(relay, naddr)
        const issueEvent = latestIssues.get(repoAddr)
        const patchEvent = latestPatches.get(repoAddr)
        if (issueEvent) {
          candidates.push({path: `${base}/issues`, latestEvent: issueEvent})
        }
        if (patchEvent) {
          candidates.push({path: `${base}/patches`, latestEvent: patchEvent})
        }
      }
    }

    for (const repoAddr of new Set([...latestIssues.keys(), ...latestPatches.keys()])) {
      addRepoCandidates(repoAddr)
    }

    return candidates
  },
)

const repoCommentRoots = derived(
  [userRepoWatchValues, issueEventsStore, patchEventsStore],
  ([$watchValues, $issueEvents, $patchEvents]) => {
    const watchedRepos = $watchValues.repos || {}
    const rootIds = new Set<string>()

    for (const event of $issueEvents as TrustedEvent[]) {
      const repoAddr = getTagValue("a", event.tags)
      if (!repoAddr) continue
      if (!watchedRepos[repoAddr]?.issues?.comments) continue
      rootIds.add(event.id)
    }

    for (const event of $patchEvents as TrustedEvent[]) {
      const repoAddr = getTagValue("a", event.tags)
      if (!repoAddr) continue
      if (!watchedRepos[repoAddr]?.patches?.comments) continue
      rootIds.add(event.id)
    }

    return Array.from(rootIds)
  },
)

export const setupBudabitNotifications = () => {
  setNotificationsConfig({
    getSpaceUrls: groupList =>
      PLATFORM_RELAYS.length > 0 ? PLATFORM_RELAYS : getSpaceUrlsFromGroupList(groupList),
    augmentPaths: paths => {
      if (PLATFORM_RELAYS.length === 0) return paths
      for (const url of PLATFORM_RELAYS) {
        const gitPath = makeSpacePath(url, "git")
        const hasRepoNotifications = Array.from(paths).some(path => path.startsWith(`${gitPath}/`))
        if (hasRepoNotifications) {
          paths.add(gitPath)
        }
      }
      return paths
    },
  })

  setNotificationCandidates(
    repoNotificationCandidates as unknown as Readable<NotificationCandidate[]>,
  )

  let lastKey = ""
  const unsubscribe = userRepoWatchValues.subscribe(values => {
    const repoAddresses = Object.keys(values.repos || {})
    const key = repoAddresses.sort().join(",")
    if (key === lastKey) return
    lastKey = key
    if (repoAddresses.length === 0) return
    const relaysByAddress = get(repoRelaysByAddress)
    for (const repoAddr of repoAddresses) {
      const repoRelays = relaysByAddress.get(repoAddr) || []
      const relays = Array.from(new Set([...GIT_RELAYS, ...repoRelays]))
      const relayArgs = relays.length > 0 ? relays : undefined
      loadRepoContext({addressA: repoAddr, relays: relayArgs})
    }
  })

  let lastCommentsKey = ""
  const unsubscribeComments = repoCommentRoots.subscribe(rootIds => {
    const key = rootIds.sort().join(",")
    if (key === lastCommentsKey) return
    lastCommentsKey = key
    if (rootIds.length === 0) return
    const relays = get(watchedRepoRelays)
    if (relays.length === 0) return
    const filters: any[] = [
      {kinds: [GIT_COMMENT], "#E": rootIds},
      {kinds: [GIT_COMMENT], "#e": rootIds},
    ]
    load({relays, filters})
  })

  return () => {
    unsubscribe()
    unsubscribeComments()
  }
}
