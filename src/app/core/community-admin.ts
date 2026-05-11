import type {EventContent, TrustedEvent} from "@welshman/util"
import {
  BADGE_AWARD_KIND,
  PROFILE_LIST_KIND,
  type CommunityBadgeRef,
  type CommunityProfileListRef,
  getProfileListPubkeys,
  normalizePubkey,
} from "@app/core/community"

export const makeCommunityProfileList = ({
  profileList,
  pubkeys,
}: {
  profileList: CommunityProfileListRef
  pubkeys: string[]
}): EventContent & {kind: typeof PROFILE_LIST_KIND} => ({
  kind: PROFILE_LIST_KIND,
  content: "",
  tags: [
    ["d", profileList.identifier],
    ...Array.from(new Set(pubkeys.map(normalizePubkey).filter(Boolean))).map(pubkey => ["p", pubkey]),
  ],
})

export const addPubkeyToCommunityProfileList = ({
  profileList,
  event,
  pubkey,
}: {
  profileList: CommunityProfileListRef
  event?: TrustedEvent
  pubkey: string
}) => makeCommunityProfileList({profileList, pubkeys: [...getProfileListPubkeys(event), pubkey]})

export const removePubkeyFromCommunityProfileList = ({
  profileList,
  event,
  pubkey,
}: {
  profileList: CommunityProfileListRef
  event?: TrustedEvent
  pubkey: string
}) => {
  const normalized = normalizePubkey(pubkey)

  return makeCommunityProfileList({
    profileList,
    pubkeys: getProfileListPubkeys(event).filter(existing => existing !== normalized),
  })
}

export const makeCommunityBadgeAward = ({
  badge,
  pubkeys,
  relayHints = {},
}: {
  badge: CommunityBadgeRef
  pubkeys: string[]
  relayHints?: Record<string, string>
}): EventContent & {kind: typeof BADGE_AWARD_KIND} => ({
  kind: BADGE_AWARD_KIND,
  content: "",
  tags: [
    ["a", badge.address],
    ...Array.from(new Set(pubkeys.map(normalizePubkey).filter(Boolean))).map(pubkey => {
      const relay = relayHints[pubkey]
      return relay ? ["p", pubkey, relay] : ["p", pubkey]
    }),
  ],
})

export const makeCommunityGrantEvents = ({
  profileList,
  profileListEvent,
  badge,
  pubkey,
  relayHint,
}: {
  profileList: CommunityProfileListRef
  profileListEvent?: TrustedEvent
  badge: CommunityBadgeRef
  pubkey: string
  relayHint?: string
}) => ({
  profileList: addPubkeyToCommunityProfileList({profileList, event: profileListEvent, pubkey}),
  badgeAward: makeCommunityBadgeAward({
    badge,
    pubkeys: [pubkey],
    relayHints: relayHint ? {[normalizePubkey(pubkey)]: relayHint} : {},
  }),
})

export const makeCommunityRevokeEvent = ({
  profileList,
  profileListEvent,
  pubkey,
}: {
  profileList: CommunityProfileListRef
  profileListEvent?: TrustedEvent
  pubkey: string
}) => removePubkeyFromCommunityProfileList({profileList, event: profileListEvent, pubkey})
