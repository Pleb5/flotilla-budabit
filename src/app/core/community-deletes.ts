import {DELETE, type Filter} from "@welshman/util"
import {parseCommunityDefinitionAddress, type CommunityPointer} from "./community-protocol"

/** Current community deletions carry h, never a marked community a (a is a
 * deletion target). All target kinds are included; the repository checks authors.
 * Historical coverage is owned by the foreground coordinator, not localStorage. */
export const makeCommunityDeletionFilter = (community: CommunityPointer): Filter => {
  const pointer = parseCommunityDefinitionAddress(community.address)
  if (
    !pointer ||
    pointer.ownerPubkey !== community.ownerPubkey ||
    pointer.communityId !== community.communityId
  ) {
    throw new Error("Invalid community deletion scope")
  }
  return {kinds: [DELETE], "#h": [pointer.communityId]}
}
