import {parseRepoAnnouncementEvent, type RepoAnnouncementEvent} from "@nostr-git/core/events"
import {normalizePubkey} from "@app/core/community"

const parseRepoAnnouncementSafe = (event: RepoAnnouncementEvent) => {
  try {
    return parseRepoAnnouncementEvent(event)
  } catch {
    return null
  }
}

export const getRepoMaintainers = (event?: RepoAnnouncementEvent | null) => {
  if (!event) return []

  const owner = normalizePubkey(event.pubkey || "")
  const declaredMaintainers = (parseRepoAnnouncementSafe(event)?.maintainers || [])
    .map(normalizePubkey)
    .filter(Boolean)

  return Array.from(new Set([owner, ...declaredMaintainers].filter(Boolean)))
}

export const getRepoDeclaredMaintainers = (event?: RepoAnnouncementEvent | null) => {
  if (!event) return []

  const owner = normalizePubkey(event.pubkey || "")
  const declaredMaintainers = (parseRepoAnnouncementSafe(event)?.maintainers || [])
    .map(normalizePubkey)
    .filter(pubkey => pubkey && pubkey !== owner)

  return Array.from(new Set(declaredMaintainers))
}
