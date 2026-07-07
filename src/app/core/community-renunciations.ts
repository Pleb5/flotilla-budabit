import {derived, get} from "svelte/store"
import {Router} from "@welshman/router"
import {deriveItemsByKey, getter, makeLoadItem} from "@welshman/store"
import {
  NAMED_PEOPLE,
  addToListPrivately,
  asDecryptedEvent,
  makeList,
  readList,
  removeFromList,
  type List,
  type PublishedList,
  type TrustedEvent,
} from "@welshman/util"
import {
  ensurePlaintext,
  makeOutboxLoader,
  makeUserData,
  makeUserLoader,
  nip44EncryptToSelf,
  pubkey,
  publishThunk,
  repository,
} from "@welshman/app"
import {
  RENOUNCED_COMMUNITIES_DTAG,
  isRenouncedCommunitiesListEvent,
  normalizePubkey,
} from "@app/core/community"

export type RenouncedCommunitiesListItem = {
  event: TrustedEvent
  list: PublishedList
  communityPubkeys: string[]
}

const makeRenouncedPublicTags = (tags: string[][] = []) => [
  ["d", RENOUNCED_COMMUNITIES_DTAG],
  ...tags.filter(tag => tag[0] !== "d"),
]

export const makeRenouncedCommunitiesList = (list?: Partial<List>): List =>
  makeList({
    kind: NAMED_PEOPLE,
    event: list?.event,
    publicTags: makeRenouncedPublicTags(list?.publicTags),
    privateTags: list?.privateTags || [],
  })

export const getRenouncedCommunityPubkeysFromList = (list: List | undefined) =>
  Array.from(
    new Set(
      (list?.privateTags || [])
        .filter(tag => tag[0] === "p")
        .map(tag => normalizePubkey(tag[1] || ""))
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b))

export const addRenouncedCommunityToList = (list: List | undefined, communityPubkey: string) => {
  const normalizedCommunity = normalizePubkey(communityPubkey)
  if (!normalizedCommunity) throw new Error("Invalid community pubkey")

  return addToListPrivately(makeRenouncedCommunitiesList(list), ["p", normalizedCommunity])
}

export const removeRenouncedCommunityFromList = (list: List | undefined, communityPubkey: string) => {
  const normalizedCommunity = normalizePubkey(communityPubkey)
  if (!normalizedCommunity) throw new Error("Invalid community pubkey")

  return removeFromList(makeRenouncedCommunitiesList(list), normalizedCommunity)
}

const readRenouncedCommunitiesList = async (event: TrustedEvent) => {
  let plaintext: string | undefined

  try {
    plaintext = await ensurePlaintext(event)
  } catch {
    // Missing decryption support should not make the public shell unusable.
  }

  return makeRenouncedCommunitiesList(
    readList(asDecryptedEvent(event, plaintext ? {content: plaintext} : {})),
  ) as PublishedList
}

export const renouncedCommunitiesListsByPubkey = deriveItemsByKey<RenouncedCommunitiesListItem>({
  repository,
  filters: [{kinds: [NAMED_PEOPLE], "#d": [RENOUNCED_COMMUNITIES_DTAG]}],
  getKey: item => item.event.pubkey,
  eventToItem: async event => {
    const list = await readRenouncedCommunitiesList(event)

    return {
      event,
      list,
      communityPubkeys: getRenouncedCommunityPubkeysFromList(list),
    }
  },
})

export const getRenouncedCommunitiesListsByPubkey = getter(renouncedCommunitiesListsByPubkey)

export const getRenouncedCommunitiesList = (pubkey: string) =>
  getRenouncedCommunitiesListsByPubkey().get(pubkey)

export const loadRenouncedCommunitiesList = makeLoadItem(
  makeOutboxLoader(NAMED_PEOPLE, {"#d": [RENOUNCED_COMMUNITIES_DTAG]}),
  getRenouncedCommunitiesList,
)

export const userRenouncedCommunitiesList = makeUserData(
  renouncedCommunitiesListsByPubkey,
  loadRenouncedCommunitiesList,
)

export const loadUserRenouncedCommunitiesList = makeUserLoader(loadRenouncedCommunitiesList)

export const userRenouncedCommunityPubkeys = derived(
  userRenouncedCommunitiesList,
  $list => $list?.communityPubkeys || [],
)

const assertCanRenounceCommunity = (communityPubkey: string) => {
  const normalizedCommunity = normalizePubkey(communityPubkey)
  const activePubkey = normalizePubkey(pubkey.get() || "")

  if (!activePubkey) throw new Error("Sign in to update community membership preferences.")
  if (!normalizedCommunity) throw new Error("Invalid community pubkey")
  if (normalizedCommunity === activePubkey) {
    throw new Error("Community owner keys cannot leave their own community.")
  }

  return normalizedCommunity
}

export const renounceCommunity = async (communityPubkey: string) => {
  const normalizedCommunity = assertCanRenounceCommunity(communityPubkey)

  await loadUserRenouncedCommunitiesList([])

  const current = get(userRenouncedCommunitiesList)
  const list = current?.list || makeRenouncedCommunitiesList()
  if (getRenouncedCommunityPubkeysFromList(list).includes(normalizedCommunity)) return undefined

  const event = await addRenouncedCommunityToList(list, normalizedCommunity).reconcile(
    nip44EncryptToSelf,
  )

  return publishThunk({event, relays: Router.get().FromUser().getUrls()})
}

export const rejoinCommunity = async (communityPubkey: string) => {
  const normalizedCommunity = assertCanRenounceCommunity(communityPubkey)

  await loadUserRenouncedCommunitiesList([])

  const current = get(userRenouncedCommunitiesList)
  const list = current?.list || makeRenouncedCommunitiesList()
  if (!getRenouncedCommunityPubkeysFromList(list).includes(normalizedCommunity)) return undefined

  const event = await removeRenouncedCommunityFromList(list, normalizedCommunity).reconcile(
    nip44EncryptToSelf,
  )

  return publishThunk({event, relays: Router.get().FromUser().getUrls()})
}

export {RENOUNCED_COMMUNITIES_DTAG, isRenouncedCommunitiesListEvent}
