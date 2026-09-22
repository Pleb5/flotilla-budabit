import * as nip19 from "nostr-tools/nip19"
import {normalizeRelays} from "@app/core/community"
import {SMART_WIDGET_KIND} from "@app/core/community-feeds"

export const parseDefaultWidgetNaddrs = (input: string): nip19.AddressPointer[] => {
  const byAddress = new Map<string, nip19.AddressPointer>()

  for (const entry of input
    .split(",")
    .map(value => value.trim())
    .filter(Boolean)) {
    try {
      const decoded = nip19.decode(entry.replace(/^nostr:/i, ""))
      if (decoded.type !== "naddr" || decoded.data.kind !== SMART_WIDGET_KIND) {
        throw new Error("Expected a kind-30033 Smart Widget naddr")
      }
      const pointer = decoded.data
      const address = `${pointer.kind}:${pointer.pubkey}:${pointer.identifier}`
      const previous = byAddress.get(address)
      byAddress.set(address, {
        ...pointer,
        relays: normalizeRelays([...(previous?.relays || []), ...(pointer.relays || [])]),
      })
    } catch (error) {
      console.warn("[extensions] Invalid VITE_DEFAULT_WIDGETS entry", entry, error)
    }
  }

  return Array.from(byAddress.values())
}

// Default identity comes from deployment configuration, not relay availability.
// Keep this module independent of the network loader and extension settings.
export const configuredDefaultWidgetIds: ReadonlySet<string> = new Set(
  parseDefaultWidgetNaddrs(import.meta.env.VITE_DEFAULT_WIDGETS || "").map(
    pointer => `${pointer.kind}:${pointer.pubkey}:${pointer.identifier}`,
  ),
)
