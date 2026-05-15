import {request} from "@welshman/net"
import {repository} from "@welshman/app"
import {DELETE, type TrustedEvent} from "@welshman/util"

export const COMMUNITY_DELETE_LOOKBACK_SECONDS = 60 * 60 * 24 * 30
export const COMMUNITY_DELETE_SINCE_BUFFER_SECONDS = 60

export const normalizeDeleteCheckpoint = (value: number) =>
  value > 10_000_000_000 ? Math.round(value / 1000) : value

export const getCommunityDeleteSeenKey = (communityPubkey: string) =>
  communityPubkey ? `communityDeleteSeen:${communityPubkey}` : ""

export const getCommunityDeleteSince = (lastDeleteSeen: number) =>
  lastDeleteSeen > 0
    ? Math.max(0, lastDeleteSeen - COMMUNITY_DELETE_SINCE_BUFFER_SECONDS)
    : Math.floor(Date.now() / 1000) - COMMUNITY_DELETE_LOOKBACK_SECONDS

export const hydrateCommunityDeleteEvents = async ({
  relays,
  kinds,
  since,
  signal,
}: {
  relays: string[]
  kinds: number[]
  since: number
  signal?: AbortSignal
}) => {
  if (relays.length === 0 || kinds.length === 0) return 0

  let latestDeleteSeen = 0

  await request({
    relays,
    autoClose: true,
    threshold: 0.5,
    signal,
    filters: [{kinds: [DELETE], "#k": kinds.map(String), since}],
    onEvent: event => {
      if (!repository.getEvent(event.id)) {
        repository.publish(event as TrustedEvent)
      }
      if (event.created_at > latestDeleteSeen) {
        latestDeleteSeen = event.created_at
      }
    },
  }).catch(() => undefined)

  return latestDeleteSeen
}
