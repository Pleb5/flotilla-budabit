import twColors from "tailwindcss/colors"
import {Capacitor} from "@capacitor/core"
import {browser} from "$app/environment"
import {get, derived, readable, writable} from "svelte/store"
import * as nip19 from "nostr-tools/nip19"
import {
  on,
  gt,
  max,
  spec,
  call,
  first,
  sortBy,
  sort,
  uniq,
  indexBy,
  partition,
  shuffle,
  parseJson,
  memoize,
  addToMapKey,
  identity,
  always,
  tryCatch,
  fromPairs,
  find,
  nth,
  nthEq,
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
  DIRECT_MESSAGE_FILE,
  DIRECT_MESSAGE,
  EVENT_TIME,
  MESSAGE,
  REACTION,
  REPORT,
  ROOM_CREATE_PERMISSION,
  ROOM_JOIN,
  ROOM_LEAVE,
  ROOM_ADMINS,
  ROOM_META,
  ROOM_DELETE,
  ROOMS,
  THREAD,
  WRAP,
  ZAP_GOAL,
  ZAP_REQUEST,
  ZAP_RESPONSE,
  asDecryptedEvent,
  getGroupTags,
  getListTags,
  getPubkeyTagValues,
  getRelayTagValues,
  getTagValue,
  getTagValues,
  isRelayUrl,
  makeEvent,
  normalizeRelayUrl,
  readList,
  verifyEvent,
  readRoomMeta,
  makeRoomMeta,
  ManagementMethod,
  makeRoomEditEvent,
  ROOM_REMOVE_MEMBER,
  ROOM_ADD_MEMBER,
  ROOM_MEMBERS,
  RELAY_ADD_MEMBER,
  RELAY_REMOVE_MEMBER,
  RELAY_MEMBERS,
  RELAY_JOIN,
  RELAY_LEAVE,
} from "@welshman/util"
import type {
  TrustedEvent,
  List,
  Filter,
  RoomMeta,
  PublishedList,
  RelayProfile,
} from "@welshman/util"
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
  getThunkError,
  publishThunk,
  deriveRelay,
  manageRelay,
  sign,
  makeUserLoader,
  makeUserData,
  userFollowList,
} from "@welshman/app"
import type {ThunkOptions} from "@welshman/app"
import type {RepositoryUpdate} from "@welshman/net"

export type Room = RoomMeta & {url: string; id: string}

export const fromCsv = (s: string) => (s || "").split(",").filter(identity)

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

export const PROTECTED = ["-"]

export const ENABLE_ZAPS = Capacitor.getPlatform() != "ios"

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

export const isPlatformRelay = (url: string) =>
  normalizedPlatformRelays.includes(normalizeRelayUrl(url))

export const PLATFORM_ACCENT = import.meta.env.VITE_PLATFORM_ACCENT

export const PLATFORM_DESCRIPTION = import.meta.env.VITE_PLATFORM_DESCRIPTION

export const DEFAULT_BLOSSOM_SERVERS = fromCsv(import.meta.env.VITE_DEFAULT_BLOSSOM_SERVERS)

// Smart Widget relays - defaults to YakiHonne relay for compatibility
const envSmartWidgetRelays = fromCsv(import.meta.env.VITE_SMART_WIDGET_RELAYS)
export const SMART_WIDGET_RELAYS =
  envSmartWidgetRelays.length > 0 ? envSmartWidgetRelays : ["wss://relay.yakihonne.com"]

export const BURROW_URL = import.meta.env.VITE_BURROW_URL

export const DEFAULT_PUBKEYS = import.meta.env.VITE_DEFAULT_PUBKEYS

export const DUFFLEPUD_URL = "https://dufflepud.onrender.com"

export const EXTENSIONS_KIND = 31990

