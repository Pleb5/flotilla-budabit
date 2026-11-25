import {derived, readable, type Readable} from "svelte/store"
import {displayProfileByPubkey, getMutes, pubkey} from "@welshman/app"
import {request} from "@welshman/net"
import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
import {
  getTagValue,
  isRelayUrl,
  normalizeRelayUrl,
  type Filter,
  type TrustedEvent,
} from "@welshman/util"
import {
  catchUpThenSetBackgroundLive,
  createBackgroundLiveCoordinator,
} from "@app/core/background-live"
import {normalizePubkey} from "@app/core/community"
import type {ActiveUserCommunityRef, UserCommunityReportStates} from "@app/core/community-membership"
import {getCommunitySectionAuthorityPubkeys} from "@app/core/community-permissions"
import {
  isAuthorizedCommunitySharedConfigEvent,
  type CommunitySharedConfigDescriptorAuthority,
} from "@app/extensions/community-shared-config"
import {notificationBackgroundEnabled} from "@app/util/notification-background"
import {
  buildNotificationSearchText,
  getNotificationSourceLabel,
  sortNotificationRows,
  type NotificationRow,
} from "@app/util/notification-display"
import {notificationEventRepository, receiveNotificationEvent} from "@app/util/notification-events"
import {makeExactCommunityPath} from "@app/util/routes"

export const COMMUNITY_CALL_CONFIG_KIND = 30078
export const COMMUNITY_LIVE_STREAM_KIND = 30311
export const COMMUNITY_SHARED_CONFIG_PREFIX = "budabit-community-config"
export const COMMUNITY_CALL_NAMESPACE = "budabit-community-call"
export const COMMUNITY_CALL_KEY = "active-call"
export const COMMUNITY_STREAM_TAG_PREFIX = "budabit-community:"
export const DEFAULT_HIVETALK_BASE = "https://calls.budabit.club"
export const CALL_LIFETIME_SECONDS = 4 * 60 * 60
export const MAX_CLOCK_SKEW_SECONDS = 5 * 60

export const DEFAULT_TRUSTED_LIVE_STREAM_PROVIDER_PUBKEYS = [
  "cf45a6ba1363ad7ed213a078e710d24115ae721c9b47bd1ebf4458eaefb4c2a5",
  "81ee947168db2f909895dbd4f71534f4040035575f58156e9a3802d1dd467e1d",
  "f6a25b87f7e7bec9a691e37851b1b57a7b49fa00bb431280303002a3ebca4891",
  "85df822a86599ffbe8143db1e1e1bf2d162fa60fc685c65515963e67cfd7499f",
]

const configuredTrustedLiveStreamProviders = String(
  import.meta.env?.VITE_TRUSTED_LIVE_STREAM_PROVIDER_PUBKEYS || "",
)
  .split(",")
  .map(normalizePubkey)
  .filter(Boolean)

export const TRUSTED_LIVE_STREAM_PROVIDER_PUBKEYS = new Set(
  configuredTrustedLiveStreamProviders.length > 0
    ? configuredTrustedLiveStreamProviders
    : DEFAULT_TRUSTED_LIVE_STREAM_PROVIDER_PUBKEYS,
)

export type LiveCallNotificationPayload = {
  status: "live"
  title: string
  room: string
  roomPassword?: string
  hivetalkBase: string
  startedAt: number
  expiresAt: number
  startedBy: string
  audio: 0 | 1
  video: 0 | 1
}

export type BuildCommunityLiveNotificationRowsOptions = {
  refs: ActiveUserCommunityRef[]
  events: TrustedEvent[]
  profileListEvents?: TrustedEvent[]
  reportStates?: UserCommunityReportStates
  currentPubkey?: string
  mutedPubkeys?: string[]
  viewerName?: string
  trustedProviders?: ReadonlySet<string>
  now?: number
}

const normalizeRelay = (relay: string) => {
  try {
    const normalized = normalizeRelayUrl(relay)
    return isRelayUrl(normalized) ? normalized : ""
  } catch {
    return ""
  }
}

const getReportState = (states: UserCommunityReportStates | undefined, communityAddress: string) =>
  states instanceof Map ? states.get(communityAddress) : states?.[communityAddress]

const isPreferredEvent = (candidate: TrustedEvent, current: TrustedEvent | undefined) => {
  if (!current) return true
  if ((candidate.created_at || 0) !== (current.created_at || 0)) {
    return (candidate.created_at || 0) > (current.created_at || 0)
  }

  return String(candidate.id || "") < String(current.id || "")
}

