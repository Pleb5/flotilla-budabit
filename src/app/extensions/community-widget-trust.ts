import {normalizePubkey} from "@app/core/community"
import type {SmartWidgetEvent} from "@app/extensions/types"

export const isTrustedCommunityWidget = (
  widget: SmartWidgetEvent,
  trustedAuthorPubkeys: string[],
) => {
  const author = normalizePubkey(widget.pubkey || "")
  if (!author) return false

  return new Set(trustedAuthorPubkeys.map(normalizePubkey).filter(Boolean)).has(author)
}

export const getTrustedCommunityWidgets = (
  widgets: SmartWidgetEvent[],
  trustedAuthorPubkeys: string[],
) => widgets.filter(widget => isTrustedCommunityWidget(widget, trustedAuthorPubkeys))

export const getManualCommunityWidgets = (
  widgets: SmartWidgetEvent[],
  trustedAuthorPubkeys: string[],
) => widgets.filter(widget => !isTrustedCommunityWidget(widget, trustedAuthorPubkeys))
