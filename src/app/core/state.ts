import twColors from "tailwindcss/colors"
import {get, derived, readable, writable} from "svelte/store"
import * as nip19 from "nostr-tools/nip19"
import {on, call, uniq, shuffle, parseJson, identity, always, tryCatch} from "@welshman/lib"
import {
  Pool,
  load,
  SocketStatus,
  AuthStateEvent,
  AuthStatus,
  SocketEvent,
  netContext,
} from "@welshman/net"
import {
  deriveItemsByKey,
  getter,
  makeDeriveEvent,
  makeLoadItem,
  throttled,
  deriveEventsById,
  deriveEventsAsc,
  deriveArray,
  getEventsByIdForUrl,
  deriveEventsByIdForUrl,
} from "@welshman/store"
import {isKindFeed, findFeed} from "@welshman/feeds"
import {
  ALERT_ANDROID,
  ALERT_EMAIL,
  ALERT_IOS,
  ALERT_STATUS,
  ALERT_WEB,
  APP_DATA,
  CLIENT_AUTH,
  COMMENT,
  DELETE,
  EVENT_TIME,
  MESSAGE,
  REACTION,
  REPORT,
  THREAD,
  ZAP_GOAL,
  ZAP_REQUEST,
  ZAP_RESPONSE,
  getListTags,
  getPubkeyTagValues,
  getTagValue,
  normalizeRelayUrl,
  verifyEvent,
} from "@welshman/util"
import type {TrustedEvent, Filter} from "@welshman/util"
import {decrypt} from "@welshman/signer"
import {routerContext, Router} from "@welshman/router"
import {
  pubkey,
  repository,
  tracker,
  ensurePlaintext,
  signer,
  makeOutboxLoader,
  appContext,
  createSearch,
  deriveRelay,
  sign,
  makeUserLoader,
  makeUserData,
  userFollowList,
} from "@welshman/app"

export const fromCsv = (s: string) => (s || "").split(",").filter(identity)

export const ROOM = "h"

export const GENERAL = "_"

export const DM_KIND = 4444

export const ENABLE_ZAPS = true

export const NOTIFIER_PUBKEY = import.meta.env.VITE_NOTIFIER_PUBKEY

export const NOTIFIER_RELAY = import.meta.env.VITE_NOTIFIER_RELAY

export const NOTIFIER_HANDLER_ADDRESS = import.meta.env.VITE_NOTIFIER_HANDLER_ADDRESS

export const NOTIFIER_HANDLER_RELAY = import.meta.env.VITE_NOTIFIER_HANDLER_RELAY

export const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY

export const INDEXER_RELAYS = fromCsv(import.meta.env.VITE_INDEXER_RELAYS)

export const APP_RELAYS = INDEXER_RELAYS

export const SIGNER_RELAYS = fromCsv(import.meta.env.VITE_SIGNER_RELAYS)

export const APP_BASE_URL = import.meta.env.VITE_APP_URL || ""

export const APP_DEFAULT_LOGO =
  import.meta.env.VITE_APP_LOGO || (APP_BASE_URL ? `${APP_BASE_URL}/logo.png` : "")

export const APP_DEFAULT_NAME = import.meta.env.VITE_APP_NAME || "Budabit"

export const APP_METADATA = readable({
  name: APP_DEFAULT_NAME,
  url: APP_BASE_URL,
  logo: APP_DEFAULT_LOGO || "",
})

export const APP_NAME = derived(APP_METADATA, $APP_METADATA => $APP_METADATA.name)

export const APP_URL = derived(APP_METADATA, $APP_METADATA => $APP_METADATA.url)

export const APP_LOGO = derived(APP_METADATA, $APP_METADATA => $APP_METADATA.logo)

export const getAppMetadata = () => get(APP_METADATA)

export const DEFAULT_BLOSSOM_SERVERS = fromCsv(import.meta.env.VITE_DEFAULT_BLOSSOM_SERVERS)