const getCommunityDescriptorAuthorities = ({
  ref,
  profileListEvents = [],
  reportStates,
}: {
  ref: ActiveUserCommunityRef
  profileListEvents?: TrustedEvent[]
  reportStates?: UserCommunityReportStates
}): {
  authorities: CommunitySharedConfigDescriptorAuthority[]
  moderatorPubkeys: Set<string>
} => {
  const reportState = getReportState(reportStates, ref.community.address)
  const authorities: CommunitySharedConfigDescriptorAuthority[] = []
  const moderatorPubkeys = new Set<string>()
  const owner = normalizePubkey(ref.definition.ownerPubkey)
  if (owner) moderatorPubkeys.add(owner)

  for (const section of ref.definition.sections) {
    const sectionModerators = getCommunitySectionAuthorityPubkeys({
      definition: ref.definition,
      sectionName: section.name,
      profileListEvents,
      reportState,
    })
      .map(normalizePubkey)
      .filter(Boolean)

    for (const mod of sectionModerators) moderatorPubkeys.add(mod)

    for (const kindEntry of section.kinds) {
      if (!Number.isFinite(kindEntry.kind)) continue
      authorities.push({
        descriptor: kindEntry.subtype
          ? {kind: Math.floor(kindEntry.kind), subtype: kindEntry.subtype}
          : {kind: Math.floor(kindEntry.kind)},
        moderatorPubkeys: sectionModerators,
      })
    }
  }

  return {authorities, moderatorPubkeys}
}

export const makeCommunityCallConfigIdentifier = (communityAddress: string) =>
  `${COMMUNITY_SHARED_CONFIG_PREFIX}:${communityAddress}:${COMMUNITY_CALL_NAMESPACE}:${COMMUNITY_CALL_KEY}`

const normalizeRoomId = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)

const normalizeHivetalkBase = (value: string) => {
  const trimmed = value.trim() || DEFAULT_HIVETALK_BASE
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(withProtocol)
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1"
    return url.protocol === "https:" || (local && url.protocol === "http:")
      ? url.origin
      : DEFAULT_HIVETALK_BASE
  } catch {
    return DEFAULT_HIVETALK_BASE
  }
}

export const parseLiveCallNotificationConfig = (
  content: string,
  now = Math.floor(Date.now() / 1000),
): LiveCallNotificationPayload | null => {
  let raw: Record<string, unknown>
  try {
    const parsed = JSON.parse(content)
    if (!parsed || typeof parsed !== "object") return null
    raw = parsed as Record<string, unknown>
  } catch {
    return null
  }

  if (raw.status !== "live" || typeof raw.room !== "string") return null
  const room = normalizeRoomId(raw.room)
  if (!room) return null

  const startedAt = raw.startedAt
  if (
    typeof startedAt !== "number" ||
    !Number.isSafeInteger(startedAt) ||
    startedAt <= 0 ||
    startedAt > now + MAX_CLOCK_SKEW_SECONDS
  ) {
    return null
  }

  if (
    raw.expiresAt !== undefined &&
    (typeof raw.expiresAt !== "number" || !Number.isSafeInteger(raw.expiresAt))
  ) {
    return null
  }

  const expiresAt = (raw.expiresAt as number | undefined) ?? startedAt + CALL_LIFETIME_SECONDS
  if (
    expiresAt <= startedAt ||
    expiresAt > startedAt + CALL_LIFETIME_SECONDS ||
    expiresAt <= now
  ) {
    return null
  }

  const roomPassword =
    typeof raw.roomPassword === "string" && raw.roomPassword.trim()
      ? raw.roomPassword.trim()
      : undefined

  return {
    status: "live",
    title:
      typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : "Community call",
    room,
    ...(roomPassword ? {roomPassword} : {}),
    hivetalkBase:
      typeof raw.hivetalkBase === "string"
        ? normalizeHivetalkBase(raw.hivetalkBase)
        : DEFAULT_HIVETALK_BASE,
    startedAt,
    expiresAt,
    startedBy: typeof raw.startedBy === "string" ? normalizePubkey(raw.startedBy) : "",
    audio: raw.audio === 0 ? 0 : 1,
    video: raw.video === 0 ? 0 : 1,
  }
}

export const buildHivetalkNotificationJoinUrl = (
  call: LiveCallNotificationPayload,
  viewerName = "",
) => {
  const url = new URL("/join", normalizeHivetalkBase(call.hivetalkBase))
  url.searchParams.set("room", call.room)
  url.searchParams.set("roomPassword", call.roomPassword || "0")
  const cleanName = viewerName.trim().slice(0, 56)
  if (cleanName) url.searchParams.set("name", cleanName)
  url.searchParams.set("audio", String(call.audio))
  url.searchParams.set("video", String(call.video))
  url.searchParams.set("screen", "0")
  url.searchParams.set("notify", "1")
  return url.toString()
}

