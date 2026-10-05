import {get} from "svelte/store"
import {pubkey} from "@welshman/app"
import {notificationUnreadHints} from "@app/util/notification-center"
import {notificationBackgroundEnabled} from "@app/util/notification-background"
import {checked, notifications, notificationCandidates} from "@app/util/notifications"
import {
  publicationOperations,
  publicationOperationsNeedingAttention,
} from "@app/core/publication-operations"
import {relayDeliveryNotices} from "@app/core/relay-publish-delivery"

export const snapshot = () => ({
  account: get(pubkey),
  hints: get(notificationUnreadHints),
  enabled: get(notificationBackgroundEnabled),
  paths: Array.from(get(notifications)),
  candidates: get(notificationCandidates).map(candidate => ({
    path: candidate.path,
    id: candidate.latestEvent?.id,
    author: candidate.latestEvent?.pubkey,
  })),
  operations: get(publicationOperationsNeedingAttention).map(operation => ({
    phase: operation.phase,
    error: operation.error,
  })),
  deliveries: get(relayDeliveryNotices).size,
})

export const getCheckedAt = (path: string) => get(checked)[path]

export const publicationConfirmed = (eventId: string) =>
  Array.from(get(publicationOperations).values()).some(
    operation => operation.event.id === eventId && operation.phase === "confirmed",
  )

const bellSelector = 'button[aria-label="Notifications"] [data-notification-indicator]'
export const bellChanges: Array<ReturnType<typeof snapshot> & {visible: boolean}> = []
export const observeBell = () => {
  const observer = new MutationObserver(() => {
    const visible = Boolean(document.querySelector(bellSelector))
    if (bellChanges.at(-1)?.visible !== visible) bellChanges.push({...snapshot(), visible})
  })
  observer.observe(document.body, {childList: true, subtree: true})
}