// Smart Widget relays - defaults to common relays for widget discovery
const envSmartWidgetRelays = fromCsv(import.meta.env.VITE_SMART_WIDGET_RELAYS)
export const SMART_WIDGET_RELAYS =
  envSmartWidgetRelays.length > 0
    ? envSmartWidgetRelays
    : ["wss://relay.yakihonne.com", "wss://relay.sharegap.net", "wss://nos.lol"]

export const BURROW_URL = import.meta.env.VITE_BURROW_URL

export const DEFAULT_PUBKEYS = import.meta.env.VITE_DEFAULT_PUBKEYS

export const DUFFLEPUD_URL = "https://dufflepud.onrender.com"

export const NIP46_PERMS =
  "nip44_encrypt,nip44_decrypt," +
  [CLIENT_AUTH, MESSAGE, THREAD, COMMENT, DM_KIND, REACTION, ZAP_REQUEST]
    .map(k => `sign_event:${k}`)
    .join(",")

export const colors = [
  ["amber", twColors.amber[600]],
  ["blue", twColors.blue[600]],
  ["cyan", twColors.cyan[600]],
  ["emerald", twColors.emerald[600]],
  ["fuchsia", twColors.fuchsia[600]],
  ["green", twColors.green[600]],
  ["indigo", twColors.indigo[600]],
  ["sky", twColors.sky[600]],
  ["lime", twColors.lime[600]],
  ["orange", twColors.orange[600]],
  ["pink", twColors.pink[600]],
  ["purple", twColors.purple[600]],
  ["red", twColors.red[600]],
  ["rose", twColors.rose[600]],
  ["teal", twColors.teal[600]],
  ["violet", twColors.violet[600]],
  ["yellow", twColors.yellow[600]],
  ["zinc", twColors.zinc[600]],
]

export const dufflepud = (path: string) => DUFFLEPUD_URL + "/" + path

export const entityLink = (entity: string) => `https://coracle.social/${entity}`

export const pubkeyLink = (pubkey: string, relays = Router.get().FromPubkeys([pubkey]).getUrls()) =>
  entityLink(nip19.nprofileEncode({pubkey, relays}))

export const bootstrapPubkeys = derived(userFollowList, $userFollowList => {
  const appPubkeys = DEFAULT_PUBKEYS.split(",")
  const userPubkeys = shuffle(getPubkeyTagValues(getListTags($userFollowList)))

  return userPubkeys.length > 5 ? userPubkeys : [...userPubkeys, ...appPubkeys]
})

export const defaultPubkeys = derived([pubkey, bootstrapPubkeys], ([$pubkey, $bootstrapPubkeys]) =>
  uniq([$pubkey, ...$bootstrapPubkeys].filter(identity)),
)

export const deriveEvent = makeDeriveEvent({
  repository,
  includeDeleted: true,
  onDerive: (filters: Filter[], relays: string[]) => load({filters, relays}),
})

export const getEventsForUrl = (url: string, filters: Filter[]) =>
  Array.from(getEventsByIdForUrl({url, tracker, repository, filters}).values())

export const deriveEventsForUrl = (url: string, filters: Filter[]) =>
  deriveArray(deriveEventsByIdForUrl({url, tracker, repository, filters}))

export const deriveRelaySignedEvents = (url: string, filters: Filter[]) =>
  derived(
    [deriveRelay(url), deriveEventsForUrl(url, filters)],
    ([relay, events]) => events,
    // khatru doesn't support relay.self, uncomment when it's ready
    // filter(spec({pubkey: relay.self}), events)
  )

// Context

appContext.dufflepudUrl = DUFFLEPUD_URL

routerContext.getIndexerRelays = always(INDEXER_RELAYS)

netContext.isEventValid = (event: TrustedEvent, url: string) =>
  getSetting<string[]>("trusted_relays").includes(url) || verifyEvent(event)

// Filters