export const makeCommunityNsiteUrl = (ownerPubkey: string, site: "call" | "stream") => {
  const normalized = normalizePubkey(ownerPubkey)
  if (!normalized) return ""
  const pubkeyB36 = BigInt(`0x${normalized}`).toString(36).padStart(50, "0")
  return `https://${pubkeyB36}${site}.nsite.run/`
}

const hasCommunityStreamTag = (event: TrustedEvent, communityId: string) => {
  const normalized = communityId.trim().toLowerCase()
  const marker = `${COMMUNITY_STREAM_TAG_PREFIX}${normalized}`

  return event.tags.some(tag => {
    const key = String(tag[0] || "").toLowerCase()
    const value = String(tag[1] || "")
      .trim()
      .toLowerCase()
    return (
      (key === "h" && value === normalized) ||
      (key === "t" && (value === marker || value === normalized))
    )
  })
}

const getStreamHostPubkey = (event: TrustedEvent, trustedProviders: ReadonlySet<string>) => {
  const author = normalizePubkey(event.pubkey)
  if (!trustedProviders.has(author)) return author
  const host = event.tags.find(
    tag => tag[0] === "p" && Boolean(tag[1]) && String(tag[3] || "").toLowerCase() === "host",
  )?.[1]
  return normalizePubkey(host || "") || author
}

export const buildCommunityLiveCallNotificationRows = ({
  refs,
  events,
  profileListEvents = [],
  reportStates,
  currentPubkey,
  mutedPubkeys = [],
  viewerName = "",
  now = Math.floor(Date.now() / 1000),
}: BuildCommunityLiveNotificationRowsOptions): NotificationRow[] => {
  const current = normalizePubkey(currentPubkey || "")
  const muted = new Set(mutedPubkeys.map(normalizePubkey).filter(Boolean))
  const rows: NotificationRow[] = []

  for (const ref of refs) {
    const expectedD = makeCommunityCallConfigIdentifier(ref.community.address)
    const {authorities} = getCommunityDescriptorAuthorities({ref, profileListEvents, reportStates})
    if (authorities.length === 0) continue

    let latest: TrustedEvent | undefined
    for (const event of events) {
      if (event.kind !== COMMUNITY_CALL_CONFIG_KIND) continue
      if (getTagValue("d", event.tags) !== expectedD) continue
      if (
        !isAuthorizedCommunitySharedConfigEvent({
          event,
          descriptorAuthorities: authorities,
          allowDescriptorChanges: true,
        })
      ) {
        continue
      }
      if (isPreferredEvent(event, latest)) latest = event
    }

    if (!latest) continue
    const call = parseLiveCallNotificationConfig(latest.content, now)
    if (!call) continue

    const actor = normalizePubkey(call.startedBy || latest.pubkey)
    if (current && actor === current) continue
    if (actor && muted.has(actor)) continue

    const communityName = ref.definition.metadata.name || "Community"
    const communityPath = makeExactCommunityPath(ref.community)
    const directJoinUrl = buildHivetalkNotificationJoinUrl(call, viewerName)

    rows.push({
      id: `community-call:${ref.community.address}:${latest.id}`,
      source: "community",
      sourceLabel: getNotificationSourceLabel("community"),
      type: "community",
      title: "Community call started",
      action: "started a community call in",
      contextLabel: communityName,
      preview: call.title,
      actionLabel: "Join call in browser",
      path: directJoinUrl,
      readPath: communityPath,
      createdAt: latest.created_at || call.startedAt,
      actorPubkey: actor || undefined,
      eventId: latest.id,
      expandable: true,
      target: {
        label: "Dedicated call (HiveTalk)",
        preview: `Join "${call.title}" directly in your browser`,
        path: directJoinUrl,
        actionLabel: "Join in browser",
      },
      detail: {
        label: "Community call widget",
        preview: `Open ${communityName} home to join inside Budabit`,
        path: communityPath,
        actionLabel: "Open community",
      },
      searchText: buildNotificationSearchText(
        "community call",
        "hivetalk",
        communityName,
        call.title,
      ),
    })
  }

  return sortNotificationRows(rows)
}

