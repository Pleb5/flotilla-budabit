import {Badge} from "@capawesome/capacitor-badge"
import {derived, get, readable, writable, type Readable} from "svelte/store"
import {synced, throttled} from "@welshman/store"
import {pubkey, tracker, repository, relaysByUrl} from "@welshman/app"
import {prop, find, call, spec, first, identity, now, groupBy} from "@welshman/lib"
import type {List, TrustedEvent} from "@welshman/util"
import {deriveEventsByIdByUrl} from "@welshman/store"
import {ZAP_GOAL, EVENT_TIME, MESSAGE, THREAD, COMMENT, getTagValue, Address} from "@welshman/util"
import {
  makeSpacePath,
  makeChatPath,
  makeGoalPath,
  makeThreadPath,
  makeCalendarPath,
  makeSpaceChatPath,
  makeRoomPath,
} from "@app/util/routes"
import {
  chatsById,
  hasNip29,
  userSettingsValues,
  userGroupList,
  getSpaceUrlsFromGroupList,
  getSpaceRoomsFromGroupList,
  encodeRelay,
} from "@app/core/state"
import {kv} from "@app/core/storage"

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

      for (const {pubkeys, messages} of $chatsById.values()) {
        const chatPath = makeChatPath(pubkeys)

        if (hasNotification(chatPath, messages[0])) {
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
      await Badge.set({count})
    } catch (err) {
      // failed to set badge
    }
  } else {
    await clearBadges()
  }
}

export const clearBadges = async () => {
  await Badge.clear()
}

type RepoNotificationKind = "issues" | "patches"

const repoNotificationKinds = new Set<RepoNotificationKind>(["issues", "patches"])

export const getRepoNotificationPaths = (
  paths: Set<string>,
  options: {relay: string; repoAddress: string; kind?: RepoNotificationKind},
) => {
  const {relay, repoAddress, kind} = options
  if (!relay || !repoAddress) return []
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
      if (address === repoAddress) {
        matches.push(path)
      }
    } catch {
      continue
    }
  }

  return matches
}

export const hasRepoNotification = (
  paths: Set<string>,
  options: {relay: string; repoAddress: string; kind?: RepoNotificationKind},
) => getRepoNotificationPaths(paths, options).length > 0

export const setCheckedForRepoNotifications = (
  paths: Set<string>,
  options: {relay: string; repoAddress: string; kind?: RepoNotificationKind},
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
