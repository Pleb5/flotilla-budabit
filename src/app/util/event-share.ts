import type {TrustedEvent} from "@welshman/util"
import {getEventRelayHints, makeEventShareEntity} from "@app/util/event-links"

export type EventShareOptions = {
  url?: string
  relays?: string[]
}

export const getEventShareRelayHints = (
  event: TrustedEvent,
  {url = "", relays = []}: EventShareOptions = {},
) =>
  getEventRelayHints(event, {
    relays,
    // The relay currently being browsed is only a last-resort hint; it must
    // never be mixed into canonical (repo/explicit) relay hints.
    fallbackRelays: url ? [url] : [],
  })

export const makeEventShareEntityForEvent = (
  event: TrustedEvent,
  options: EventShareOptions = {},
) => {
  const relayHints = getEventShareRelayHints(event, options)

  return makeEventShareEntity(event, {
    relays: relayHints,
  })
}

export const makeEventShareNostrUri = (event: TrustedEvent, options: EventShareOptions = {}) => {
  const entity = makeEventShareEntityForEvent(event, options)

  return entity ? `nostr:${entity}` : ""
}
