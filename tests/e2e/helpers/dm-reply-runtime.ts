// Dev-server-only fixture adapter. Replacing already verified synthetic events
// here models an inbox update after its one-shot relay subscription has closed.
import {repository, messagingRelayListsByPubkey} from "@welshman/app"
import type {TrustedEvent} from "@welshman/util"
import {get} from "svelte/store"
import {getDmRelayUrls} from "../../../src/app/core/dm"

export const replaceInboxLists = (events: TrustedEvent[]) => {
  for (const event of events) repository.publish(event)
}
export const inboxes = (pubkeys: string[]) =>
  pubkeys.map(pubkey => getDmRelayUrls(get(messagingRelayListsByPubkey).get(pubkey)))