export const buildCommunityLiveStreamNotificationRows = ({
  refs,
  events,
  profileListEvents = [],
  reportStates,
  currentPubkey,
  mutedPubkeys = [],
  trustedProviders = TRUSTED_LIVE_STREAM_PROVIDER_PUBKEYS,
}: BuildCommunityLiveNotificationRowsOptions): NotificationRow[] => {
  const current = normalizePubkey(currentPubkey || "")
  const muted = new Set(mutedPubkeys.map(normalizePubkey).filter(Boolean))
  const latestByAddress = new Map<string, TrustedEvent>()

  for (const event of events) {
    if (event.kind !== COMMUNITY_LIVE_STREAM_KIND) continue
    const identifier = getTagValue("d", event.tags)
    if (!identifier) continue
    const address = `${COMMUNITY_LIVE_STREAM_KIND}:${event.pubkey}:${identifier}`
    const prev = latestByAddress.get(address)
    if (isPreferredEvent(event, prev)) latestByAddress.set(address, event)
  }

  const latestStreams = Array.from(latestByAddress.values())
  const rows: NotificationRow[] = []

  for (const ref of refs) {
    const {moderatorPubkeys} = getCommunityDescriptorAuthorities({
      ref,
      profileListEvents,
      reportStates,
    })
    if (moderatorPubkeys.size === 0) continue

    const communityName = ref.definition.metadata.name || "Community"
    const communityPath = makeExactCommunityPath(ref.community)
    const standaloneStreamUrl = makeCommunityNsiteUrl(ref.definition.ownerPubkey, "stream")

    for (const event of latestStreams) {
      if (!hasCommunityStreamTag(event, ref.community.communityId)) continue
      const author = normalizePubkey(event.pubkey)
      const direct = moderatorPubkeys.has(author)
      const delegated =
        trustedProviders.has(author) &&
        event.tags.some(
          tag =>
            tag[0] === "p" &&
            moderatorPubkeys.has(normalizePubkey(tag[1] || "")) &&
            String(tag[3] || "").toLowerCase() === "host",
        )
      if (!direct && !delegated) continue

      const status = (getTagValue("status", event.tags) || "").toLowerCase()
      const hasStreamingUrl = event.tags.some(tag => tag[0] === "streaming" && Boolean(tag[1]))
      if (status !== "live" && !(status === "" && hasStreamingUrl)) continue

      const host = getStreamHostPubkey(event, trustedProviders)
      if (current && host === current) continue
      if (host && muted.has(host)) continue

      const title = getTagValue("title", event.tags) || `${communityName} live stream`
      const summary = getTagValue("summary", event.tags) || `Watch "${title}" live`

      rows.push({
        id: `community-stream:${ref.community.address}:${event.id}`,
        source: "community",
        sourceLabel: getNotificationSourceLabel("community"),
        type: "community",
        title: "Live stream started",
        action: "started a live stream in",
        contextLabel: communityName,
        preview: title,
        actionLabel: "Watch stream",
        path: communityPath,
        readPath: communityPath,
        createdAt: event.created_at || 0,
        actorPubkey: host || undefined,
        eventId: event.id,
        expandable: Boolean(standaloneStreamUrl),
        target: {
          label: "Watch in Budabit",
          preview: summary,
          path: communityPath,
          actionLabel: "Open stream widget",
        },
        ...(standaloneStreamUrl
          ? {
              detail: {
                label: "Standalone stream webpage (nsite)",
                preview: `Watch "${title}" in a standalone browser tab`,
                path: standaloneStreamUrl,
                actionLabel: "Open standalone",
              },
            }
          : {}),
        searchText: buildNotificationSearchText(
          "live stream",
          "broadcast",
          communityName,
          title,
          summary,
        ),
      })
    }
  }

  return sortNotificationRows(rows)
}

const communityLiveCoordinator = createBackgroundLiveCoordinator({
  request,
  owner: "community-live",
  onEvent: receiveNotificationEvent,
  onError: (relay, error) => {
    console.warn(`[community-live-notifications] Failed to subscribe on ${relay}`, error)
  },
})

