import {getTagValue, type TrustedEvent} from "@welshman/util"

/** Creation date for issue/PR display and sorting, not Nostr activity or relay cursors. */
export const getGitCreatedAt = (event: Pick<TrustedEvent, "tags" | "created_at">): number => {
  const originalDate = Number(getTagValue("original_date", event.tags))

  return Number.isFinite(originalDate) && originalDate > 0 ? originalDate : event.created_at
}
