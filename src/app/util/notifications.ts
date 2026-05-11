import {derived, get, readable, writable, type Readable} from "svelte/store"
import {synced, throttled} from "@welshman/store"
import {pubkey} from "@welshman/app"
import {identity, now, prop} from "@welshman/lib"
import type {TrustedEvent} from "@welshman/util"
import {chatsById, userSettingsValues} from "@app/core/state"
import {kv} from "@app/core/storage"
import {makeChatPath} from "@app/util/routes"

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

const getLatestIncomingEvent = (events: TrustedEvent[], selfPubkey: string | undefined) => {
  if (!events || events.length === 0 || !selfPubkey) return undefined

  let latest: TrustedEvent | undefined
  for (const event of events) {
    if (event.pubkey === selfPubkey) continue
    if (!latest || event.created_at > latest.created_at) latest = event
  }

  return latest
}

const normalizeChecked = (value: number) =>
  value > 10_000_000_000 ? Math.round(value / 1000) : value

export const notifications = derived(
  throttled(1000, derived([pubkey, checked, chatsById, notificationsConfig, extraCandidates], identity)),
  ([$pubkey, $checked, $chatsById, $notificationsConfig, $extraCandidates]) => {
    const hasNotification = (path: string, latestEvent: TrustedEvent | undefined) => {
      if (!latestEvent || latestEvent.pubkey === $pubkey) return false

      for (const [entryPath, ts] of Object.entries($checked)) {
        if (entryPath.endsWith(":seen")) continue
        const isMatch =
          entryPath === "*" ||
          entryPath.startsWith(path) ||
          (entryPath === "/chat/*" && path.startsWith("/chat/"))
        if (isMatch && normalizeChecked(ts) >= latestEvent.created_at) return false
      }

      return true
    }

    const paths = new Set<string>()

    for (const {id, messages} of $chatsById.values()) {
      const chatPath = makeChatPath(id)
      const latestMessage = getLatestIncomingEvent(messages, $pubkey)

      if (hasNotification(chatPath, latestMessage)) {
        paths.add("/chat")
        paths.add(chatPath)
      }
    }

    for (const candidate of $extraCandidates || []) {
      if (hasNotification(candidate.path, candidate.latestEvent)) paths.add(candidate.path)
    }

    if ($notificationsConfig.augmentPaths) {
      const augmented = $notificationsConfig.augmentPaths(paths)
      return augmented || paths
    }

    return paths
  },
)

export const badgeCount = derived(notifications, notifications => notifications.size)

export const handleBadgeCountChanges = async (count: number) => {
  if (get(userSettingsValues).show_notifications_badge) {
    try {
      if ("setAppBadge" in navigator) {
        await (navigator as Navigator & {setAppBadge: (count?: number) => Promise<void>}).setAppBadge(
          count,
        )
      }
    } catch {
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

export const setupBudabitNotifications = () => {
  setNotificationsConfig({})
  setNotificationCandidates(readable<NotificationCandidate[]>([]))

  return () => undefined
}

export const getRepoNotificationPaths = () => []

export const hasRepoNotification = () => false

export const setCheckedForRepoNotifications = () => undefined