export const makeCommentFilter = (kinds: number[], extra: Filter = {}) => ({
  kinds: [COMMENT],
  "#K": kinds.map(String),
  ...extra,
})

export const REACTION_KINDS = [REPORT, DELETE, REACTION]

if (ENABLE_ZAPS) {
  REACTION_KINDS.push(ZAP_RESPONSE)
}

export const CONTENT_KINDS = [ZAP_GOAL, EVENT_TIME, THREAD]

export const MESSAGE_KINDS = [...CONTENT_KINDS, MESSAGE]

// Settings

export const SETTINGS = "flotilla/settings"

export type SettingsValues = {
  show_media: boolean
  hide_sensitive: boolean
  trusted_relays: string[]
  send_delay: number
  font_size: number
  play_notification_sound: boolean
  show_notifications_badge: boolean
}

export type Settings = {
  event: TrustedEvent
  values: SettingsValues
}

export const defaultSettings: SettingsValues = {
  show_media: true,
  hide_sensitive: true,
  trusted_relays: [],
  send_delay: 0,
  font_size: 1.1,
  play_notification_sound: true,
  show_notifications_badge: true,
}

const settingValueKeys = Object.keys(defaultSettings) as (keyof SettingsValues)[]

export const normalizeSettingsValues = (
  values?: Partial<SettingsValues> | null,
): SettingsValues => {
  const source = values || {}

  return Object.fromEntries(
    settingValueKeys.map(key => [key, source[key] ?? defaultSettings[key]]),
  ) as SettingsValues
}

export const settingsByPubkey = deriveItemsByKey({
  repository,
  getKey: settings => settings.event.pubkey,
  filters: [{kinds: [APP_DATA], "#d": [SETTINGS]}],
  eventToItem: async (event: TrustedEvent) => {
    const values = normalizeSettingsValues(parseJson(await ensurePlaintext(event)))

    return {event, values}
  },
})

export const getSettingsByPubkey = getter(settingsByPubkey)

export const getSettings = (pubkey: string) => getSettingsByPubkey().get(pubkey)

export const loadSettings = makeLoadItem(
  makeOutboxLoader(APP_DATA, {"#d": [SETTINGS]}),
  getSettings,
)

export const userSettings = makeUserData(settingsByPubkey, loadSettings)

export const loadUserSettings = makeUserLoader(loadSettings)

export const userSettingsValues = derived(userSettings, $s => $s?.values || defaultSettings)

export const getSetting = <T>(key: keyof Settings["values"]) => get(userSettingsValues)[key] as T

// Relays sending events with empty signatures that the user has to choose to trust

export const relaysPendingTrust = writable<string[]>([])

// Relays that mostly send restricted responses to requests and events

export const relaysMostlyRestricted = writable<Record<string, string>>({})

// Alerts

export type Alert = {
  event: TrustedEvent
  tags: string[][]
}

export const alertsById = deriveItemsByKey<Alert>({
  repository,
  getKey: alert => alert.event.id,
  filters: [{kinds: [ALERT_EMAIL, ALERT_WEB, ALERT_IOS, ALERT_ANDROID]}],
  eventToItem: async event => {
    const $signer = signer.get()

    if ($signer) {
      const tags = parseJson(await decrypt($signer, NOTIFIER_PUBKEY, event.content))

      return {event, tags}
    }
  },
})

export const getAlertFeed = (alert: Alert) =>
  tryCatch(() => JSON.parse(getTagValue("feed", alert.tags)!))

export const dmAlert = derived(alertsById, $alertsById => {
  for (const alert of $alertsById.values()) {
    if (findFeed(getAlertFeed(alert), f => isKindFeed(f) && f.includes(DM_KIND))) {
      return alert
    }
  }
})

export type LegacyChannel = {
  id: string
  room: string
  name?: string
  archived?: boolean
  closed?: boolean
  private?: boolean
}

export const channelsByUrl = writable<Map<string, LegacyChannel[]>>(new Map())

