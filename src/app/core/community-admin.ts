import {type EventContent, type TrustedEvent} from "@welshman/util"
import {
  PROFILE_LIST_KIND,
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
    ...Array.from(new Set(pubkeys.map(normalizePubkey).filter(Boolean))).map(pubkey => [
      "p",
      pubkey,
    ]),
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

export const makeCommunityGrantEvent = ({
  profileList,
  profileListEvent,
  pubkey,
}: {
  profileList: CommunityProfileListRef
  profileListEvent?: TrustedEvent
  pubkey: string
}) => addPubkeyToCommunityProfileList({profileList, event: profileListEvent, pubkey})

export const makeCommunityRevokeEvent = ({
  profileList,
  profileListEvent,
  pubkey,
}: {
  profileList: CommunityProfileListRef
  profileListEvent?: TrustedEvent
  pubkey: string
}) => removePubkeyFromCommunityProfileList({profileList, event: profileListEvent, pubkey})