export const NIP46_PERMS =
  "nip44_encrypt,nip44_decrypt," +
  [CLIENT_AUTH, RELAY_JOIN, MESSAGE, THREAD, COMMENT, ROOMS, WRAP, REACTION, ZAP_REQUEST]
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
    if (findFeed(getAlertFeed(alert), f => isKindFeed(f) && f.includes(WRAP))) {
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

// BudaBit ROOM create function
// Create kind 39_000 (ROOM_META) event instea of 9007
// Normally this event should only be created by the relay owner pubkey
// but since we do NOT want other ppl to create rooms on BudaBit relay
// this is fine. Room creation is only enabled for @Five
export const createBudaBitRoom = (url: string, room: RoomMeta) => {
  const event = makeRoomEditEvent(room)
  const roomEventThunkOptions: ThunkOptions = {
    event,
    relays: [url],
  }

  // Hack: welshman does not have makeRoomMetaEvent so kind must be overwritten
  event.kind = ROOM_META

  // Replace h-tag with d-tag according to spec
  event.tags.forEach(t => {
    if (t[0] === "h") {
      t[0] = "d"
    }
  })

  return publishThunk(roomEventThunkOptions)
}

// Membership

export const hasMembershipUrl = (list: List | undefined, url: string) =>
  getListTags(list).some(t => {
    if (t[0] === "r") return t[1] === url
    if (t[0] === "group") return t[2] === url

    return false
  })

export const getMembershipUrls = (list?: List) => {
  const tags = getListTags(list)

  return sort(
    uniq([...getRelayTagValues(tags), ...getGroupTags(tags).map(nth(2))]).map(url =>
      normalizeRelayUrl(url),
    ),
  )
}

export const getMembershipRooms = (list?: List) =>
  getGroupTags(getListTags(list)).map(([_, room, url, name = ""]) => ({url, room, name}))

export const getMembershipRoomsByUrl = (url: string, list?: List) =>
  sort(getGroupTags(getListTags(list)).filter(nthEq(2, url)).map(nth(1)))

export const memberships = derived(
  deriveEventsAsc(
    deriveEventsById({
      repository,
      filters: [{kinds: [ROOMS]}],
    }),
  ),
  $events => $events.map(e => readList(asDecryptedEvent(e))).filter(identity) as PublishedList[],
)

export const membershipsByPubkey = deriveItemsByKey({
  repository,
  filters: [{kinds: [ROOMS]}],
  getKey: (list: PublishedList) => list.event.pubkey,
  eventToItem: (event: TrustedEvent) => readList(asDecryptedEvent(event)) as PublishedList,
})

export const getMembershipsByPubkey = getter(membershipsByPubkey)

export const getMembership = (pubkey: string) => getMembershipsByPubkey().get(pubkey)

export const loadMembership = makeLoadItem(makeOutboxLoader(ROOMS), getMembership)

export const deriveMembership = makeDeriveItem(membershipsByPubkey, loadMembership)

export const membersByUrl = derived(
  [defaultPubkeys, membershipsByPubkey],
  ([$defaultPubkeys, $membershipsByPubkey]) => {
    const $membersByUrl = new Map<string, Set<string>>()

    for (const pubkey of $defaultPubkeys) {
      for (const url of getMembershipUrls($membershipsByPubkey.get(pubkey))) {
        addToMapKey($membersByUrl, url, pubkey)
      }
    }

    return $membersByUrl
  },
)

// Chats

export const chatMessages = deriveEventsAsc(
  deriveEventsById({
    repository,
    filters: [{kinds: [DIRECT_MESSAGE, DIRECT_MESSAGE_FILE]}],
  }),
)

export type Chat = {
  id: string
  pubkeys: string[]
  messages: TrustedEvent[]
  last_activity: number
  search_text: string
}

export const makeChatId = (pubkeys: string[]) => sort(uniq(pubkeys)).join(",")

export const splitChatId = (id: string) => id.split(",")

export const makeChannelId = (url: string, room: string) => makeRoomId(url, room)

export const splitChannelId = (id: string) => splitRoomId(id)

export const chatsById = call(() => {
  const chatsById = new Map<string, Chat>()

  const addChat = (chat: Chat) => {
    chatsById.set(chat.id, chat)
  }

  return readable(chatsById, set => {
    const publish = () => set(chatsById)

    const addEvents = (events: TrustedEvent[]) => {
      let changed = false

      for (const event of events) {
        if ([DIRECT_MESSAGE, DIRECT_MESSAGE_FILE].includes(event.kind)) {
          const pubkeys = getPubkeyTagValues(event.tags).concat(event.pubkey)
          const id = makeChatId(pubkeys)

          if (!chatsById.has(id)) {
            addChat({
              id,
              pubkeys,
              messages: [event],
              last_activity: event.created_at,
              search_text: pubkeys.join(" "),
            })
            changed = true
          } else {
            const chat = chatsById.get(id)!

            if (!chat.messages.some(e => e.id === event.id)) {
              chat.messages.push(event)
              chat.last_activity = Math.max(chat.last_activity, event.created_at)
              changed = true
            }
          }
        }
      }

      if (changed) {
        publish()
      }
    }

    addEvents(repository.query([{kinds: [DIRECT_MESSAGE, DIRECT_MESSAGE_FILE]}]) as TrustedEvent[])

    const unsubscribers = [
      on(repository, "update", ({added}: RepositoryUpdate) => addEvents(Array.from(added))),
    ]

    return () => unsubscribers.forEach(call)
  })
})

export const chatSearch = derived(throttled(800, chatsById), $chatsById =>
  createSearch(Array.from($chatsById.values()), {
    getValue: (chat: Chat) => chat.id,
    fuseOptions: {keys: ["search_text"]},
  }),
)

export const deriveChat = (pubkeys: string[]) =>
  derived(chatsById, $chatsById => $chatsById.get(makeChatId(pubkeys)))

export const makeRoomId = (url: string, h: string) => `${url}'${h}`

export const splitRoomId = (id: string) => id.split("'")

export const hasNip29 = (relay?: RelayProfile) =>
  relay?.supported_nips?.map?.(String)?.includes?.("29")

export const roomMetaEventsByIdByUrl = deriveEventsByIdByUrl({
  tracker,
  repository,
  filters: [{kinds: [ROOM_META, ROOM_DELETE]}],
})

export const roomsByUrl = derived(roomMetaEventsByIdByUrl, roomMetaEventsByIdByUrl => {
  const metaByIdByUrl = new Map<string, Map<string, Room>>()

  for (const [url, events] of roomMetaEventsByIdByUrl.entries()) {
    const [metaEvents, deleteEvents] = partition(spec({kind: ROOM_META}), events.values())
    const deletedByH = new Map<string, number>()

    for (const event of deleteEvents) {
      for (const h of getTagValues("h", event.tags)) {
        deletedByH.set(h, max([deletedByH.get(h), event.created_at]))
      }
    }

    for (const event of metaEvents) {
      let meta: any

      try {
        meta = readRoomMeta(event)
      } catch {
        const h = getTagValue("d", event.tags) || getTagValue("h", event.tags)

        if (!h) continue

        const tags = fromPairs(event.tags as any)

        meta = {
          h,
          event,
          name: (tags as any).name || h,
          about: (tags as any).about,
          picture: (tags as any).picture,
          isClosed: Boolean(getTagValue("closed", event.tags)),
          isPrivate: Boolean(getTagValue("private", event.tags)),
        }
      }

      if (gt(deletedByH.get(meta.h), meta.event.created_at)) {
        continue
      }

      let metaById = metaByIdByUrl.get(url)
      if (!metaById) {
        metaById = new Map()
        metaByIdByUrl.set(url, metaById)
      }

      const id = makeRoomId(url, meta.h)

      metaById.set(id, {...meta, url, id})
    }
  }

  const result = new Map<string, Room[]>()

  for (const [url, metaById] of metaByIdByUrl.entries()) {
    result.set(url, Array.from(metaById.values()))
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
    derived(_deriveRoom(makeRoomId(url, h)), room => room || makeRoomMeta({h}))
})

export const displayRoom = (url: string, h: string) => getRoom(makeRoomId(url, h))?.name || h

export const roomComparator = (url: string) => (h: string) => displayRoom(url, h).toLowerCase()

// User space/room lists

export const groupListsByPubkey = deriveItemsByKey({
  repository,
  filters: [{kinds: [ROOMS]}],
  getKey: list => list.event.pubkey,
  eventToItem: (event: TrustedEvent) => readList(asDecryptedEvent(event)),
})

export const getGroupListsByPubkey = getter(groupListsByPubkey)

export const getGroupList = (pubkey: string) => getGroupListsByPubkey().get(pubkey)

export const loadGroupList = makeLoadItem(makeOutboxLoader(ROOMS), getGroupList)

export const deriveGroupList = makeDeriveItem(groupListsByPubkey, loadGroupList)

export const groupListPubkeysByUrl = derived(groupListsByPubkey, $groupListsByPubkey => {
  const result = new Map<string, Set<string>>()

  for (const list of $groupListsByPubkey.values()) {
    const tags = getListTags(list)

    for (const url of getRelayTagValues(tags)) {
      const normalized = safeNormalizeRelayUrl(url)
      if (isRelayUrl(normalized)) {
        addToMapKey(result, normalized, list.event.pubkey)
      }
    }

    for (const tag of getGroupTags(tags)) {
      const normalized = safeNormalizeRelayUrl(tag[2] || "")

      if (isRelayUrl(normalized)) {
        addToMapKey(result, normalized, list.event.pubkey)
      }
    }
  }

  return result
})

export const deriveGroupListPubkeys = (url: string) =>
  derived(groupListPubkeysByUrl, $groupListPubkeysByUrl => new Set($groupListPubkeysByUrl.get(url)))

export const getSpaceUrlsFromGroupList = (groupList: List | undefined) => {
  const tags = getListTags(groupList)
  const urls: string[] = []

  for (const url of getRelayTagValues(tags)) {
    const normalized = safeNormalizeRelayUrl(url)
    if (isRelayUrl(normalized)) {
      urls.push(normalized)
    }
  }

  for (const tag of getGroupTags(tags)) {
    const normalized = safeNormalizeRelayUrl(tag[2] || "")

    if (isRelayUrl(normalized)) {
      urls.push(normalized)
    }
  }

  return uniq(urls)
}

export const getSpaceRoomsFromGroupList = (url: string, groupList: List | undefined) => {
  const rooms: string[] = []

  for (const [_, h, relay] of getGroupTags(getListTags(groupList))) {
    if (url === relay) {
      rooms.push(h)
    }
  }

  return sortBy(roomComparator(url), rooms)
}

export const userGroupList = makeUserData(groupListsByPubkey, loadGroupList)

export const loadUserGroupList = makeUserLoader(loadGroupList)

export const userSpaceUrls = derived(userGroupList, getSpaceUrlsFromGroupList)

export const deriveUserRooms = (url: string) =>
  derived([userGroupList, roomsById], ([$userGroupList, $roomsById]) => {
    const rooms: string[] = []

    for (const h of getSpaceRoomsFromGroupList(url, $userGroupList)) {
      if ($roomsById.has(makeRoomId(url, h))) {
        rooms.push(h)
      }
    }

    return sortBy(roomComparator(url), rooms)
  })

export const deriveOtherRooms = (url: string) =>
  derived([deriveUserRooms(url), roomsByUrl], ([$userRooms, $roomsByUrl]) => {
    const rooms: string[] = []

    for (const {h} of $roomsByUrl.get(url) || []) {
      if (!$userRooms.includes(h)) {
        rooms.push(h)
      }
    }

    return sortBy(roomComparator(url), rooms)
  })

// Space/room memberships

export const deriveSpaceMembers = (url: string) =>
  derived(
    deriveRelaySignedEvents(url, [{kinds: [RELAY_ADD_MEMBER, RELAY_REMOVE_MEMBER, RELAY_MEMBERS]}]),
    $events => {
      const membersEvent = $events.find(spec({kind: RELAY_MEMBERS}))

      if (membersEvent) {
        return uniq(getTagValues("member", membersEvent.tags))
      }

      const members = new Set<string>()

      for (const event of sortBy((e: TrustedEvent) => e.created_at, $events)) {
        const pubkeys = getPubkeyTagValues(event.tags)

        if (event.kind === RELAY_ADD_MEMBER) {
          for (const pubkey of pubkeys) {
            members.add(pubkey)
          }
        }

        if (event.kind === RELAY_REMOVE_MEMBER) {
          for (const pubkey of pubkeys) {
            members.delete(pubkey)
          }
        }
      }

      return Array.from(members)
    },
  )

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

export const deriveRoomMembers = (url: string, h: string) => {
  const filters: Filter[] = [
    {kinds: [ROOM_MEMBERS], "#d": [h]},
    {kinds: [ROOM_ADD_MEMBER, ROOM_REMOVE_MEMBER], "#h": [h]},
  ]

  return derived(deriveEventsForUrl(url, filters), $events => {
    const membersEvent = find(spec({kind: ROOM_MEMBERS}), $events)

    if (membersEvent) {
      return uniq(getPubkeyTagValues(membersEvent.tags))
    }

    const members = new Set<string>()

    for (const event of sortBy((e: TrustedEvent) => -e.created_at, $events)) {
      const pubkeys = getPubkeyTagValues(event.tags)

      if (event.kind === ROOM_ADD_MEMBER) {
        for (const pubkey of pubkeys) {
          members.add(pubkey)
        }
      }

      if (event.kind === ROOM_REMOVE_MEMBER) {
        for (const pubkey of pubkeys) {
          members.delete(pubkey)
        }
      }
    }

    return Array.from(members)
  })
}

export const deriveRoomAdmins = (url: string, h: string) => {
  const filters: Filter[] = [{kinds: [ROOM_ADMINS], "#d": [h]}]

  return derived(deriveEventsForUrl(url, filters), $events => {
    const adminsEvent = first($events)

    if (adminsEvent) {
      return getPubkeyTagValues(adminsEvent.tags)
    }

    return []
  })
}

// User membership status

export enum MembershipStatus {
  Initial,
  Pending,
  Granted,
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

export const deriveUserSpaceMembershipStatus = (url: string) => {
  const filters: Filter[] = [{kinds: [RELAY_JOIN, RELAY_LEAVE]}]

  return derived(
    [
      pubkey,
      deriveSpaceMembers(url),
      deriveEventsForUrl(url, filters),
      deriveUserIsSpaceAdmin(url),
    ],
    ([$pubkey, $members, $events, $isAdmin]) => {
      const isMember = $members.includes($pubkey!) || $isAdmin

      for (const event of $events) {
        if (event.pubkey !== $pubkey) {
          continue
        }

        if (event.kind === RELAY_JOIN) {
          return isMember ? MembershipStatus.Granted : MembershipStatus.Pending
        }

        if (event.kind === RELAY_LEAVE) {
          return MembershipStatus.Initial
        }
      }

      return isMember ? MembershipStatus.Granted : MembershipStatus.Initial
    },
  )
}

export const deriveUserIsRoomAdmin = (url: string, h: string) =>
  derived(
    [pubkey, deriveRoomAdmins(url, h), deriveUserIsSpaceAdmin(url)],
    ([$pubkey, $admins, $isSpaceAdmin]) => $isSpaceAdmin || $admins.includes($pubkey!),
  )

export const deriveUserRoomMembershipStatus = (url: string, h: string) => {
  const filters: Filter[] = [{kinds: [ROOM_JOIN, ROOM_LEAVE], "#h": [h]}]

  return derived(
    [
      pubkey,
      deriveRoomMembers(url, h),
      deriveEventsForUrl(url, filters),
      deriveUserIsRoomAdmin(url, h),
    ],
    ([$pubkey, $members, $events, $isAdmin]) => {
      const isMember = $members.includes($pubkey!) || $isAdmin

      for (const event of $events) {
        if (event.pubkey !== $pubkey) {
          continue
        }

        if (event.kind === ROOM_JOIN) {
          return isMember ? MembershipStatus.Granted : MembershipStatus.Pending
        }

        if (event.kind === ROOM_LEAVE) {
          return MembershipStatus.Initial
        }
      }

      return isMember ? MembershipStatus.Granted : MembershipStatus.Initial
    },
  )
}

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
  const isStrictNip29Relay = error.includes("missing group (`h`) tag")

  return isIgnored || isAborted || isStrictNip29Relay
}

export const deriveRelayAuthError = (url: string, claim = "") => {
  const stripPrefix = (m: string) => m.replace(/^\w+: /, "")

  // Kick off the auth process
  Pool.get().get(url).auth.attemptAuth(sign)

  // Attempt to join the relay
  const thunk = publishThunk({
    event: makeEvent(RELAY_JOIN, {tags: [["claim", claim]]}),
    relays: [url],
  })

  return derived(
    [thunk, relaysMostlyRestricted, deriveSocket(url)],
    ([$thunk, $relaysMostlyRestricted, $socket]) => {
      if ($socket.auth.status === AuthStatus.Forbidden && $socket.auth.details) {
        return stripPrefix($socket.auth.details)
      }

      if ($relaysMostlyRestricted[url]) {
        return stripPrefix($relaysMostlyRestricted[url])
      }

      const error = getThunkError($thunk)

      if (error) {
        const isEmptyInvite = !claim && error.includes("invite code")

        if (!shouldIgnoreError(error) && !isEmptyInvite) {
          return stripPrefix(error) || "join request rejected"
        }
      }
    },
  )
}

export type InviteData = {url: string; claim: string}

export const parseInviteLink = (invite: string): InviteData | undefined =>
  tryCatch(() => {
    const {r: relay = "", c: claim = ""} = fromPairs(Array.from(new URL(invite).searchParams))
    const url = normalizeRelayUrl(relay)

    if (isRelayUrl(url)) {
      return {url, claim}
    }
  }) ||
  tryCatch(() => {
    const url = normalizeRelayUrl(invite)

    if (isRelayUrl(url)) {
      return {url, claim: ""}
    }
  })
