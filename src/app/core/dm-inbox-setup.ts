import {
  getMessagingRelayList,
  pubkey,
  publishThunk,
  repository,
  waitForAnyRelayAck,
} from "@welshman/app"
import {makeEvent, MESSAGING_RELAYS} from "@welshman/util"
import {getDmRelayUrls, getMessagingRelayHints, normalizeRelayUrls} from "./dm"
import {getUserDataPublishRelays} from "./community-relays"
import {signEventForPublication} from "./publication"

export const DM_RELAY_SETTINGS_URL = "/settings/relays?section=messaging"

/** Only expose the new inbox to Chat after a relay has accepted the settings. */
export const addDmInboxRelay = async (url: string, expectedPubkey: string) => {
  const relay = normalizeRelayUrls([url])[0]
  if (!relay) throw new Error("Choose a valid messaging relay.")
  const assertAccount = () => {
    if (!expectedPubkey || pubkey.get() !== expectedPubkey) {
      throw new Error("Your account changed. Reopen DM setup and try again.")
    }
  }
  assertAccount()
  const previous = getMessagingRelayList(expectedPubkey)
  if (getDmRelayUrls(previous).includes(relay)) return

  const template = makeEvent(MESSAGING_RELAYS, {
    content: previous?.event.content || "",
    tags: [...(previous?.event.tags || []).map(tag => [...tag]), ["relay", relay]],
    created_at: Math.max(Math.floor(Date.now() / 1000), (previous?.event.created_at || 0) + 1),
  })
  const event = await signEventForPublication(template)
  assertAccount()
  if (getMessagingRelayList(expectedPubkey)?.event.id !== previous?.event.id) {
    throw new Error("Your DM relay list changed while signing. Please try again.")
  }
  const relays = getUserDataPublishRelays([relay, ...getMessagingRelayHints()])
  const thunk = publishThunk({event, relays, optimistic: false, presentation: "private"})
  try {
    await waitForAnyRelayAck(thunk, relays, {signal: AbortSignal.timeout(10_000)})
  } catch {
    thunk.controller.abort()
    throw new Error("No relay confirmed your DM settings. Please try again.")
  }
  assertAccount()
  repository.publish(event)
}
