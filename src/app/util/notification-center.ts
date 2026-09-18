import {synced} from "@welshman/store"
import {pubkey} from "@welshman/app"
import {derived, writable} from "svelte/store"
import {kv} from "@app/core/storage"
import {modal} from "@app/util/modal"

export const NOTIFICATION_CENTER_MODAL_KIND = "notification-center"

export type NotificationReadState = {
  version: 3
  readRowIdsByPubkey: Record<string, string[]>
}

export const defaultNotificationReadState = (): NotificationReadState => ({
  version: 3,
  readRowIdsByPubkey: {},
})

const MAX_READ_NOTIFICATION_ROWS = 5_000

const normalizeRowIds = (rowIds: unknown) =>
  Array.from(
    new Set(
      (Array.isArray(rowIds) ? rowIds : [])
        .map(rowId => String(rowId || "").trim())
        .filter(Boolean),
    ),
  ).slice(0, MAX_READ_NOTIFICATION_ROWS)

export const normalizeNotificationReadState = (
  state: Partial<NotificationReadState> | undefined,
): NotificationReadState =>
  state?.version === 3
    ? {
        version: 3,
        readRowIdsByPubkey: Object.fromEntries(
          Object.entries(state.readRowIdsByPubkey || {}).flatMap(([pubkey, rowIds]) => {
            const normalizedPubkey = pubkey.trim()
            return normalizedPubkey ? [[normalizedPubkey, normalizeRowIds(rowIds)]] : []
          }),
        ),
      }
    : defaultNotificationReadState()

export const markNotificationRowsReadState = (
  state: Partial<NotificationReadState> | undefined,
  pubkey: string | undefined,
  rowIds: Iterable<string>,
): NotificationReadState => {
  const current = normalizeNotificationReadState(state)
  const account = String(pubkey || "").trim()
  if (!account) return current

  return {
    version: 3,
    readRowIdsByPubkey: {
      ...current.readRowIdsByPubkey,
      [account]: normalizeRowIds([
        ...Array.from(rowIds),
        ...(current.readRowIdsByPubkey[account] || []),
      ]),
    },
  }
}

export const hasUnreadNotificationRowsState = (
  state: Partial<NotificationReadState> | undefined,
  pubkey: string | undefined,
  rowIds: Iterable<string>,
) => {
  const current = normalizeNotificationReadState(state)
  const account = String(pubkey || "").trim()
  if (!account) return false
  const readRowIds = new Set(current.readRowIdsByPubkey[account] || [])

  return Array.from(rowIds).some(rowId => Boolean(rowId) && !readRowIds.has(rowId))
}

export const getUnreadNotificationRowIdsState = (
  state: Partial<NotificationReadState> | undefined,
  pubkey: string | undefined,
  rowIds: Iterable<string>,
) => {
  const current = normalizeNotificationReadState(state)
  const account = String(pubkey || "").trim()
  if (!account) return []
  const readRowIds = new Set(current.readRowIdsByPubkey[account] || [])

  return Array.from(rowIds).filter(rowId => Boolean(rowId) && !readRowIds.has(rowId))
}

export const notificationCenterOpen = derived(
  modal,
  $modal => $modal?.options.kind === NOTIFICATION_CENTER_MODAL_KIND,
)

export const notificationUnreadHints = writable<Record<string, boolean>>({})

export const setNotificationUnreadHint = (pubkey: string | undefined, unread: boolean) => {
  const account = String(pubkey || "").trim()
  if (!account) return
  notificationUnreadHints.update(hints =>
    hints[account] === unread ? hints : {...hints, [account]: unread},
  )
}

export const notificationReadState = synced<NotificationReadState>({
  key: "notificationCenter.readState",
  defaultValue: defaultNotificationReadState(),
  storage: kv,
})

// Keep the bell in sync even before the lazily loaded notification modal opens.
// The layout owns this subscription so source discovery follows background admission
// and is cancelled alongside the other notification work on navigation.
export const setupNotificationUnreadHints = () => {
  let active = true
  let unsubscribe: (() => void) | undefined

  void Promise.all([import("./notification-sources"), notificationReadState.ready])
    .then(([{notificationCenterRows}]) => {
      if (!active) return

      unsubscribe = derived(
        [pubkey, notificationCenterRows, notificationReadState],
        ([$pubkey, $rows, $readState]) => ({
          pubkey: $pubkey,
          unread: hasUnreadNotificationRowsState(
            $readState,
            $pubkey,
            $rows.map(row => row.id),
          ),
        }),
      ).subscribe(({pubkey, unread}) => setNotificationUnreadHint(pubkey, unread))
    })
    .catch(error => {
      if (active) console.warn("[notifications] Failed to start unread tracking", error)
    })

  return () => {
    active = false
    unsubscribe?.()
    unsubscribe = undefined
  }
}

export const markNotificationRowsRead = (pubkey: string | undefined, rowIds: Iterable<string>) =>
  notificationReadState.update(state => markNotificationRowsReadState(state, pubkey, rowIds))

export const clearNotificationReadState = () =>
  notificationReadState.set(defaultNotificationReadState())
