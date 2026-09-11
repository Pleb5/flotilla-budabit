import {nip19} from "nostr-tools"
import {BASE_TIMESTAMP, TEST_PUBKEYS, signTestEvent} from "./events"

export const fallbackRelay = "wss://event-fallback.example/"
export const relatedNote = signTestEvent({
  kind: 1,
  pubkey: TEST_PUBKEYS.alice,
  created_at: BASE_TIMESTAMP,
  tags: [],
  content: "A related note, still inside Budabit.",
})
export const fallbackEvent = signTestEvent({
  kind: 12345,
  pubkey: TEST_PUBKEYS.alice,
  created_at: BASE_TIMESTAMP + 1,
  tags: [
    ["title", "A useful event without a dedicated view"],
    ["summary", "Readable content first. Protocol details only when you need them."],
    ["e", relatedNote.id, fallbackRelay],
  ],
  content:
    "An unfamiliar event can still be useful.\n\n<img src=x onerror=alert(1)>\n\n" +
    "This content stays readable without running HTML or opening another client. ".repeat(22),
})
export const fallbackReference = nip19.neventEncode({
  id: fallbackEvent.id,
  author: fallbackEvent.pubkey,
  kind: fallbackEvent.kind,
  relays: [fallbackRelay],
})
export const fallbackPath = `/${fallbackReference}`

// Test-only warm-cache fixture. Repository.publish adds to the in-memory store;
// it does not send events to a relay or use a signed-in account.
export const cacheFallbackFixture = async () => {
  const {repository} = await import("@welshman/app")
  repository.publish(relatedNote)
  repository.publish(fallbackEvent)
}
