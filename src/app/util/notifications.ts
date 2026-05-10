import {derived, get, readable, writable, type Readable} from "svelte/store"
import {
  deriveEventsAsc,
  deriveEventsById,
  deriveEventsByIdByUrl,
  synced,
  throttled,
} from "@welshman/store"
import {pubkey, tracker, repository, relaysByUrl} from "@welshman/app"
import {prop, find, call, spec, first, identity, now, groupBy} from "@welshman/lib"
import type {List, TrustedEvent} from "@welshman/util"
import {
  ZAP_GOAL,
  EVENT_TIME,
  MESSAGE,
  THREAD,
  COMMENT,
  getTagValue,
  Address,
  isRelayUrl,
  normalizeRelayUrl,
} from "@welshman/util"
import {load, request} from "@welshman/net"
import {Router} from "@welshman/router"
import {RepoCore} from "@nostr-git/core/git"
import {
  GIT_COMMENT,
  GIT_ISSUE,
  GIT_LABEL,
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
import {buildRepoNaddrFromEvent} from "@nostr-git/core/utils"
import {
  makeSpacePath,
  makeChatPath,
  makeGoalPath,
  makeThreadPath,
  makeCalendarPath,
  makeSpaceChatPath,
  makeRoomPath,
  makeGitPath,
} from "@app/util/routes"
import {
  chatsById,
  hasNip29,
  PLATFORM_RELAYS,
  userSettingsValues,
  userGroupList,
  getSpaceUrlsFromGroupList,
  getSpaceRoomsFromGroupList,
  encodeRelay,
  roomsById,
} from "@app/core/state"
import {kv} from "@app/core/storage"
import {
  channelsById,
  GIT_RELAYS,
  getMaintainerSetRepoAddresses,
  loadRepoContext,
  repoAnnouncements,
  repoAnnouncementsByAddress,
  maintainerSetRepoAddressesByRepoAddress,
  loadRepoAnnouncementByAddress,
  loadRepoMaintainerAnnouncements,
} from "@lib/budabit/state"
import {defaultRepoWatchOptions, userRepoWatchValues} from "@lib/budabit/repo-watch"
import {isArchivedRoomReference} from "@app/util/room-archive"

// Checked state

export const checked = synced<Record<string, number>>({
  key: "checked",
  defaultValue: {},
  storage: kv,
})

export const deriveChecked = (key: string) => derived(checked, prop(key))

export const setChecked = (key: string) => checked.update(state => ({...state, [key]: now()}))

export const setCheckedAt = (key: string, timestamp: number) =>
  checked.update(state => ({...state, [key]: timestamp}))

export type NotificationCandidate = {
  path: string
  latestEvent?: TrustedEvent
}

export type NotificationsConfig = {
  getSpaceUrls?: (groupList: List | undefined) => string[]
  augmentPaths?: (paths: Set<string>) => Set<string> | void
}

const notificationCandidatesStore = writable<Readable<NotificationCandidate[]>>(
  readable<NotificationCandidate[]>([]),
)

export const notificationsConfig = writable<NotificationsConfig>({})

export const setNotificationCandidates = (store: Readable<NotificationCandidate[]>) =>
  notificationCandidatesStore.set(store)

export const setNotificationsConfig = (config: NotificationsConfig) =>
  notificationsConfig.set(config)

const extraCandidates = derived(notificationCandidatesStore, ($store, set) => {
  const unsubscribe = $store.subscribe(set)
  return () => unsubscribe()
}) as Readable<NotificationCandidate[]>

// Derived notifications state

const getLatestIncomingEvent = (events: TrustedEvent[], selfPubkey: string | undefined) => {
  if (!events || events.length === 0 || !selfPubkey) return undefined
  let latest: TrustedEvent | undefined
  for (const event of events) {
    if (event.pubkey === selfPubkey) continue
    if (!latest || event.created_at > latest.created_at) {
      latest = event
    }
  }
  return latest
}

export const notifications = call(() => {
  const normalizeChecked = (value: number) =>
    value > 10_000_000_000 ? Math.round(value / 1000) : value
  const goalCommentFilters = [{kinds: [COMMENT], "#K": [String(ZAP_GOAL)]}]
  const threadCommentFilters = [{kinds: [COMMENT], "#K": [String(THREAD)]}]
  const calendarCommentFilters = [{kinds: [COMMENT], "#K": [String(EVENT_TIME)]}]
  const messageFilters = [{kinds: [MESSAGE, THREAD, ZAP_GOAL, EVENT_TIME]}]

  return derived(
    throttled(
      1000,
      derived(
        [
          pubkey,
          checked,
          chatsById,
          userGroupList,
          relaysByUrl,
          roomsById,
          channelsById,
          deriveEventsByIdByUrl({tracker, repository, filters: goalCommentFilters}),
          deriveEventsByIdByUrl({tracker, repository, filters: threadCommentFilters}),
          deriveEventsByIdByUrl({tracker, repository, filters: calendarCommentFilters}),
          deriveEventsByIdByUrl({tracker, repository, filters: messageFilters}),
          notificationsConfig,
          extraCandidates,
        ],
        identity,
      ),
    ),
    ([
      $pubkey,
      $checked,
      $chatsById,
      $userGroupList,
      $relaysByUrl,
      $roomsById,
      $channelsById,
      goalCommentsByUrl,
      threadCommentsByUrl,
      calendarCommentsByUrl,
      messagesByUrl,
      $notificationsConfig,
      $extraCandidates,
    ]) => {
      const hasNotification = (path: string, latestEvent: TrustedEvent | undefined) => {
        if (!latestEvent) {
          return false
        }
        if (latestEvent.pubkey === $pubkey) {
          return false
        }

        let suppressedBy: {entryPath: string; checkedAt: number; normalized: number} | undefined
        for (const [entryPath, ts] of Object.entries($checked)) {
          if (entryPath.endsWith(":seen")) continue
          const isMatch =
            entryPath === "*" ||
            entryPath.startsWith(path) ||
            (entryPath === "/chat/*" && path.startsWith("/chat/"))

          if (isMatch) {
            const normalized = normalizeChecked(ts)
            if (normalized >= latestEvent.created_at) {
              suppressedBy = {entryPath, checkedAt: ts, normalized}
              break
            }
          }
        }

        if (suppressedBy) {
          return false
        }
        return true
      }

      const paths = new Set<string>()

      const getSpaceUrls =
        $notificationsConfig.getSpaceUrls ||
        ((groupList: List | undefined) => getSpaceUrlsFromGroupList(groupList))

      for (const {id, messages} of $chatsById.values()) {
        const chatPath = makeChatPath(id)
        const latestMessage = getLatestIncomingEvent(messages, $pubkey)

        const shouldNotify = hasNotification(chatPath, latestMessage)

        if (shouldNotify) {
          paths.add("/chat")
          paths.add(chatPath)
        }
      }

      for (const url of getSpaceUrls($userGroupList)) {
        const spacePath = makeSpacePath(url)
        const spacePathMobile = spacePath + ":mobile"
        const goalPath = makeGoalPath(url)
        const threadPath = makeThreadPath(url)
        const calendarPath = makeCalendarPath(url)
        const messagesPath = makeSpaceChatPath(url)
        const goalComments = goalCommentsByUrl.get(url)?.values() || []
        const threadComments = threadCommentsByUrl.get(url)?.values() || []
        const calendarComments = calendarCommentsByUrl.get(url)?.values() || []
        const messages = messagesByUrl.get(url)?.values() || []

        const commentsByGoalId = groupBy(
          e => getTagValue("E", e.tags),
          goalComments.filter(spec({kind: COMMENT})),
        )

        for (const [goalId, [comment]] of commentsByGoalId.entries()) {
          const goalItemPath = makeGoalPath(url, goalId)

          if (hasNotification(goalPath, comment as TrustedEvent)) {
            paths.add(spacePathMobile)
            paths.add(goalPath)
          }

          if (hasNotification(goalItemPath, comment as TrustedEvent)) {
            paths.add(goalItemPath)
          }
        }

        const commentsByThreadId = groupBy(
          (e: TrustedEvent) => getTagValue("E", e.tags),
          threadComments.filter(spec({kind: COMMENT})),
        )

        for (const [threadId, [comment]] of commentsByThreadId.entries()) {
          const threadItemPath = makeThreadPath(url, threadId)

          if (hasNotification(threadPath, comment)) {
            paths.add(spacePathMobile)
            paths.add(threadPath)
          }

          if (hasNotification(threadItemPath, comment)) {
            paths.add(threadItemPath)
          }
        }

        const commentsByEventId = groupBy(
          e => getTagValue("E", e.tags),
          calendarComments.filter(spec({kind: COMMENT})),
        )

        for (const [eventId, [comment]] of commentsByEventId.entries()) {
          const calendarItemPath = makeCalendarPath(url, eventId)

          if (hasNotification(calendarPath, comment)) {
            paths.add(spacePathMobile)
            paths.add(calendarPath)
          }

          if (hasNotification(calendarItemPath, comment)) {
            paths.add(calendarItemPath)
          }
        }

        if (hasNip29($relaysByUrl.get(url))) {
          for (const h of getSpaceRoomsFromGroupList(url, $userGroupList)) {
            if (
              isArchivedRoomReference({url, h, roomsById: $roomsById, channelsById: $channelsById})
            ) {
              continue
            }

            const roomPath = makeRoomPath(url, h)
            const latestEvent = find((e: TrustedEvent) => e.tags.some(spec(["h", h])), messages)

            if (hasNotification(roomPath, latestEvent)) {
              paths.add(spacePathMobile)
              paths.add(spacePath)
              paths.add(roomPath)
            }
          }
        } else {
          if (hasNotification(messagesPath, first(messages))) {
            paths.add(spacePathMobile)
            paths.add(spacePath)
            paths.add(messagesPath)
          }
        }
      }

      for (const candidate of $extraCandidates || []) {
        if (hasNotification(candidate.path, candidate.latestEvent)) {
          paths.add(candidate.path)
        }
      }

      if ($notificationsConfig.augmentPaths) {
        const augmented = $notificationsConfig.augmentPaths(paths)
        return augmented || paths
      }

      return paths
    },
  )
})

export const badgeCount = derived(notifications, notifications => {
  return notifications.size
})

export const handleBadgeCountChanges = async (count: number) => {
  if (get(userSettingsValues).show_notifications_badge) {
    try {
      if ("setAppBadge" in navigator) {
        await (
          navigator as Navigator & {setAppBadge: (count?: number) => Promise<void>}
        ).setAppBadge(count)
      }
    } catch (err) {
      // failed to set badge
    }
  } else {
    await clearBadges()
  }
}

export const clearBadges = async () => {
  try {
    if ("clearAppBadge" in navigator) {
      await (navigator as Navigator & {clearAppBadge: () => Promise<void>}).clearAppBadge()
    }
  } catch {
    // pass
  }
}

type RootType = "issue" | "pr"

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

const getUserOutboxRelays = () => {
  try {
    return Router.get().FromUser().getUrls() || []
  } catch {
    return []
  }
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
    const relays = new Set<string>()
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

const prEventsStore = deriveEventsAsc(
  deriveEventsById({repository, filters: [{kinds: [GIT_PULL_REQUEST]}]}),
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
    maintainerSetRepoAddressesByRepoAddress,
    issueEventsStore,
    prEventsStore,
    prUpdateEventsStore,
    statusEventsStore,
    roleEventsStore,
    commentEventsStore,
  ],
  ([
    $pubkey,
    $watchValues,
    $repoAnnouncementsByAddress,
    $maintainerSetRepoAddressesByRepoAddress,
    $issueEvents,
    $prEvents,
    $prUpdateEvents,
    $statusEvents,
    $roleEvents,
    $commentEvents,
  ]) => {
    if (!$pubkey) return []

    const watchedRepos = $watchValues.repos || {}
    const repoAddresses = Object.keys(watchedRepos)
    if (repoAddresses.length === 0) return []

    const watchedRepoByKindIdentifier = new Map<string, string | null>()
    for (const repoAddr of repoAddresses) {
      const parts = getRepoAddressParts(repoAddr)
      if (!parts) continue
      const key = `${parts.kind}:${parts.identifier}`
      const existing = watchedRepoByKindIdentifier.get(key)
      if (!existing) {
        watchedRepoByKindIdentifier.set(key, repoAddr)
      } else if (existing !== repoAddr) {
        watchedRepoByKindIdentifier.set(key, null)
      }
    }

    const repoByEffectiveAddress = new Map<string, string>()
    const allEffectiveAddresses = new Set<string>()
    for (const repoAddr of repoAddresses) {
      const effective = getMaintainerSetRepoAddresses(
        $maintainerSetRepoAddressesByRepoAddress,
        repoAddr,
      )
      for (const address of effective) {
        allEffectiveAddresses.add(address)
        if (!repoByEffectiveAddress.has(address)) {
          repoByEffectiveAddress.set(address, repoAddr)
        }
      }
    }

    const resolveRootRepoAddr = (event: TrustedEvent): string | undefined => {
      const repoAddr = getTagValue("a", event.tags)
      if (!repoAddr) return undefined

      const mapped = repoByEffectiveAddress.get(repoAddr)
      if (mapped) return mapped

      if (!$pubkey) return undefined
      const isMentioned = event.tags.some(tag => tag[0] === "p" && tag[1] === $pubkey)
      if (!isMentioned) return undefined

      const parts = getRepoAddressParts(repoAddr)
      if (!parts) return undefined
      const key = `${parts.kind}:${parts.identifier}`
      const fallback = watchedRepoByKindIdentifier.get(key)
      return fallback || undefined
    }

    const issueEvents = ($issueEvents as TrustedEvent[]).filter(event =>
      Boolean(resolveRootRepoAddr(event)),
    )
    const prEvents = ($prEvents as TrustedEvent[]).filter(event =>
      Boolean(resolveRootRepoAddr(event)),
    )
    const prUpdateEvents = ($prUpdateEvents as TrustedEvent[]).filter(event =>
      Boolean(resolveRootRepoAddr(event)),
    )
    const statusEvents = ($statusEvents as TrustedEvent[]).filter(event =>
      Boolean(resolveRootRepoAddr(event)),
    )
    const roleEvents = ($roleEvents as TrustedEvent[]).filter(event => {
      const repoAddr = getTagValue("a", event.tags)
      const rootRepoAddr = repoAddr ? repoByEffectiveAddress.get(repoAddr) : undefined
      if (!rootRepoAddr) return false
      return event.tags.some(tag => tag[0] === "p" && tag[1] === $pubkey)
    })

    const rootMeta = new Map<string, {repoAddr: string; type: RootType}>()
    for (const event of issueEvents) {
      const rootRepoAddr = resolveRootRepoAddr(event)
      if (rootRepoAddr) rootMeta.set(event.id, {repoAddr: rootRepoAddr, type: "issue"})
    }
    for (const event of prEvents) {
      const rootRepoAddr = resolveRootRepoAddr(event)
      if (rootRepoAddr) rootMeta.set(event.id, {repoAddr: rootRepoAddr, type: "pr"})
    }

    const wantsIssueComments = repoAddresses.some(addr => watchedRepos[addr]?.issues?.comments)
    const wantsPrComments = repoAddresses.some(addr => watchedRepos[addr]?.prs?.comments)
    const rootIds = Array.from(rootMeta.keys())

    const commentEvents =
      rootIds.length > 0 && (wantsIssueComments || wantsPrComments)
        ? ($commentEvents as TrustedEvent[]).filter(event => {
            const rootId = getRootId(event)
            return Boolean(rootId && rootMeta.has(rootId))
          })
        : []

    const latestIssueEvents = new Map<string, TrustedEvent>()
    const latestPrEvents = new Map<string, TrustedEvent>()
    const latestIssueComments = new Map<string, TrustedEvent>()
    const latestPrComments = new Map<string, TrustedEvent>()

    for (const event of issueEvents) {
      if (event.pubkey === $pubkey) continue
      const rootRepoAddr = resolveRootRepoAddr(event)
      if (!rootRepoAddr) continue
      const options = watchedRepos[rootRepoAddr]
      if (!options?.issues?.new) continue
      updateLatest(latestIssueEvents, rootRepoAddr, event)
    }

    for (const event of prEvents) {
      if (event.pubkey === $pubkey) continue
      const rootRepoAddr = resolveRootRepoAddr(event)
      if (!rootRepoAddr) continue
      const options = watchedRepos[rootRepoAddr]
      if (!options?.prs?.new) continue
      updateLatest(latestPrEvents, rootRepoAddr, event)
    }

    for (const event of prUpdateEvents) {
      if (event.pubkey === $pubkey) continue
      const rootRepoAddr = resolveRootRepoAddr(event)
      if (!rootRepoAddr) continue
      const options = watchedRepos[rootRepoAddr]
      if (!options?.prs?.updates) continue
      updateLatest(latestPrEvents, rootRepoAddr, event)
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
      if (root.type === "pr" && options.prs.comments) {
        updateLatest(latestPrComments, root.repoAddr, event)
      }
    }

    for (const event of statusEvents) {
      if (event.pubkey === $pubkey) continue
      const rootRepoAddr = resolveRootRepoAddr(event)
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
        updateLatest(latestPrEvents, rootRepoAddr, event)
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
        updateLatest(latestPrEvents, rootRepoAddr, event)
      }
    }

    const uiRelays = PLATFORM_RELAYS.length > 0 ? PLATFORM_RELAYS : GIT_RELAYS
    if (uiRelays.length === 0) return []

    const candidates: NotificationCandidate[] = []

    const addRepoCandidates = (repoAddr: string) => {
      const naddrCandidates = new Set<string>()
      const repoEvent = $repoAnnouncementsByAddress.get(repoAddr)
      let hasPolicyNaddr = false
      if (repoEvent) {
        try {
          const parsed = parseRepoAnnouncementEvent(repoEvent)
          const repoNaddr = buildRepoNaddrFromEvent({
            event: repoEvent,
            fallbackPubkey: repoEvent.pubkey,
            fallbackRepoRelays: parsed.relays || [],
            userOutboxRelays: getUserOutboxRelays(),
            gitRelays: GIT_RELAYS,
          })
          if (repoNaddr) {
            naddrCandidates.add(repoNaddr)
            hasPolicyNaddr = true
          }
        } catch {
          // ignore
        }
      }
      if (!hasPolicyNaddr) {
        const unhinted = toRepoNaddr(repoAddr)
        if (unhinted) naddrCandidates.add(unhinted)
        const hinted = toRepoNaddr(repoAddr, uiRelays)
        if (hinted) naddrCandidates.add(hinted)
      }
      if (naddrCandidates.size === 0) return

      for (const naddr of naddrCandidates) {
        for (const relay of uiRelays) {
          const base = makeGitPath(relay, naddr)
          const issueEvent = latestIssueEvents.get(repoAddr)
          const issueCommentEvent = latestIssueComments.get(repoAddr)
          const prEvent = latestPrEvents.get(repoAddr)
          const prCommentEvent = latestPrComments.get(repoAddr)
          if (issueEvent) {
            candidates.push({path: `${base}/issues`, latestEvent: issueEvent})
          }
          if (issueCommentEvent) {
            candidates.push({path: `${base}/issues`, latestEvent: issueCommentEvent})
          }
          if (prEvent) {
            candidates.push({path: `${base}/prs`, latestEvent: prEvent})
          }
          if (prCommentEvent) {
            candidates.push({path: `${base}/prs`, latestEvent: prCommentEvent})
          }
        }
      }
    }

    for (const repoAddr of new Set([
      ...latestIssueEvents.keys(),
      ...latestPrEvents.keys(),
      ...latestIssueComments.keys(),
      ...latestPrComments.keys(),
    ])) {
      addRepoCandidates(repoAddr)
    }

    return candidates
  },
)

