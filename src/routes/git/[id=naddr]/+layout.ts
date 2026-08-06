export const ssr = false
import {nip19} from "nostr-tools"
import type {AddressPointer} from "nostr-tools/nip19"
import type {LayoutLoad} from "./$types"

export const load: LayoutLoad = async ({params}) => {
  const {id} = params
  // Dynamic imports to avoid SSR issues
  const {getRepoAnnouncementRelays} = await import("@app/core/git-state")
  const {refreshPubkeyOutboxRelays} = await import("@app/core/community-state")
  const {sanitizeRelays} = await import("@nostr-git/core/utils")
  const {parseRepoId} = await import("@nostr-git/core/utils")

  const decoded = nip19.decode(id).data as AddressPointer
  const repoId = `${decoded.pubkey}:${decoded.identifier}`
  const repoName = decoded.identifier
  const repoPubkey = decoded.pubkey

  // Enforce canonical repo key at routing layer (fail fast)
  try {
    parseRepoId(repoId)
  } catch (e) {
    throw new Error(
      `Invalid repoId: "${repoId}". Expected canonical repoId in the form "owner/name" or "owner:name".`,
    )
  }

  // Extract relays from naddr if present
  const naddrRelays =
    (decoded.relays?.length ?? 0) > 0 ? sanitizeRelays(decoded.relays as string[]) : []

  const configuredFallbackRelays = getRepoAnnouncementRelays(naddrRelays)
  const targetOutboxRelays =
    naddrRelays.length === 0
      ? await refreshPubkeyOutboxRelays(repoPubkey, configuredFallbackRelays)
      : []
  const announcementDiscoveryRelays = Array.from(
    new Set([...naddrRelays, ...targetOutboxRelays, ...configuredFallbackRelays]),
  )
  const url = naddrRelays[0] || announcementDiscoveryRelays[0] || ""

  return {
    url,
    repoId,
    repoName,
    repoPubkey,
    announcementDiscoveryRelays,
    naddrRelays,
    ...params,
  }
}