export const displayChannel = (...args: any[]) => {
  const channel = args.length > 1 ? args[1] : args[0]

  return typeof channel === "string" ? channel : channel?.name || channel?.room || "Room"
}

export const canCreateRoomByPlatformPolicy = (..._args: any[]) => false

export const createBudaBitRoom = (..._args: any[]): any => undefined

export const loadRoom = async (..._args: any[]) => undefined

export const publishBudaBitRoomMeta = (..._args: any[]): any => undefined

export const getRoomMetaRelays = (url: string) => [url].filter(Boolean)

export const deriveUserIsSpaceAdmin = (_url: string) => derived(pubkey, () => false)

// Alert Statuses

export type AlertStatus = {
  event: TrustedEvent
  tags: string[][]
}

export const alertStatusesByAddress = deriveItemsByKey<AlertStatus>({
  repository,
  filters: [{kinds: [ALERT_STATUS]}],
  getKey: alertStatus => getTagValue("d", alertStatus.event.tags)!,
  eventToItem: async event => {
    const $signer = signer.get()

    if ($signer) {
      const tags = parseJson(await decrypt($signer, NOTIFIER_PUBKEY, event.content))

      return {event, tags}
    }
  },
})

export const deriveAlertStatus = (address: string) =>
  derived(alertStatusesByAddress, statuses => statuses.get(address))

// Chats

export const chatMessages = deriveEventsAsc(
  deriveEventsById({
    repository,
    filters: [{kinds: [DM_KIND]}],
  }),
)

export type Chat = {
  id: string
  pubkeys: string[]
  messages: TrustedEvent[]
  latestMessage?: TrustedEvent
  latestIncomingMessage?: TrustedEvent
  last_activity: number
  search_text: string
}

export const makeChatId = (recipient: string) => recipient

const getDmCounterparty = (event: TrustedEvent, selfPubkey: string) => {
  const participants = uniq([event.pubkey, ...getPubkeyTagValues(event.tags)])

  if (!participants.includes(selfPubkey)) {
    return undefined
  }

  const others = participants.filter(pk => pk !== selfPubkey)

  if (others.length === 0) {
    return selfPubkey
  }

  if (others.length === 1) {
    return others[0]
  }

  return undefined
}

export const buildChatsById = (events: TrustedEvent[], selfPubkey?: string) => {
  const chatsById = new Map<string, Chat>()

  if (!selfPubkey) {
    return chatsById
  }

  for (const event of events) {
    if (event.kind !== DM_KIND) {
      continue
    }

    const recipient = getDmCounterparty(event, selfPubkey)

    if (!recipient) {
      continue
    }

    const id = makeChatId(recipient)
    const pubkeys = recipient === selfPubkey ? [selfPubkey] : [selfPubkey, recipient]
    const chat = chatsById.get(id)

    if (!chat) {
      chatsById.set(id, {
        id,
        pubkeys,
        messages: [event],
        latestMessage: event,
        latestIncomingMessage: event.pubkey === selfPubkey ? undefined : event,
        last_activity: event.created_at,
        search_text: recipient,
      })
      continue
    }

    chat.messages.push(event)
    if (!chat.latestMessage || event.created_at > chat.latestMessage.created_at) {
      chat.latestMessage = event
    }
    if (
      event.pubkey !== selfPubkey &&
      (!chat.latestIncomingMessage || event.created_at > chat.latestIncomingMessage.created_at)
    ) {
      chat.latestIncomingMessage = event
    }
    chat.last_activity = Math.max(chat.last_activity, event.created_at)
  }

  return chatsById
}

export const chatsById = derived([pubkey, chatMessages], ([$pubkey, $chatMessages]) =>
  buildChatsById($chatMessages, $pubkey),
)

export const chatSearch = derived(throttled(800, chatsById), $chatsById =>
  createSearch(
    Array.from($chatsById.values()).sort((a, b) => b.last_activity - a.last_activity),
    {
      getValue: (chat: Chat) => chat.id,
      fuseOptions: {keys: ["search_text"]},
    },
  ),
)