const repoCommentRoots = derived(
  [userRepoWatchValues, issueEventsStore, prEventsStore, maintainerSetRepoAddressesByRepoAddress],
  ([$watchValues, $issueEvents, $prEvents, $maintainerSetRepoAddressesByRepoAddress]) => {
    const watchedRepos = $watchValues.repos || {}
    const repoAddresses = Object.keys(watchedRepos)
    if (repoAddresses.length === 0) return []

    const repoByEffectiveAddress = new Map<string, string>()
    for (const repoAddr of repoAddresses) {
      const effective = getMaintainerSetRepoAddresses(
        $maintainerSetRepoAddressesByRepoAddress,
        repoAddr,
      )
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

    for (const event of $prEvents as TrustedEvent[]) {
      const repoAddr = getTagValue("a", event.tags)
      const rootRepoAddr = repoAddr ? repoByEffectiveAddress.get(repoAddr) : undefined
      if (!rootRepoAddr) continue
      if (!watchedRepos[rootRepoAddr]?.prs?.comments) continue
      rootIds.add(event.id)
    }

    return Array.from(rootIds)
  },
)

export const setupBudabitNotifications = () => {
  const augmentPaths = (paths: Set<string>) => {
    if (PLATFORM_RELAYS.length === 0) return paths

    for (const path of Array.from(paths)) {
      const parts = path.split("/")
      if (parts.length < 6) continue
      if (parts[1] !== "spaces" || parts[3] !== "git") continue
      const section = parts[5]
      if (section !== "issues" && section !== "prs") continue
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
    const currentPubkey = get(pubkey)
    const repoAddresses = Object.keys(values.repos || {})
    if (repoAddresses.length === 0) {
      clearLiveControllers()
      lastKey = ""
      return
    }

    const effectiveByRepo = get(maintainerSetRepoAddressesByRepoAddress)
    const key =
      repoAddresses
        .map(repoAddr => {
          const effective = getMaintainerSetRepoAddresses(effectiveByRepo, repoAddr)
          const relays = (get(repoRelaysByAddress).get(repoAddr) || []).slice().sort().join(",")
          return `${repoAddr}::${Array.from(effective).sort().join(",")}::${relays}`
        })
        .sort()
        .join("|") + `::viewer:${currentPubkey || ""}`
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
      if (repoRelays.length === 0) continue

      const effective = getMaintainerSetRepoAddresses(effectiveByRepo, repoAddr)
      for (const effectiveAddr of effective) {
        loadRepoContext({addressA: effectiveAddr, relays: repoRelays})
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
        relays: repoRelays,
        filters: liveFilters,
        signal: controller.signal,
      })
    }

    if (currentPubkey) {
      const relays = get(watchedRepoRelays)
      if (relays.length > 0) {
        const mentionFilters = [
          {
            kinds: [GIT_ISSUE, GIT_PULL_REQUEST, GIT_PULL_REQUEST_UPDATE],
            "#p": [currentPubkey],
          },
        ]
        load({relays, filters: mentionFilters}).catch(() => {})

        const controller = new AbortController()
        liveControllers.set("__mentions__", controller)
        const since = now() - 600
        const liveFilters = mentionFilters.map(filter => ({...filter, since}))
        request({
          relays,
          filters: liveFilters,
          signal: controller.signal,
          onEvent: event => {
            if (!repository.getEvent(event.id)) {
              repository.publish(event as TrustedEvent)
            }
          },
        })
      }
    }
  }

  const unsubscribeWatch = userRepoWatchValues.subscribe(rebuildRepoSubscriptions)
  const unsubscribeEffective =
    maintainerSetRepoAddressesByRepoAddress.subscribe(rebuildRepoSubscriptions)
  const unsubscribeRepoRelays = repoRelaysByAddress.subscribe(rebuildRepoSubscriptions)
  const unsubscribePubkey = pubkey.subscribe(() => rebuildRepoSubscriptions())

  let lastCommentsKey = ""
  let commentsController: AbortController | undefined
  const unsubscribeComments = derived(
    [repoCommentRoots, watchedRepoRelays],
    ([$rootIds, $relays]) => ({
      rootIds: $rootIds,
      relays: $relays,
    }),
  ).subscribe(({rootIds, relays}) => {
    const key = `${rootIds.slice().sort().join(",")}::${relays.slice().sort().join(",")}`
    if (key === lastCommentsKey) return
    lastCommentsKey = key
    commentsController?.abort()
    commentsController = undefined
    if (rootIds.length === 0) return
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
          repository.publish(event as TrustedEvent)
        }
      },
    })
  })

  return () => {
    unsubscribeWatch()
    unsubscribeEffective()
    unsubscribeRepoRelays()
    unsubscribePubkey()
    unsubscribeComments()
    commentsController?.abort()
    clearLiveControllers()
  }
}

