import * as nip19 from "nostr-tools/nip19"
import type {EventContent, TrustedEvent} from "@welshman/util"
import {
  BADGE_DEFINITION,
  EVENT_DATE,
  EVENT_TIME,
  isRelayUrl,
  normalizeRelayUrl,
} from "@welshman/util"
import {parseOwnerPubkey} from "./community-protocol"

export * from "./community-protocol"

export const PROFILE_LIST_KIND = 30000
export const FORM_TEMPLATE_KIND = 30168
export const FORM_RESPONSE_KIND = 1069
export const COMMUNITY_EMAIL_DIGEST_HANDLER_KIND = 31990
export const PROFILE_LIST_STATUS_DECLINED = "declined"
export const RENOUNCED_COMMUNITIES_DTAG = "app/budabit/renounced-communities"

export const COMMUNITY_SECTION_GENERAL = "General"
export const COMMUNITY_SECTION_ROOMS = "Room-creator"
export const COMMUNITY_SECTION_THREADS = "Thread-creator"
export const COMMUNITY_SECTION_CALENDAR = "Calendar-event-creator"
export const COMMUNITY_SECTION_GOALS = "Fundraiser-goals-creator"
export const COMMUNITY_SECTION_REPO_CURATOR = "Code-curator"
export const COMMUNITY_SECTION_WIDGETS = "Widget-curator"
export const COMMUNITY_SECTION_FREELANCE = "Freelance"

export const COMMUNITY_SUBTYPE_ROOM = "room"
export const COMMUNITY_SUBTYPE_THREADS = "threads"
export const COMMUNITY_SUBTYPE_ROOM_MESSAGE = "room-message"

export const normalizeCommunitySectionName = (name: string) => name.trim()

export const normalizeCommunitySectionSubtype = (subtype?: string) => {
  const trimmed = subtype?.trim()
  if (!trimmed) return undefined

  return trimmed
}

export const getCommunitySectionKindKey = (kind: number, subtype?: string) =>
  `${kind}:${normalizeCommunitySectionSubtype(subtype) || ""}`

export const getCommunitySectionKindLabel = (kind: number, subtype?: string) => {
  const normalizedSubtype = normalizeCommunitySectionSubtype(subtype)

  return normalizedSubtype ? `${kind}/${normalizedSubtype}` : String(kind)
}

export const TARGETED_PUBLICATION_KINDS = [EVENT_DATE, EVENT_TIME, 9041, 1623, 30033] as const

export type AddressRef = {
  kind: number
  pubkey: string
  identifier: string
  address: string
}

export type CommunitySectionKind = {
  kind: number
  subtype?: string
}

export const normalizeCommunitySectionKind = (
  sectionKind: CommunitySectionKind,
): CommunitySectionKind => {
  const subtype = normalizeCommunitySectionSubtype(sectionKind.subtype)

  return subtype ? {kind: sectionKind.kind, subtype} : {kind: sectionKind.kind}
}

export const communitySectionKindsMatch = (
  sectionKind: CommunitySectionKind,
  kind: number,
  subtype?: string,
) =>
  sectionKind.kind === kind &&
  getCommunitySectionKindKey(sectionKind.kind, sectionKind.subtype) ===
    getCommunitySectionKindKey(kind, subtype)

export type CommunityProfileListRef = AddressRef & {
  relay?: string
}

export type CommunityBadgeRef = AddressRef

export type CommunityRetentionPolicy = {
  kind: number
  value: number
  type: "time" | "count"
}

export type CommunitySection = {
  name: string
  kinds: CommunitySectionKind[]
  profileLists: CommunityProfileListRef[]
  badges: CommunityBadgeRef[]
  retention: CommunityRetentionPolicy[]
}

export type CommunityMint = {
  url: string
  type?: string
}

export type CommunityTos = {
  ref: string
  relay?: string
}

export type CommunityServiceDescriptor = {
  servicePubkey: string
  requestRelay: string
  handlerAddress: string
  handlerRelay: string
}

export type CommunityEmailDigestService = CommunityServiceDescriptor
export type CommunityAlertService = CommunityServiceDescriptor

