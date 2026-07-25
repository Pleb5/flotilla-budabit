import * as nip19 from "nostr-tools/nip19"
import {Router} from "@welshman/router"
import {repository, tracker} from "@welshman/app"
import {Address, getTagValue, isRelayUrl, isReplaceable, normalizeRelayUrl} from "@welshman/util"
import type {TrustedEvent} from "@welshman/util"
import {GIT_REPO_ANNOUNCEMENT, GIT_REPO_STATE} from "@nostr-git/core/events"
import {buildRepoNaddrFromEvent} from "@nostr-git/core/utils"
import {
  TARGETED_PUBLICATION_KIND,
  TARGETED_PUBLICATION_KINDS,
  parseTargetedPublication,
} from "@app/core/community"

type RelayGroup = Iterable<string | undefined | null> | string | undefined | null

export type EventPointerLike = {
  id: string
  kind?: number | string
  pubkey?: string
  author?: string
}

export type EventRelayHintOptions = {
  relays?: RelayGroup
  fallbackRelays?: RelayGroup
  includeTagRelays?: boolean
  includeAuthorRelays?: boolean
  includeTargetedPublicationRelays?: boolean
  includeRepoRelays?: boolean
}

export type EventShareEntityOptions = EventRelayHintOptions & {
  fallbackPubkey?: string
  userOutboxRelays?: RelayGroup
  gitRelays?: RelayGroup
}

const normalizeRelayHint = (relay: string | undefined | null) => {
  if (!relay) return ""
  if (isLikelyNonRelayHint(relay)) return ""

  try {
    const normalized = normalizeRelayUrl(relay)
    if (isLikelyNonRelayHint(normalized)) return ""
    if (isLocalRelayHint(normalized)) return ""
    return isRelayUrl(normalized) ? normalized : ""
  } catch {
    return ""
  }
}

const relayGroupValues = (group: RelayGroup) => {
  if (!group) return []
  if (typeof group === "string") return [group]
  return group
}

const isLikelyNonRelayHint = (relay: string) => {
  const raw = String(relay || "").trim()
  if (!raw) return false

  let parsed: URL
  try {
    parsed = new URL(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw) ? raw : `https://${raw}`)
  } catch {
    return false
  }

  const host = parsed.hostname.toLowerCase()
  const pathSegments = parsed.pathname.split("/").filter(Boolean)
  const lastSegment = pathSegments[pathSegments.length - 1] || ""
  const looksLikeGitRemote = pathSegments.length >= 2 && /\.git$/i.test(lastSegment)
  const isKnownPlatform = ["github.com", "gitlab.com", "bitbucket.org"].includes(host)

  return looksLikeGitRemote || isKnownPlatform
}

// Local/loopback relays are never useful hints in shared links
const isLocalRelayHint = (relay: string) => {
  const raw = String(relay || "").trim()
  if (!raw) return false

  let parsed: URL
  try {
    parsed = new URL(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw) ? raw : `wss://${raw}`)
  } catch {
    return false
  }

  const host = parsed.hostname.toLowerCase()

  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host === "[::1]" ||
    host.endsWith(".local") ||
    host.endsWith(".localhost")
  )
}

export const normalizeRelayHints = (...relayGroups: RelayGroup[]) => {
  const relays = new Set<string>()

  for (const group of relayGroups) {
    for (const relay of relayGroupValues(group)) {
      const normalized = normalizeRelayHint(relay)
      if (normalized) relays.add(normalized)
    }
  }

  return Array.from(relays)
}

export const getEventTagRelayHints = (event: Pick<TrustedEvent, "tags">) =>
  normalizeRelayHints(...(event.tags || []).map(tag => tag.slice(1)))

export const getAuthorRelayHints = (author?: string) => {
  if (!author) return []

  try {
    return normalizeRelayHints(Router.get().FromPubkey(author).getUrls())
  } catch {
    return []
  }
}

export const getUserRelayHints = () => {
  try {
    return normalizeRelayHints(Router.get().FromUser().getUrls())
  } catch {
    return []
  }
}

export const getSeenEventRelayHints = (eventId?: string) =>
  eventId ? normalizeRelayHints(tracker.getRelays(eventId)) : []

