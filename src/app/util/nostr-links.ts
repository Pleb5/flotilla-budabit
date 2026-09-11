import * as nip19 from "nostr-tools/nip19"
import type {Filter} from "@welshman/util"

// Keep Nostr references on Budabit, including references parsed from nostr: URIs.
export const entityLink = (entity: string) => {
  const value = entity.trim().replace(/^nostr:/i, "")
  const prefix = /^(npub|nprofile)1/i.test(value) ? "/people/" : "/"
  return `${prefix}${encodeURIComponent(value)}`
}

export const parseEventReference = (value: string) => {
  try {
    const decoded = nip19.decode(value.replace(/^nostr:/i, ""))
    if (decoded.type === "note" || decoded.type === "nevent") {
      const pointer = decoded.type === "note" ? {id: decoded.data} : decoded.data
      return {
        filters: [{ids: [pointer.id]}] as Filter[],
        relays: "relays" in pointer ? pointer.relays || [] : [],
        author: "author" in pointer ? pointer.author : undefined,
        kind: "kind" in pointer ? pointer.kind : undefined,
      }
    }
    if (decoded.type === "naddr") {
      const {kind, pubkey, identifier, relays = []} = decoded.data
      return {
        filters: [
          {kinds: [kind], authors: [pubkey], ...(kind >= 30000 ? {"#d": [identifier]} : {})},
        ] as Filter[],
        relays,
        author: pubkey,
        kind,
      }
    }
  } catch {
    // An invalid reference is a visible state, not a reason to leave the page.
  }
  return undefined
}
