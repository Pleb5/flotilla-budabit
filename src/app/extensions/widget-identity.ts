import {SMART_WIDGET_KIND} from "@app/core/community-feeds"
import type {SmartWidgetEvent} from "./types"

type WidgetIdentitySource = Pick<SmartWidgetEvent, "pubkey" | "identifier"> & {id?: string}

// Host identity for a replaceable Smart Widget line. Keep SmartWidgetEvent.identifier
// as the raw Nostr d tag; use this ID for installed/runtime/settings/storage keys.
export const getWidgetLineId = (widget: WidgetIdentitySource): string => {
  const identifier = widget.identifier?.trim() || widget.id?.trim() || ""
  const pubkey = widget.pubkey?.trim().toLowerCase() || ""

  return pubkey && identifier ? `${SMART_WIDGET_KIND}:${pubkey}:${identifier}` : identifier
}
