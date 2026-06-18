import {localStorageProvider, synced} from "@welshman/store"
import {get} from "svelte/store"
import {normalizePubkey} from "@app/core/community"

export const COMMUNITY_EXTENSION_PROMPT_KEY = "budabit/community-extension-prompt"

export type CommunityExtensionPromptState = {
  pubkey: string
  dismissedCommunityPubkeys: string[]
}

export const defaultCommunityExtensionPromptState: CommunityExtensionPromptState = {
  pubkey: "",
  dismissedCommunityPubkeys: [],
}

export const communityExtensionPrompt = synced({
  key: COMMUNITY_EXTENSION_PROMPT_KEY,
  defaultValue: defaultCommunityExtensionPromptState,
  storage: localStorageProvider,
})

export const ensureCommunityExtensionPromptLogin = (userPubkey: string) => {
  const normalizedPubkey = normalizePubkey(userPubkey)
  if (!normalizedPubkey) return

  communityExtensionPrompt.update(state =>
    state.pubkey === normalizedPubkey
      ? state
      : {pubkey: normalizedPubkey, dismissedCommunityPubkeys: []},
  )
}

export const clearCommunityExtensionPromptLogin = () => {
  communityExtensionPrompt.set(defaultCommunityExtensionPromptState)
}

export const dismissCommunityExtensionPrompt = (userPubkey: string, communityPubkey: string) => {
  const normalizedUser = normalizePubkey(userPubkey)
  const normalizedCommunity = normalizePubkey(communityPubkey)
  if (!normalizedUser || !normalizedCommunity) return

  communityExtensionPrompt.update(state => {
    const current = state.pubkey === normalizedUser ? state.dismissedCommunityPubkeys || [] : []

    return {
      pubkey: normalizedUser,
      dismissedCommunityPubkeys: Array.from(new Set([...current, normalizedCommunity])),
    }
  })
}

export const isCommunityExtensionPromptDismissed = (
  userPubkey: string,
  communityPubkey: string,
  state = get(communityExtensionPrompt),
) => {
  const normalizedUser = normalizePubkey(userPubkey)
  const normalizedCommunity = normalizePubkey(communityPubkey)

  return Boolean(
    normalizedUser &&
    normalizedCommunity &&
    state.pubkey === normalizedUser &&
    (state.dismissedCommunityPubkeys || []).includes(normalizedCommunity),
  )
}
