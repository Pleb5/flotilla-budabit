import {now} from "@welshman/lib"
import {Router} from "@welshman/router"
import {
  Address,
  ZAP_REQUEST,
  ZAP_RESPONSE,
  getTagValue,
  isReplaceable,
  makeEvent,
  type Filter,
  type TrustedEvent,
  type Zapper,
} from "@welshman/util"
import {GIT_RELAYS} from "@app/core/git-state"
import {getEventRelayHints, normalizeRelayHints} from "@app/util/event-links"

type ZapRelayOptions = {
  event: TrustedEvent
  relayHints?: string[]
  scopeH?: string
  fallbackRelays?: string[]
}

type ZapRequestOptions = ZapRelayOptions & {
  zapper: Zapper
  msats: number
  content?: string
  anonymous?: boolean
  relays?: string[]
}

type ZapReceiptFilterOptions = {
  event: TrustedEvent
  zapper?: Pick<Zapper, "nostrPubkey">
  since?: number
}

const getAuthorZapReceiptRelays = (pubkey: string) => {
  try {
    const router = Router.get()
    const tryGetUrls = (getUrls: () => string[]) => {
      try {
        return getUrls()
      } catch {
        return []
      }
    }
    const inboxRelays = tryGetUrls(() => router.ForPubkey(pubkey).getUrls())
    const readRelays = tryGetUrls(() => router.FromPubkey(pubkey).getUrls())

    return normalizeRelayHints(inboxRelays, readRelays)
  } catch {
    return []
  }
}

export const getZapScope = ({event, scopeH = ""}: Pick<ZapRelayOptions, "event" | "scopeH">) =>
  scopeH || getTagValue("h", event.tags || []) || ""

export const getZapEventAddress = (event: TrustedEvent) => {
  if (!isReplaceable(event)) return ""

  try {
    return Address.fromEvent(event).toString()
  } catch {
    return ""
  }
}

export const getZapRelays = ({
  event,
  relayHints = [],
  scopeH = "",
  fallbackRelays = GIT_RELAYS,
}: ZapRelayOptions) => {
  const scoped = Boolean(getZapScope({event, scopeH}))
  const normalizedRelayHints = normalizeRelayHints(relayHints)

  const authorReceiptRelays = getAuthorZapReceiptRelays(event.pubkey)

  if (scoped && normalizedRelayHints.length > 0) {
    return normalizeRelayHints(normalizedRelayHints, authorReceiptRelays)
  }

  if (!scoped) {
    if (authorReceiptRelays.length > 0) {
      return authorReceiptRelays
    }
  }

  const eventRelays = getEventRelayHints(event, {
    relays: normalizedRelayHints,
    fallbackRelays,
    includeAuthorRelays: !scoped,
  })

  return eventRelays.length > 0 ? eventRelays : normalizeRelayHints(fallbackRelays)
}

export const makeZapRequestForEvent = ({
  event,
  zapper,
  msats,
  content = "",
  anonymous,
  relays: explicitRelays,
  relayHints = [],
  scopeH = "",
  fallbackRelays,
}: ZapRequestOptions) => {
  const relays = explicitRelays
    ? normalizeRelayHints(explicitRelays)
    : getZapRelays({event, relayHints, scopeH, fallbackRelays})
  const tags = [
    ["relays", ...relays],
    ["amount", String(msats)],
    ["lnurl", zapper.lnurl],
    ["p", event.pubkey],
    ["e", event.id],
  ]
  const address = getZapEventAddress(event)
  const scope = getZapScope({event, scopeH})

  if (address) tags.push(["a", address])
  if (scope) tags.push(["h", scope])
  if (anonymous) tags.push(["anon"])

  return makeEvent(ZAP_REQUEST, {content, tags})
}

export const getZapReceiptFilters = ({event, zapper, since}: ZapReceiptFilterOptions) => {
  const base: Filter = {
    kinds: [ZAP_RESPONSE],
    "#p": [event.pubkey],
  }
  const address = getZapEventAddress(event)

  if (zapper?.nostrPubkey) base.authors = [zapper.nostrPubkey]
  if (since !== undefined) base.since = since

  const filters: Filter[] = [{...base, "#e": [event.id]}]

  if (address) filters.push({...base, "#a": [address]})

  return filters
}

export const getRecentZapReceiptFilters = (options: Omit<ZapReceiptFilterOptions, "since">) =>
  getZapReceiptFilters({...options, since: now() - 30})