export const deriveChat = (pubkeys: string[]) =>
  derived(chatsById, $chatsById => {
    const selfPubkey = get(pubkey)

    if (!selfPubkey) {
      return undefined
    }

    const recipients = uniq(pubkeys).filter(pk => pk !== selfPubkey)

    if (recipients.length === 0) {
      return $chatsById.get(makeChatId(selfPubkey))
    }

    if (recipients.length === 1) {
      return $chatsById.get(makeChatId(recipients[0]))
    }

    return undefined
  })

// Other utils

export const encodeRelay = (url: string) =>
  encodeURIComponent(
    normalizeRelayUrl(url)
      .replace(/^wss:\/\//, "")
      .replace(/\/$/, ""),
  )

export const decodeRelay = (url: string) => normalizeRelayUrl(decodeURIComponent(url))

export const displayReaction = (content: string) => {
  if (!content || content === "+") return "❤️"
  if (content === "-") return "👎"
  return content
}

export const deriveSocket = (url: string) => {
  const socket = Pool.get().get(url)

  return readable(socket, set => {
    const subs = [
      on(socket, SocketEvent.Error, () => set(socket)),
      on(socket, SocketEvent.Status, () => set(socket)),
      on(socket.auth, AuthStateEvent.Status, () => set(socket)),
    ]

    return () => subs.forEach(call)
  })
}

export const deriveSocketStatus = (url: string) =>
  throttled(
    800,
    derived([deriveSocket(url), relaysMostlyRestricted], ([$socket, $relaysMostlyRestricted]) => {
      if ($socket.status === SocketStatus.Opening) {
        return {theme: "warning", title: "Connecting"}
      }

      if ($socket.status === SocketStatus.Closing) {
        return {theme: "gray-500", title: "Not Connected"}
      }

      if ($socket.status === SocketStatus.Closed) {
        return {theme: "gray-500", title: "Not Connected"}
      }

      if ($socket.status === SocketStatus.Error) {
        return {theme: "error", title: "Failed to Connect"}
      }

      if ($socket.auth.status === AuthStatus.Requested) {
        return {theme: "warning", title: "Authenticating"}
      }

      if ($socket.auth.status === AuthStatus.PendingSignature) {
        return {theme: "warning", title: "Authenticating"}
      }

      if ($socket.auth.status === AuthStatus.DeniedSignature) {
        return {theme: "error", title: "Failed to Authenticate"}
      }

      if ($socket.auth.status === AuthStatus.PendingResponse) {
        return {theme: "warning", title: "Authenticating"}
      }

      if ($socket.auth.status === AuthStatus.Forbidden) {
        return {theme: "error", title: "Access Denied"}
      }

      if ($relaysMostlyRestricted[url]) {
        return {theme: "error", title: "Access Denied"}
      }

      return {theme: "success", title: "Connected"}
    }),
  )

export const deriveTimeout = (timeout: number) => {
  const store = writable<boolean>(false)

  setTimeout(() => store.set(true), timeout)

  return derived(store, identity)
}

export const shouldIgnoreError = (error: string) => {
  const isIgnored = error.startsWith("mute: ")
  const isAborted = error.includes("Signing was aborted")

  return isIgnored || isAborted
}

export const deriveRelayAuthError = (url: string) => {
  const stripPrefix = (m: string) => m.replace(/^\w+: /, "")

  // Kick off the auth process
  Pool.get().get(url).auth.attemptAuth(sign)

  return derived(
    [relaysMostlyRestricted, deriveSocket(url)],
    ([$relaysMostlyRestricted, $socket]) => {
      if ($socket.auth.status === AuthStatus.Forbidden && $socket.auth.details) {
        return stripPrefix($socket.auth.details)
      }

      if ($relaysMostlyRestricted[url]) {
        return stripPrefix($relaysMostlyRestricted[url])
      }
    },
  )
}
