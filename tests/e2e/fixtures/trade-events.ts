import {nip19} from "nostr-tools"
import {BASE_TIMESTAMP, TEST_PUBKEYS, signTestEvent} from "./events"

export const tradeRelay = "wss://trade-preview.example/"
const pubkey = TEST_PUBKEYS.alice
const create = (kind: number, identifier: string, content: string, tags: string[][]) =>
  signTestEvent({
    kind,
    pubkey,
    created_at: BASE_TIMESTAMP,
    content,
    tags: [["d", identifier], ...tags],
  })
export const tradeEvents = [
  create(30402, "classified", "A sturdy workbench, ready for its next workshop.", [
    ["title", "Oak workbench"],
    ["price", "25000", "SATS"],
    ["location", "Budapest"],
    ["t", "tools"],
    ["image", "https://trade-preview.example/workbench.svg"],
  ]),
  create(32765, "service", "Design and build a welcoming website for your community.", [
    ["title", "Community website design"],
    ["amount", "5000"],
    ["pricing", "1"],
    ["s", "1"],
    ["t", "design"],
  ]),
  create(32767, "job", "Help us design a poster for our next meetup.", [
    ["title", "Design our meetup poster"],
    ["s", "0"],
    ["t", "design"],
  ]),
  create(32768, "proposal", "I can deliver three poster concepts this week.", [
    ["a", `32767:${pubkey}:job`],
    ["amount", "15000"],
    ["pricing", "0"],
  ]),
  create(32766, "order", "A three-page community site with a calendar.", [
    ["a", `32765:${pubkey}:service`],
    ["amount", "5000"],
    ["pricing", "1"],
    ["s", "1"],
  ]),
]
export const tradeReference = (event: (typeof tradeEvents)[number]) =>
  nip19.naddrEncode({
    kind: event.kind,
    pubkey: event.pubkey,
    identifier: event.tags.find(tag => tag[0] === "d")![1],
    relays: [tradeRelay],
  })

// Warm-cache browser verification only; this does not send events to relays.
export const cacheTradeFixtures = async () => {
  const {repository} = await import("@welshman/app")
  tradeEvents.forEach(event => repository.publish(event))
}