export const createCommunityLiveNotificationRows = ({
  communityRefs,
  profileListEvents,
  reportStates,
}: {
  communityRefs: Readable<ActiveUserCommunityRef[]>
  profileListEvents: Readable<TrustedEvent[]>
  reportStates: Readable<Map<string, any>>
}): Readable<NotificationRow[]> => {
  const liveEvents = readable<TrustedEvent[]>([], set => {
    let previousCacheKey = ""
    let previousNetworkKey = ""
    const controllersByRelay = new Map<string, AbortController>()
    let unsubscribeEvents: (() => void) | undefined
    const liveSource = {}

    const stopNetwork = () => {
      for (const controller of controllersByRelay.values()) controller.abort()
      controllersByRelay.clear()
      communityLiveCoordinator.clear(liveSource)
    }

    const unsubscribeInputs = derived(
      [communityRefs, profileListEvents, reportStates, notificationBackgroundEnabled],
      ([$refs, $profileListEvents, $reportStates, $enabled]) => ({
        refs: $refs,
        profileListEvents: $profileListEvents,
        reportStates: $reportStates,
        enabled: $enabled,
      }),
    ).subscribe(({refs, profileListEvents: lists, reportStates: reports, enabled}) => {
      const filtersByRelay = new Map<string, Filter[]>()
      const cacheFilters: Filter[] = []
      const trusted = Array.from(TRUSTED_LIVE_STREAM_PROVIDER_PUBKEYS)

      for (const ref of refs) {
        const relays = Array.from(
          new Set([...ref.definition.relays, ...ref.relayHints].map(normalizeRelay).filter(Boolean)),
        )
        if (relays.length === 0) continue

        const {moderatorPubkeys} = getCommunityDescriptorAuthorities({
          ref,
          profileListEvents: lists,
          reportStates: reports,
        })
        const moderators = Array.from(moderatorPubkeys).sort()
        if (moderators.length === 0) continue

        const callFilter: Filter = {
          kinds: [COMMUNITY_CALL_CONFIG_KIND],
          authors: moderators,
          "#d": [makeCommunityCallConfigIdentifier(ref.community.address)],
          limit: 10,
        }
        const streamAuthors = Array.from(new Set([...moderators, ...trusted])).sort()
        const streamFilter: Filter = {
          kinds: [COMMUNITY_LIVE_STREAM_KIND],
          authors: streamAuthors,
          limit: 50,
        }

        cacheFilters.push(
          {
            kinds: [COMMUNITY_CALL_CONFIG_KIND],
            authors: moderators,
            "#d": [makeCommunityCallConfigIdentifier(ref.community.address)],
          },
          {
            kinds: [COMMUNITY_LIVE_STREAM_KIND],
            authors: streamAuthors,
          },
        )

        for (const relay of relays) {
          const list = filtersByRelay.get(relay) || []
          list.push(callFilter, streamFilter)
          filtersByRelay.set(relay, list)
        }
      }

      const cacheKey = JSON.stringify(cacheFilters)
      if (cacheKey !== previousCacheKey) {
        previousCacheKey = cacheKey
        unsubscribeEvents?.()
        unsubscribeEvents = undefined

        if (cacheFilters.length > 0) {
          unsubscribeEvents = deriveEventsAsc(
            deriveEventsById({repository: notificationEventRepository, filters: cacheFilters}),
          ).subscribe(events => set(events as TrustedEvent[]))
        } else {
          set([])
        }
      }

      const groups = Array.from(filtersByRelay.entries()).sort(([a], [b]) => a.localeCompare(b))
      const networkKey = JSON.stringify({enabled, groups})
      if (networkKey === previousNetworkKey) return
      previousNetworkKey = networkKey
      stopNetwork()

      if (!enabled) return

      for (const [relay, filters] of groups) {
        const controller = new AbortController()
        controllersByRelay.set(relay, controller)

        void catchUpThenSetBackgroundLive({
          request,
          coordinator: communityLiveCoordinator,
          source: liveSource,
          relay,
          filters,
          liveFilters: filters,
          signal: controller.signal,
          onEvent: receiveNotificationEvent,
          onError: error => {
            if (!controller.signal.aborted) {
              console.warn("[community-live-notifications] Failed to load live updates", error)
            }
          },
        })
      }
    })

    return () => {
      stopNetwork()
      unsubscribeEvents?.()
      unsubscribeInputs()
    }
  })

  return derived(
    [pubkey, communityRefs, liveEvents, profileListEvents, reportStates],
    ([$pubkey, $refs, $events, $profileListEvents, $reportStates]) => {
      const currentPubkey = $pubkey || undefined
      const mutedPubkeys = $pubkey ? getMutes($pubkey) : []
      const viewerName = $pubkey ? displayProfileByPubkey($pubkey) || "" : ""

      return sortNotificationRows([
        ...buildCommunityLiveCallNotificationRows({
          refs: $refs,
          events: $events,
          profileListEvents: $profileListEvents,
          reportStates: $reportStates,
          currentPubkey,
          mutedPubkeys,
          viewerName,
        }),
        ...buildCommunityLiveStreamNotificationRows({
          refs: $refs,
          events: $events,
          profileListEvents: $profileListEvents,
          reportStates: $reportStates,
          currentPubkey,
          mutedPubkeys,
        }),
      ])
    },
  )
}
