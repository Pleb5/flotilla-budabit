import type {PublishRepoEvent} from "@nostr-git/ui"
import type {RepoPublishTransport} from "./git-commands"
import {requireRepoPublicationScope} from "./repo-publication"

/** Fork metadata belongs to the approved destination, never the open source route. */
export function createForkRepoPublisher({
  ownerPubkey,
  getActivePubkey,
  transport,
}: {
  ownerPubkey: string
  getActivePubkey: () => string | null | undefined
  transport: Pick<RepoPublishTransport, "publish">
}): PublishRepoEvent {
  return async (event, context) => {
    const repoAddress = context?.repoAddress
    const prefix = `30617:${ownerPubkey}:`
    const assertCurrent = () => {
      if (!ownerPubkey || getActivePubkey() !== ownerPubkey)
        throw new Error("The active account changed. Reopen the fork dialog before publishing.")
      if (!repoAddress?.startsWith(prefix) || !repoAddress.slice(prefix.length))
        throw new Error("Fork publication requires the approved destination coordinate")
      const identifiers = event.tags.filter(tag => tag[0] === "d")
      if (
        ![30617, 30618].includes(event.kind) ||
        (event.pubkey && event.pubkey !== ownerPubkey) ||
        identifiers.length !== 1 ||
        identifiers[0][1] !== repoAddress.slice(prefix.length)
      )
        throw new Error("Fork metadata does not match the approved destination coordinate")
      context?.assertCurrent?.()
    }
    assertCurrent()
    const relays = requireRepoPublicationScope({event, relays: context?.relays || [], repoAddress})
    // The transport rechecks after asynchronous signing, before local or relay delivery.
    return transport.publish(event, relays, {repoAddress, assertCurrent})
  }
}
