import {nip19} from "nostr-tools"
import type {RepoAnnouncementEvent} from "@nostr-git/core/events"

/** Use the exact announcement identifier, not display text or a sanitized storage key. */
export function buildDefaultNgitCloneUrl(repo: {
  identifier?: string
  repoEvent?: Pick<RepoAnnouncementEvent, "pubkey" | "tags">
}): string | undefined {
  const owner = repo.repoEvent?.pubkey
  const identifier = repo.repoEvent?.tags.find(tag => tag[0] === "d")?.[1] ?? repo.identifier
  if (!owner || !identifier) return undefined
  try {
    const ownerNpub = owner.startsWith("npub1") ? owner : nip19.npubEncode(owner)
    return `nostr://${ownerNpub}/${identifier}`
  } catch {
    return undefined
  }
}
