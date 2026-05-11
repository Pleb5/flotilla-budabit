import twColors from "tailwindcss/colors"
import {browser} from "$app/environment"
import {get, derived, readable, writable} from "svelte/store"
import * as nip19 from "nostr-tools/nip19"
import {
  on,
  gt,
  max,
  spec,
  call,
  sortBy,
  uniq,
  indexBy,
  partition,
  shuffle,
  parseJson,
  memoize,
  pushToMapKey,
  identity,
  always,
  tryCatch,
  fromPairs,
} from "@welshman/lib"
import {
  Pool,
  load,
  request,
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
  makeDeriveItem,
  makeLoadItem,
  throttled,
  deriveEventsById,
  deriveEventsAsc,
  deriveEventsByIdByUrl,
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
  ROOM_CREATE_PERMISSION,
  ROOM_META,
  ROOM_DELETE,
  THREAD,
  ZAP_GOAL,
  ZAP_REQUEST,
  ZAP_RESPONSE,
  getListTags,
  getPubkeyTagValues,
  getTag,
  getTagValue,
  getTagValues,
  isRelayUrl,
  normalizeRelayUrl,
  verifyEvent,
  readRoomMeta,
  makeRoomMeta,
  ManagementMethod,
  makeRoomEditEvent,
} from "@welshman/util"
import type {TrustedEvent, Filter, RoomMeta} from "@welshman/util"
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
  publishThunk,
  deriveRelay,
  manageRelay,
  sign,
  makeUserLoader,
  makeUserData,
  userFollowList,
} from "@welshman/app"
import type {ThunkOptions} from "@welshman/app"

export type Room = RoomMeta & {
  url: string
  id: string
  isArchived: boolean
  creatorPubkey?: string
}

export const fromCsv = (s: string) => (s || "").split(",").filter(identity)

const isHexPubkey = (value: string) => /^[0-9a-f]{64}$/i.test(value)

const normalizePubkey = (value: string) => {
  const trimmed = (value || "").trim()

  if (!trimmed) return ""
  if (isHexPubkey(trimmed)) return trimmed.toLowerCase()

  if (trimmed.startsWith("npub")) {
    try {
      const decoded = nip19.decode(trimmed)

      if (decoded.type === "npub" && typeof decoded.data === "string") {
        return decoded.data.toLowerCase()
      }
    } catch {
      return ""
    }
  }

  return ""
}

const normalizePubkeysCsv = (value: string) => fromCsv(value).map(normalizePubkey).filter(identity)

const safeNormalizeRelayUrl = (url: string) => {
  try {
    return normalizeRelayUrl(url)
  } catch {
    return ""
  }
}

const isLocalHost = (host: string) => host === "localhost" || host === "127.0.0.1"

const canManageRelayFromBrowser = (url: string) => {
  if (!browser) return false
  const normalized = safeNormalizeRelayUrl(url)
  if (!normalized) return false

  try {
    const relayHost = new URL(normalized.replace(/^ws/, "http")).hostname
    const pageHost = window.location.hostname
    if (!pageHost || !relayHost) return false
    if (pageHost === relayHost) return true
    if (isLocalHost(pageHost) && isLocalHost(relayHost)) return true
  } catch {
    return false
  }

  return false
}

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

export const SIGNER_RELAYS = fromCsv(import.meta.env.VITE_SIGNER_RELAYS)

export const PLATFORM_URL = import.meta.env.VITE_PLATFORM_URL

export const PLATFORM_TERMS = import.meta.env.VITE_PLATFORM_TERMS

export const PLATFORM_PRIVACY = import.meta.env.VITE_PLATFORM_PRIVACY

export const PLATFORM_LOGO = PLATFORM_URL + "/logo.png"

export const PLATFORM_NAME = import.meta.env.VITE_PLATFORM_NAME

export const PLATFORM_RELAYS = fromCsv(import.meta.env.VITE_PLATFORM_RELAYS)

const normalizedPlatformRelays = PLATFORM_RELAYS.map(normalizeRelayUrl)