type RepoNotificationKind = "issues" | "prs"

const repoNotificationKinds = new Set<RepoNotificationKind>(["issues", "prs"])

type RepoNotificationOptions = {
  relay: string
  repoAddress?: string
  repoAddresses?: Iterable<string>
  kind?: RepoNotificationKind
}

const getRepoAddressSet = (options: RepoNotificationOptions) => {
  const repoAddresses = new Set<string>()

  if (options.repoAddress) {
    repoAddresses.add(options.repoAddress)
  }

  for (const repoAddress of options.repoAddresses || []) {
    if (repoAddress) repoAddresses.add(repoAddress)
  }

  return repoAddresses
}

export const getRepoNotificationPaths = (paths: Set<string>, options: RepoNotificationOptions) => {
  const {relay, kind} = options
  const repoAddresses = getRepoAddressSet(options)
  if (!relay || repoAddresses.size === 0) return []
  let relayPart = ""
  try {
    relayPart = encodeRelay(relay)
  } catch {
    return []
  }
  if (!relayPart) return []
  const prefix = `/spaces/${relayPart}/git/`
  const matches: string[] = []

  for (const path of paths) {
    if (!path.startsWith(prefix)) continue
    const rest = path.slice(prefix.length)
    const [naddr, section] = rest.split("/")
    if (!naddr || !section) continue
    if (!repoNotificationKinds.has(section as RepoNotificationKind)) continue
    if (kind && section !== kind) continue
    try {
      const address = Address.fromNaddr(naddr).toString()
      if (repoAddresses.has(address)) {
        matches.push(path)
      }
    } catch {
      continue
    }
  }

  return matches
}

export const hasRepoNotification = (paths: Set<string>, options: RepoNotificationOptions) =>
  getRepoNotificationPaths(paths, options).length > 0

export const setCheckedForRepoNotifications = (
  paths: Set<string>,
  options: RepoNotificationOptions,
  timestamp?: number,
) => {
  const matches = getRepoNotificationPaths(paths, options)
  for (const path of matches) {
    if (timestamp != null) {
      setCheckedAt(path, timestamp)
    } else {
      setChecked(path)
    }
  }
}
