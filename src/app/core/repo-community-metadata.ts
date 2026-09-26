import type {RepoCommunityBinding} from "@nostr-git/core/events"
import type {TrustedEvent} from "@welshman/util"
import {selectCurrentCommunityDefinitions} from "@app/core/community"

/** A stable repository association does not by itself identify a community owner. */
export const selectRepoCommunityDefinition = (
  binding: RepoCommunityBinding | undefined,
  events: TrustedEvent[],
) => {
  if (!binding) return undefined
  const definitions = [...selectCurrentCommunityDefinitions(events).values()].filter(
    definition =>
      definition.communityId === binding.communityId &&
      (!binding.address || definition.pointer.address === binding.address),
  )
  return definitions.length === 1 ? definitions[0] : undefined
}
