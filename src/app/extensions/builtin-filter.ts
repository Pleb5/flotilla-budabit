import {normalizePubkey} from "@app/core/community"
import type {SmartWidgetEvent} from "@app/extensions/types"

export const selectDefaultCommunityWidgets = (
  widgets: SmartWidgetEvent[],
  communityPubkey?: string,
) => {
  const ownerPubkey = normalizePubkey(communityPubkey || "")

  return ownerPubkey
    ? widgets.filter(widget => normalizePubkey(widget.pubkey || "") === ownerPubkey)
    : []
}