export type CommunityOtherServiceTag = ["service", ...string[]]

export type CommunitySectionKindAssignment = {
  key: string
  label: string
  kind: number
  subtype?: string
  sectionName: string
  sectionIndex: number
  kindIndex: number
}

const HEX_PUBKEY_RE = /^[0-9a-f]{64}$/i
const GEOHASH_RE = /^[0123456789bcdefghjkmnpqrstuvwxyz]+$/i
const hasCommunityServiceControlCharacter = (value: string) =>
  Array.from(value).some(character => {
    const code = character.charCodeAt(0)
    return code <= 0x1f || code === 0x7f
  })
const COMMUNITY_SERVICE_MAX_URL_LENGTH = 2048
const COMMUNITY_SERVICE_MAX_ADDRESS_LENGTH = 350
const COMMUNITY_SERVICE_MAX_IDENTIFIER_LENGTH = 200

export const isHexPubkey = (value: string) => HEX_PUBKEY_RE.test(value)

export const normalizePubkey = (value: string) => {
  const trimmed = value.trim()
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

export const normalizeRelay = (url?: string) => {
  if (!url) return ""

  try {
    const normalized = normalizeRelayUrl(url)
    return isRelayUrl(normalized) ? normalized : ""
  } catch {
    return ""
  }
}

export const normalizeRelays = (relays: string[]) =>
  Array.from(new Set(relays.map(normalizeRelay).filter(Boolean)))

export const normalizeCommunityServiceRelay = (value: string) => {
  const trimmed = value.trim()
  if (
    value.length > COMMUNITY_SERVICE_MAX_URL_LENGTH ||
    !/^wss:\/\//i.test(trimmed) ||
    hasCommunityServiceControlCharacter(trimmed)
  ) {
    return ""
  }

  try {
    const url = new URL(trimmed)
    if (url.protocol !== "wss:" || !url.hostname || url.username || url.password || url.hash) {
      return ""
    }
    const rootUrl = url.pathname === "/" && !url.search
    let normalized = url.toString()
    if (rootUrl) normalized = normalized.slice(0, -1)
    const transportNormalized = normalizeRelayUrl(normalized)
    return normalized.length <= COMMUNITY_SERVICE_MAX_URL_LENGTH &&
      isRelayUrl(transportNormalized) &&
      (rootUrl ? transportNormalized.replace(/\/$/, "") : transportNormalized) === normalized
      ? normalized
      : ""
  } catch {
    return ""
  }
}

export const normalizeCommunityServiceHandlerAddress = (value: string) => {
  const trimmed = value.trim()
  if (
    value.length > COMMUNITY_SERVICE_MAX_ADDRESS_LENGTH ||
    hasCommunityServiceControlCharacter(trimmed)
  ) {
    return ""
  }
  const [kind, pubkey, ...identifierParts] = trimmed.split(":")
  const identifier = identifierParts.join(":")

  if (kind !== String(COMMUNITY_EMAIL_DIGEST_HANDLER_KIND)) return ""
  if (
    !pubkey ||
    !isHexPubkey(pubkey) ||
    !identifier ||
    identifier.length > COMMUNITY_SERVICE_MAX_IDENTIFIER_LENGTH ||
    hasCommunityServiceControlCharacter(identifier)
  ) {
    return ""
  }

  return `${COMMUNITY_EMAIL_DIGEST_HANDLER_KIND}:${pubkey.toLowerCase()}:${identifier}`
}

export const normalizeCommunityEmailDigestHandlerAddress = normalizeCommunityServiceHandlerAddress
export const normalizeCommunityAlertHandlerAddress = normalizeCommunityServiceHandlerAddress

export const normalizeCommunityServiceDescriptor = <T extends CommunityServiceDescriptor>(
  service: T,
): T | undefined => {
  const servicePubkey =
    typeof service?.servicePubkey === "string" ? service.servicePubkey.trim() : ""
  const requestRelay = normalizeCommunityServiceRelay(
    typeof service?.requestRelay === "string" ? service.requestRelay : "",
  )
  const handlerAddress = normalizeCommunityServiceHandlerAddress(
    typeof service?.handlerAddress === "string" ? service.handlerAddress : "",
  )
  const handlerRelay = normalizeCommunityServiceRelay(
    typeof service?.handlerRelay === "string" ? service.handlerRelay : "",
  )

  if (!isHexPubkey(servicePubkey) || !requestRelay || !handlerAddress || !handlerRelay) {
    return undefined
  }

  return {
    servicePubkey: servicePubkey.toLowerCase(),
    requestRelay,
    handlerAddress,
    handlerRelay,
  } as T
}

export const normalizeCommunityEmailDigestService = (
  service: CommunityEmailDigestService,
): CommunityEmailDigestService | undefined => normalizeCommunityServiceDescriptor(service)

export const normalizeCommunityAlertService = (
  service: CommunityAlertService,
): CommunityAlertService | undefined => normalizeCommunityServiceDescriptor(service)

export const getCommunityServiceDescriptorKey = (service: CommunityServiceDescriptor) => {
  const normalized = normalizeCommunityServiceDescriptor(service)

  return normalized
    ? JSON.stringify([
        normalized.servicePubkey,
        normalized.requestRelay,
        normalized.handlerAddress,
        normalized.handlerRelay,
      ])
    : ""
}

export const getCommunityEmailDigestServiceDescriptorKey = getCommunityServiceDescriptorKey
export const getCommunityAlertServiceDescriptorKey = getCommunityServiceDescriptorKey

export const normalizeGeohash = (value?: string) => {
  const normalized = value?.trim().replace(/^geo:/i, "").toLowerCase() || ""

  return normalized && GEOHASH_RE.test(normalized) ? normalized : ""
}

export const getCommunitySectionKindAssignments = (
  sections: Array<Pick<CommunitySection, "name" | "kinds">>,
): CommunitySectionKindAssignment[] =>
  sections.flatMap((section, sectionIndex) =>
    section.kinds.map((sectionKind, kindIndex) => {
      const normalizedKind = normalizeCommunitySectionKind(sectionKind)

      return {
        key: getCommunitySectionKindKey(normalizedKind.kind, normalizedKind.subtype),
        label: getCommunitySectionKindLabel(normalizedKind.kind, normalizedKind.subtype),
        kind: normalizedKind.kind,
        subtype: normalizedKind.subtype,
        sectionName: section.name,
        sectionIndex,
        kindIndex,
      }
    }),
  )

export const getDuplicateCommunitySectionKindAssignments = (
  sections: Array<Pick<CommunitySection, "name" | "kinds">>,
) => {
  const seen = new Map<string, CommunitySectionKindAssignment>()
  const duplicates: CommunitySectionKindAssignment[] = []

  for (const assignment of getCommunitySectionKindAssignments(sections)) {
    const previous = seen.get(assignment.key)
    if (previous) {
      if (!duplicates.includes(previous)) duplicates.push(previous)
      duplicates.push(assignment)
      continue
    }

    seen.set(assignment.key, assignment)
  }

  return duplicates
}

export const getDefaultCommunitySectionKinds = (name: string): CommunitySectionKind[] => {
  switch (normalizeCommunitySectionName(name)) {
    case COMMUNITY_SECTION_GENERAL:
      return [
        {kind: 9, subtype: COMMUNITY_SUBTYPE_ROOM_MESSAGE},
        {kind: 1111},
        {kind: 7},
        {kind: 1984},
        {kind: 1985},
      ]
    case COMMUNITY_SECTION_ROOMS:
      return [{kind: 11, subtype: COMMUNITY_SUBTYPE_ROOM}]
    case COMMUNITY_SECTION_THREADS:
      return [{kind: 11, subtype: COMMUNITY_SUBTYPE_THREADS}]
    case COMMUNITY_SECTION_CALENDAR:
      return [{kind: EVENT_DATE}, {kind: EVENT_TIME}]
    case COMMUNITY_SECTION_GOALS:
      return [{kind: 9041}]
    case COMMUNITY_SECTION_REPO_CURATOR:
      return [{kind: 30617}, {kind: 1623}]
    case COMMUNITY_SECTION_WIDGETS:
      return [{kind: 30033}]
    case COMMUNITY_SECTION_FREELANCE:
      return [{kind: 32765}, {kind: 32766}, {kind: 32767}, {kind: 32768}, {kind: 1986}]
    default:
      return []
  }
}

export const DEFAULT_COMMUNITY_SECTION_NAMES = [
  COMMUNITY_SECTION_GENERAL,
  COMMUNITY_SECTION_ROOMS,
  COMMUNITY_SECTION_THREADS,
  COMMUNITY_SECTION_CALENDAR,
  COMMUNITY_SECTION_GOALS,
  COMMUNITY_SECTION_REPO_CURATOR,
  COMMUNITY_SECTION_WIDGETS,
] as const

export const makeAddress = (kind: number, pubkey: string, identifier: string) =>
  `${kind}:${normalizePubkey(pubkey)}:${identifier}`

export const makeCommunityBadgeDefinition = ({
  badge,
  name,
  description,
  image,
}: {
  badge: CommunityBadgeRef
  name?: string
  description?: string
  image?: string
}): EventContent & {kind: typeof BADGE_DEFINITION} => ({
  kind: BADGE_DEFINITION,
  content: "",
  tags: [
    ["d", badge.identifier],
    ["name", name?.trim() || badge.identifier],
    ...(description?.trim() ? [["description", description.trim()]] : []),
    ...(image?.trim() ? [["image", image.trim()]] : []),
  ],
})

export const parseAddressRef = (address: string): AddressRef | undefined => {
  const [kindValue, pubkeyValue, ...identifierParts] = address.split(":")
  const kind = Number.parseInt(kindValue, 10)
  const pubkey = normalizePubkey(pubkeyValue || "")
  const identifier = identifierParts.join(":")

  if (!Number.isInteger(kind) || !pubkey || !identifier) return undefined

  return {kind, pubkey, identifier, address: `${kind}:${pubkey}:${identifier}`}
}

export const sectionSupportsKind = (
  section: CommunitySection | undefined,
  kind: number,
  subtype?: string,
) => {
  return Boolean(
    section?.kinds.some(sectionKind => communitySectionKindsMatch(sectionKind, kind, subtype)),
  )
}

export const getCommunitySectionDisplayName = (section: CommunitySection) => section.name

export const getProfileListStatus = (event: TrustedEvent | undefined) =>
  event?.tags.find(tag => tag[0] === "status")?.[1] || ""

export const isProfileListDeclined = (event: TrustedEvent | undefined) =>
  getProfileListStatus(event) === PROFILE_LIST_STATUS_DECLINED

export const isRenouncedCommunitiesListEvent = (
  event: Pick<TrustedEvent, "kind" | "tags"> | undefined,
) =>
  Boolean(
    event?.kind === PROFILE_LIST_KIND &&
    event.tags?.some(tag => tag[0] === "d" && tag[1] === RENOUNCED_COMMUNITIES_DTAG),
  )

export const getProfileListPubkeys = (event: TrustedEvent | undefined): string[] => {
  if (!event || event.kind !== PROFILE_LIST_KIND) return []
  if (isRenouncedCommunitiesListEvent(event)) return []
  if (isProfileListDeclined(event)) return []

  return Array.from(
    new Set(
      (event.tags || [])
        .filter(tag => tag[0] === "p")
        .map(tag => (parseOwnerPubkey(tag[1] || "") as string | undefined) || "")
        .filter(Boolean),
    ),
  )
}

export const canWriteFromProfileList = (profileList: TrustedEvent | undefined, pubkey: string) => {
  const normalized = normalizePubkey(pubkey)
  if (!normalized) return false

  return getProfileListPubkeys(profileList).includes(normalized)
}

export const userCanManageProfileList = (
  profileListRef: CommunityProfileListRef | undefined,
  pubkey: string,
) => Boolean(profileListRef && normalizePubkey(pubkey) === profileListRef.pubkey)