const normalizeKind = (kind: number | string | undefined) => {
  if (typeof kind === "number" && Number.isFinite(kind)) return kind
  if (typeof kind !== "string") return undefined

  const parsed = Number.parseInt(kind, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

const isTargetablePublicationKind = (kind: number | undefined) =>
  kind !== undefined && TARGETED_PUBLICATION_KINDS.includes(kind as any)

export const getTargetedPublicationRelayHints = (
  event: Pick<TrustedEvent, "kind" | "tags">,
) => {
  const kind = normalizeKind(event.kind)
  if (!isTargetablePublicationKind(kind)) return []

  const targetingId = getTagValue("h", event.tags || [])
  if (!targetingId) return []

  try {
    const targetingEvents = repository.query(
      [{kinds: [TARGETED_PUBLICATION_KIND], "#d": [targetingId], "#k": [String(kind)]}],
      {shouldSort: false},
    ) as TrustedEvent[]

    return normalizeRelayHints(
      targetingEvents.flatMap(event => {
        const targeting = parseTargetedPublication(event)
        if (!targeting) return []

        return [targeting.ref?.relay, ...targeting.communities.map(community => community.relay)]
      }),
    )
  } catch {
    return []
  }
}

const REPO_ADDRESS_KINDS: number[] = [GIT_REPO_ANNOUNCEMENT, GIT_REPO_STATE]

const getRepoTaggedRelays = (event: Pick<TrustedEvent, "tags">) =>
  (event.tags || [])
    .filter(tag => tag[0] === "relays")
    .flatMap(tag => tag.slice(1))

export type RepoAddressPointer = {
  kind: number
  pubkey: string
  identifier: string
  address: string
  relay?: string
}

// Extract references to repo announcements (kind 30617/30618) from an event's a/A tags
export const getRepoAddressPointersFromEvent = (
  event: Pick<TrustedEvent, "tags">,
): RepoAddressPointer[] => {
  const pointers: RepoAddressPointer[] = []

  for (const tag of event.tags || []) {
    if (tag[0] !== "a" && tag[0] !== "A") continue

    const address = String(tag[1] || "")
    const [kindPart, pubkey, ...identifierParts] = address.split(":")
    const kind = normalizeKind(kindPart)

    if (kind === undefined || !REPO_ADDRESS_KINDS.includes(kind) || !pubkey) continue

    pointers.push({
      kind,
      pubkey,
      identifier: identifierParts.join(":"),
      address,
      relay: tag[2] || undefined,
    })
  }

  return pointers
}

// Canonical relay hints for repo-related events: the relays declared by the
// repo announcement the event points at (via its a/A tag). Falls back to the
// relay hint embedded in the a/A tag when the announcement is not known locally.
// Repo announcement/state events resolve to their own relays tag.
export const getRepoAnnouncementRelayHints = (
  event: Pick<TrustedEvent, "kind" | "tags">,
) => {
  const kind = normalizeKind(event.kind)

  if (kind !== undefined && REPO_ADDRESS_KINDS.includes(kind)) {
    return normalizeRelayHints(getRepoTaggedRelays(event))
  }

  const pointers = getRepoAddressPointersFromEvent(event)
  if (pointers.length === 0) return []

  const announcementRelays: string[] = []

  for (const pointer of pointers) {
    try {
      const repoEvents = repository.query(
        [{kinds: [pointer.kind], authors: [pointer.pubkey], "#d": [pointer.identifier]}],
        {shouldSort: false},
      ) as TrustedEvent[]

      for (const repoEvent of repoEvents) {
        announcementRelays.push(...getRepoTaggedRelays(repoEvent))
      }
    } catch {
      // ignore lookup failures, fall through to pointer relay hints
    }
  }

  const relays = normalizeRelayHints(announcementRelays)
  if (relays.length > 0) return relays

  return normalizeRelayHints(pointers.map(pointer => pointer.relay))
}

export const getEventRelayHints = (
  event: Pick<TrustedEvent, "id" | "kind" | "pubkey" | "tags">,
  {
    relays,
    fallbackRelays,
    includeTagRelays = false,
    includeAuthorRelays = true,
    includeTargetedPublicationRelays = true,
    includeRepoRelays = true,
  }: EventRelayHintOptions = {},
) => {
  // Repo-related events (issues, patches, PRs, statuses, comments, permalinks)
  // are canonically located on the repo announcement relays. Never mix in
  // seen-on, browsing, or outbox relays for these.
  if (includeRepoRelays) {
    const repoRelays = getRepoAnnouncementRelayHints(event)
    if (repoRelays.length > 0) return repoRelays
  }

  // Explicitly provided relays are authoritative; targeted publication
  // (community) relays are canonical targets and are kept alongside them.
  const targetedRelays = includeTargetedPublicationRelays
    ? getTargetedPublicationRelayHints(event)
    : []
  const primaryRelays = normalizeRelayHints(relays, targetedRelays)
  if (primaryRelays.length > 0) return primaryRelays

  // Relays the event was actually seen on are a best-effort fallback only
  const seenRelays = getSeenEventRelayHints(event.id)
  if (seenRelays.length > 0) return seenRelays

  return normalizeRelayHints(
    includeTagRelays ? getEventTagRelayHints(event) : undefined,
    includeAuthorRelays ? getAuthorRelayHints(event.pubkey) : undefined,
    fallbackRelays,
  )
}

export const makeEventNevent = (
  event: EventPointerLike,
  options: Pick<EventRelayHintOptions, "relays" | "fallbackRelays"> = {},
) => {
  const kind = normalizeKind(event.kind)
  const author = event.author || event.pubkey || undefined

  return nip19.neventEncode({
    id: event.id,
    relays: normalizeRelayHints(options.relays, options.fallbackRelays),
    ...(kind === undefined ? {} : {kind}),
    ...(author ? {author} : {}),
  })
}

export const makeRepoEventNaddr = (event: TrustedEvent, options: EventShareEntityOptions = {}) =>
  buildRepoNaddrFromEvent({
    event,
    fallbackPubkey: event.pubkey || options.fallbackPubkey || "",
    fallbackRepoRelays: getEventRelayHints(event, options),
    userOutboxRelays: normalizeRelayHints(options.userOutboxRelays),
    gitRelays: normalizeRelayHints(options.gitRelays),
  })

export const makeEventShareEntity = (event: TrustedEvent, options: EventShareEntityOptions = {}) => {
  const relayHints = getEventRelayHints(event, options)

  if (isReplaceable(event)) {
    const repoNaddr =
      event.kind === GIT_REPO_ANNOUNCEMENT || event.kind === GIT_REPO_STATE
        ? makeRepoEventNaddr(event, {...options, relays: relayHints})
        : undefined

    if (repoNaddr) return repoNaddr

    const identifier = getTagValue("d", event.tags) || ""
    if (identifier) {
      return nip19.naddrEncode({
        kind: event.kind,
        pubkey: event.pubkey,
        identifier,
        relays: relayHints.length > 0 ? relayHints : undefined,
      })
    }

    return Address.fromEvent(event).toNaddr()
  }

  return makeEventNevent(event, {relays: relayHints})
}