const hasRoomArchiveTag = (tags: string[][] = []) =>
  tags.some(tag => tag[0] === "archived" && (tag[1] || "true") !== "false")

const getRoomMetaIdentifier = (event: TrustedEvent) =>
  getTagValue("d", event.tags) || getTagValue("h", event.tags) || ""

export const isPlatformRelay = (url: string) =>
  normalizedPlatformRelays.includes(normalizeRelayUrl(url))

export const PLATFORM_ROOM_CREATOR_PUBKEYS = normalizePubkeysCsv(
  import.meta.env.VITE_PLATFORM_ROOM_CREATOR_PUBKEYS,
)

export const canCreateRoomByPlatformPolicy = ({
  relayUrl,
  viewerPubkey,
  relayOwnerPubkey,
}: {
  relayUrl: string
  viewerPubkey?: string | null
  relayOwnerPubkey?: string | null
}) => {
  const viewer = normalizePubkey(viewerPubkey || "")

  if (!viewer) return false

  const normalizedRelayUrl = safeNormalizeRelayUrl(relayUrl)
  const isPlatform =
    normalizedRelayUrl !== "" && normalizedPlatformRelays.includes(normalizedRelayUrl)

  if (isPlatform && PLATFORM_ROOM_CREATOR_PUBKEYS.length > 0) {
    return PLATFORM_ROOM_CREATOR_PUBKEYS.includes(viewer)
  }

  const owner = normalizePubkey(relayOwnerPubkey || "")

  return Boolean(owner && owner === viewer)
}

export const PLATFORM_ACCENT = import.meta.env.VITE_PLATFORM_ACCENT

export const PLATFORM_DESCRIPTION = import.meta.env.VITE_PLATFORM_DESCRIPTION

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

export const EXTENSIONS_KIND = 31990

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
  report_usage: boolean
  report_errors: boolean
  send_delay: number
  font_size: number
  play_notification_sound: boolean
  show_notifications_badge: boolean
}

export type Settings = {
  event: TrustedEvent
  values: SettingsValues
}

export const defaultSettings = {
  show_media: true,
  hide_sensitive: true,
  trusted_relays: [],
  report_usage: true,
  report_errors: true,
  send_delay: 0,
  font_size: 1.1,
  play_notification_sound: true,
  show_notifications_badge: true,
}

export const settingsByPubkey = deriveItemsByKey({
  repository,
  getKey: settings => settings.event.pubkey,
  filters: [{kinds: [APP_DATA], "#d": [SETTINGS]}],
  eventToItem: async (event: TrustedEvent) => {
    const values = {...defaultSettings, ...parseJson(await ensurePlaintext(event))}

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

// BudaBit room create helper.
// This flow needs a ROOM_META (39000) event with a d-tag, while welshman currently
// creates regular room events through createRoom/editRoom helpers.
export const getRoomMetaRelays = (url?: string) => {
  const platformRelays = uniq(
    PLATFORM_RELAYS.map(relay => {
      try {
        return normalizeRelayUrl(relay)
      } catch {
        return ""
      }
    }).filter(isRelayUrl),
  )

  if (platformRelays.length > 0) {
    return platformRelays
  }

  if (!url) {
    return []
  }

  try {
    const normalized = normalizeRelayUrl(url)

    return isRelayUrl(normalized) ? [normalized] : []
  } catch {
    return []
  }
}

export const makeBudaBitRoomMetaEvent = (room: RoomMeta, {archived}: {archived?: boolean} = {}) => {
  const event = makeRoomEditEvent(room)
  const existingArchived = hasRoomArchiveTag(event.tags)

  event.kind = ROOM_META
  event.tags = event.tags
    .map(tag => {
      if (tag[0] === "h") {
        return ["d", tag[1], ...tag.slice(2)]
      }

      return tag
    })
    .filter(tag => tag[0] !== "archived")

  if (archived ?? existingArchived) {
    event.tags.push(["archived", "true"])
  }

  return event
}

export const publishBudaBitRoomMeta = ({
  url,
  room,
  archived,
  relays,
}: {
  url: string
  room: RoomMeta
  archived?: boolean
  relays?: string[]
}) => {
  const roomEventThunkOptions: ThunkOptions = {
    event: makeBudaBitRoomMetaEvent(room, {archived}),
    relays: relays || getRoomMetaRelays(url),
  }

  return publishThunk(roomEventThunkOptions)
}

export const createBudaBitRoom = (url: string, room: RoomMeta) =>
  publishBudaBitRoomMeta({url, room})

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

export const makeChannelId = (url: string, room: string) => {
  if (room.startsWith("naddr1")) {
    return "naddr1"
  }

  return `${url}'${room}`
}

export const splitChannelId = (id: string) => splitRoomId(id)

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
        last_activity: event.created_at,
        search_text: recipient,
      })
      continue
    }

    chat.messages.push(event)
    chat.last_activity = Math.max(chat.last_activity, event.created_at)
  }

  return chatsById
}

