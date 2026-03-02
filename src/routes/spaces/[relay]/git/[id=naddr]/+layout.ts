export const ssr = false
import {nip19} from "nostr-tools"
import type {AddressPointer} from "nostr-tools/nip19"
import type {LayoutLoad} from "./$types"

export const load: LayoutLoad = async ({params}) => {
  const {id, relay} = params
  // Dynamic imports to avoid SSR issues
  const {decodeRelay} = await import("@app/core/state")
  const {getRepoAnnouncementRelays} = await import("@src/lib/budabit/state")
  const {normalizeRelayUrl} = await import("@nostr-git/core/utils")
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

  const url = decodeRelay(relay)
  const fallbackRelays = getRepoAnnouncementRelays()

  // Extract relays from naddr if present
  const naddrRelays =
    (decoded.relays?.length ?? 0) > 0
      ? ((decoded.relays as string[])
          .map((u: string) => normalizeRelayUrl(u))
          .filter(Boolean) as string[])
      : []

  return {
    url,
    repoId,
    repoName,
    repoPubkey,
    fallbackRelays,
    naddrRelays,
    ...params,
  }
}
