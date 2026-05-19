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

type RelayGroup = Iterable<string | undefined | null> | undefined | null

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
}

export type EventShareEntityOptions = EventRelayHintOptions & {
  fallbackPubkey?: string
  userOutboxRelays?: RelayGroup
  gitRelays?: RelayGroup
}

const normalizeRelayHint = (relay: string | undefined | null) => {
  if (!relay) return ""

  try {
    const normalized = normalizeRelayUrl(relay)
    return isRelayUrl(normalized) ? normalized : ""
  } catch {
    return ""
  }
}

export const normalizeRelayHints = (...relayGroups: RelayGroup[]) => {
  const relays = new Set<string>()

  for (const group of relayGroups) {
    for (const relay of group || []) {
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

export const getEventRelayHints = (
  event: Pick<TrustedEvent, "id" | "kind" | "pubkey" | "tags">,
  {
    relays,
    fallbackRelays,
    includeTagRelays = true,
    includeAuthorRelays = true,
    includeTargetedPublicationRelays = true,
  }: EventRelayHintOptions = {},
) => {
  const targetedRelays = includeTargetedPublicationRelays
    ? getTargetedPublicationRelayHints(event)
    : []
  const primaryRelays = normalizeRelayHints(relays, tracker.getRelays(event.id), targetedRelays)
  if (primaryRelays.length > 0) return primaryRelays

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
