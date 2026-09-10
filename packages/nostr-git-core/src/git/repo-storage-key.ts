import {nip19} from "nostr-tools"
import type {RepoAnnouncementEvent} from "../events/nip34/nip34.js"
import {parseRepoId} from "../utils/repo-id.js"
import {detectVendorFromUrl} from "./vendor-providers.js"

/** Shared by Repo and worker reads. Display names never identify a local clone. */
export function getRepoStorageKey(event: Pick<RepoAnnouncementEvent, "pubkey" | "tags">): string {
  const identifier = event.tags.find(tag => tag[0] === "d")?.[1]
  let owner = event.pubkey.trim()
  if (!owner || !identifier) throw new Error("Repository storage requires an owner and identifier")

  const isGrasp = event.tags
    .filter(tag => tag[0] === "clone")
    .flatMap(tag => tag.slice(1))
    .some(url => detectVendorFromUrl(url) === "grasp-rest")
  // Retain the existing GRASP npub / conventional hex owner storage convention.
  if (isGrasp && !owner.startsWith("npub1")) {
    try {
      owner = nip19.npubEncode(owner)
    } catch {
      // Keep the existing owner representation if it cannot be encoded.
    }
  }

  // This retains the legacy filesystem sanitizer; it is not a coordinate migration.
  return parseRepoId(`${owner}:${identifier}`)
}