export const chatsById = derived([pubkey, chatMessages], ([$pubkey, $chatMessages]) =>
  buildChatsById($chatMessages, $pubkey),
)

export const chatSearch = derived(throttled(800, chatsById), $chatsById =>
  createSearch(Array.from($chatsById.values()), {
    getValue: (chat: Chat) => chat.id,
    fuseOptions: {keys: ["search_text"]},
  }),
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

export const makeRoomId = (url: string, h: string) => `${url}'${h}`

export const splitRoomId = (id: string) => id.split("'")

export const roomMetaEventsByIdByUrl = deriveEventsByIdByUrl({
  tracker,
  repository,
  filters: [{kinds: [ROOM_META, ROOM_DELETE]}],
})

export const roomsByUrl = derived(roomMetaEventsByIdByUrl, roomMetaEventsByIdByUrl => {
  const result = new Map<string, Room[]>()

  for (const [url, events] of roomMetaEventsByIdByUrl.entries()) {
    const [metaEvents, deleteEvents] = partition(spec({kind: ROOM_META}), events.values())
    const deletedByH = new Map<string, number>()
    const metaEventsByH = new Map<
      string,
      Array<RoomMeta & {event: TrustedEvent; isArchived: boolean}>
    >()

    for (const event of deleteEvents) {
      for (const h of getTagValues("h", event.tags)) {
        deletedByH.set(h, max([deletedByH.get(h), event.created_at]))
      }
    }

    for (const event of metaEvents) {
      let meta: (RoomMeta & {event: TrustedEvent}) | undefined

      try {
        meta = readRoomMeta(event)
      } catch {
        const h = getRoomMetaIdentifier(event)

        if (!h) continue

        const tags = fromPairs(event.tags as any)

        meta = {
          h,
          event,
          name: (tags as any).name || h,
          about: (tags as any).about,
          picture: (tags as any).picture,
          isClosed: Boolean(getTag("closed", event.tags)),
          isHidden: Boolean(getTag("hidden", event.tags)),
          isPrivate: Boolean(getTag("private", event.tags)),
          isRestricted: Boolean(getTag("restricted", event.tags)),
        }
      }

      if (!meta?.h) {
        continue
      }

      const current = metaEventsByH.get(meta.h) || []

      current.push({...meta, isArchived: hasRoomArchiveTag(event.tags)})
      metaEventsByH.set(meta.h, current)
    }

    const rooms: Room[] = []

    for (const [h, roomMetaEvents] of metaEventsByH.entries()) {
      const creatorPubkey = sortBy(
        (room: RoomMeta & {event: TrustedEvent}) => room.event.created_at,
        roomMetaEvents,
      )[0]?.event.pubkey
      const visibleRoom = sortBy(
        (room: RoomMeta & {event: TrustedEvent}) => -room.event.created_at,
        roomMetaEvents,
      ).find(room => !gt(deletedByH.get(h), room.event.created_at))

      if (!visibleRoom) {
        continue
      }

      rooms.push({
        ...visibleRoom,
        url,
        id: makeRoomId(url, h),
        isArchived: Boolean(visibleRoom.isArchived),
        creatorPubkey,
      })
    }

    result.set(url, rooms)
  }

  return result
})

export const roomsById = derived(roomsByUrl, roomsByUrl =>
  indexBy(room => room.id, Array.from(roomsByUrl.values()).flatMap(identity)),
)

export const getRoomsById = () => get(roomsById) || new Map<string, Room>()

export const getRoom = (id: string) => getRoomsById().get(id)

export const loadRoom = call(() => {
  const _fetchRoom = async (id: string) => {
    const [url, h] = splitRoomId(id)

    if (!isPlatformRelay(url)) {
      return
    }

    await request({
      relays: [url],
      filters: [{kinds: [ROOM_META], "#d": [h]}],
      autoClose: true,
    })
  }

  const _loadRoom = makeLoadItem(_fetchRoom, getRoom)

  return (url: string, h: string) => _loadRoom(makeRoomId(url, h))
})

export const deriveRoom = call(() => {
  const _deriveRoom = makeDeriveItem(roomsById, loadRoom)

  return (url: string, h: string) =>
    derived(
      _deriveRoom(makeRoomId(url, h)),
      room => room || ({...makeRoomMeta({h}), isArchived: false} as Room),
    )
})

export const displayRoom = (url: string, h: string) => getRoom(makeRoomId(url, h))?.name || h

export const roomComparator = (url: string) => (h: string) => displayRoom(url, h).toLowerCase()

export const deriveArchivedRooms = (url: string) =>
  derived(archivedChannelsByUrl, $archivedChannelsByUrl =>
    sortBy(
      room => displayChannel(url, room).toLowerCase(),
      ($archivedChannelsByUrl.get(url) || []).map(channel => channel.room),
    ),
  )

export type Channel = {
  id: string
  url: string
  room: string
  metaId: string
  event: TrustedEvent
  name: string
  closed: boolean
  private: boolean
  restricted: boolean
  archived: boolean
  creatorPubkey?: string
  picture?: string
  about?: string
}

type ChannelMeta = Omit<Channel, "id" | "url" | "room" | "creatorPubkey">

const readChannelMeta = (event: TrustedEvent): ChannelMeta | undefined => {
  let metaId = getRoomMetaIdentifier(event)
  let name = ""
  let picture: string | undefined
  let about: string | undefined

  try {
    const meta = readRoomMeta(event)

    metaId = meta.h
    name = meta.name || meta.h
    picture = meta.picture
    about = meta.about
  } catch {
    const tags = fromPairs(event.tags as any)

    metaId = metaId || (tags as any).d
    name = (tags as any).name || metaId || ""
    picture = (tags as any).picture
    about = (tags as any).about
  }

  if (!metaId) {
    return undefined
  }

  return {
    metaId,
    event,
    name: name || metaId,
    closed: Boolean(getTag("closed", event.tags)),
    private: Boolean(getTag("private", event.tags)),
    restricted: Boolean(getTag("restricted", event.tags)),
    archived: hasRoomArchiveTag(event.tags),
    picture,
    about,
  }
}

export const buildChannelsFromEvents = ({
  events,
  platformRelays = PLATFORM_RELAYS,
  getEventRelayUrls,
}: {
  events: TrustedEvent[]
  platformRelays?: string[]
  getEventRelayUrls: (event: TrustedEvent) => Iterable<string>
}) => {
  const channels: Channel[] = []
  const normalizedPlatformRelays = platformRelays.map(safeNormalizeRelayUrl).filter(isRelayUrl)
  const metaEventsByRoomId = new Map<string, ChannelMeta[]>()

  for (const event of events) {
    const eventRelays = new Set(
      Array.from(getEventRelayUrls(event)).map(safeNormalizeRelayUrl).filter(isRelayUrl),
    )
    const isFromPlatformRelay = normalizedPlatformRelays.some(url => eventRelays.has(url))

    if (!isFromPlatformRelay) {
      continue
    }

    const meta = readChannelMeta(event)

    if (!meta) {
      continue
    }

    const items = metaEventsByRoomId.get(meta.metaId) || []
    items.push(meta)
    metaEventsByRoomId.set(meta.metaId, items)
  }

  for (const [metaId, events] of metaEventsByRoomId.entries()) {
    const latest = sortBy(item => -item.event.created_at, events)[0]
    const creatorPubkey = sortBy(item => item.event.created_at, events)[0]?.event.pubkey

    if (!latest) {
      continue
    }

    // Budabit messages are tagged with the room name, not necessarily the ROOM_META d tag.
    const room = latest.name || metaId

    for (const url of normalizedPlatformRelays) {
      channels.push({
        ...latest,
        id: makeChannelId(url, room),
        url,
        room,
        creatorPubkey,
      })
    }
  }

  const result = new Map<string, Channel>()
  for (const channel of channels) {
    if (!result.has(channel.id)) {
      result.set(channel.id, channel)
    }
  }

  return Array.from(result.values())
}

export const channelEvents = deriveEventsAsc(
  deriveEventsById({
    repository,
    filters: PLATFORM_RELAYS.length > 0 ? [{kinds: [ROOM_META]}] : [],
  }),
)

export const channels = derived(channelEvents, $channelEvents =>
  buildChannelsFromEvents({
    events: $channelEvents,
    getEventRelayUrls: event => tracker.getRelays(event.id),
  }),
)

export const channelsById = derived(channels, $channels => {
  const result = new Map<string, Channel>()

  for (const channel of $channels) {
    result.set(channel.id, channel)
  }

  return result
})

export const deriveChannel = (url: string, room: string) =>
  derived(channelsById, $channelsById => $channelsById.get(makeChannelId(url, room)))

export const channelsByUrl = derived(channelsById, $channelsById => {
  const result = new Map<string, Channel[]>()

  for (const channel of $channelsById.values()) {
    pushToMapKey(result, channel.url, channel)
  }

  return result
})

export const activeChannelsByUrl = derived(channelsByUrl, $channelsByUrl => {
  const result = new Map<string, Channel[]>()

  for (const [url, channels] of $channelsByUrl.entries()) {
    result.set(
      url,
      channels.filter(channel => !channel.archived),
    )
  }

  return result
})

export const archivedChannelsByUrl = derived(channelsByUrl, $channelsByUrl => {
  const result = new Map<string, Channel[]>()

  for (const [url, channels] of $channelsByUrl.entries()) {
    result.set(
      url,
      channels.filter(channel => channel.archived),
    )
  }

  return result
})

export const displayChannel = (url: string, room: string) => {
  if (room === GENERAL) return "general"

  return get(channelsById).get(makeChannelId(url, room))?.name || room
}

export const loadPlatformChannels = () =>
  request({
    relays: PLATFORM_RELAYS,
    filters: [{kinds: [ROOM_META]}],
    autoClose: true,
  })

// Relay moderation/admin

export type BannedPubkeyItem = {
  pubkey: string
  reason: string
}

export const spaceBannedPubkeyItems = new Map<string, BannedPubkeyItem[]>()

export const deriveSpaceBannedPubkeyItems = (url: string) => {
  const store = writable(spaceBannedPubkeyItems.get(url) || [])

  if (canManageRelayFromBrowser(url)) {
    manageRelay(url, {method: ManagementMethod.ListBannedPubkeys, params: []})
      .then(res => {
        spaceBannedPubkeyItems.set(url, res.result)
        store.set(res.result)
      })
      .catch(() => undefined)
  }

  return store
}

export const deriveUserIsSpaceAdmin = memoize((url?: string) => {
  const store = writable(false)

  if (url && canManageRelayFromBrowser(url)) {
    manageRelay(url, {method: ManagementMethod.SupportedMethods, params: []})
      .then(res => store.set(Boolean(res.result?.length)))
      .catch(() => store.set(false))
  }

  return store
})

export const deriveUserCanCreateRoom = (url: string) => {
  const filters: Filter[] = [{kinds: [ROOM_CREATE_PERMISSION]}]

  return derived(
    [pubkey, deriveEventsForUrl(url, filters), deriveUserIsSpaceAdmin(url)],
    ([$pubkey, $events, $isAdmin]) => {
      for (const event of $events) {
        if (getPubkeyTagValues(event.tags).includes($pubkey!)) {
          return true
        }
      }

      return $isAdmin
    },
  )
}

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
