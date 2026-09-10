/** Real-route publication boundary fixture. No Git mutation or live signing. */
import {get} from "svelte/store"
import {pubkey} from "@welshman/app"
import {
  ForkRepoDialog,
  RepoCreationTransactionJournal,
  trackRepoCreationPublisher,
} from "@nostr-git/ui"
import type {NostrEvent} from "@nostr-git/core"
import {modals} from "../../../src/app/util/modal"

function assertMockRelay() {
  if (!import.meta.env.DEV || !(window as any).__mockRelayPublish)
    throw new Error("This fixture requires the isolated mock relay")
}

export function setForkFixtureAccount(owner: string) {
  assertMockRelay()
  if (get(pubkey)) throw new Error("Anonymous test session required")
  pubkey.set(owner)
}

export async function submitForkMetadataFixture(events: NostrEvent[]) {
  assertMockRelay()
  const dialog = Object.values(get(modals)).find(modal => modal.component === ForkRepoDialog)
  const identifier = (document.querySelector("#fork-name") as HTMLInputElement)?.value
  if (!dialog || !identifier || events.some(event => event.pubkey !== get(pubkey)))
    throw new Error("Open the real route fork dialog with the test account first")
  const journal = new RepoCreationTransactionJournal({
    id: `fork:browser-fixture:${identifier}`,
    operation: "fork",
    ownerPubkey: get(pubkey)!,
    repoName: identifier,
  })
  // Use the route's actual callback/transport and the same context wrapper as
  // useForkRepo. Only Git work is omitted; all relay delivery goes to MockRelay.
  const publish = trackRepoCreationPublisher(journal, dialog.props.onPublishEvent)!
  try {
    const results = []
    for (const event of events) {
      const result = await publish(event, {
        relays: ["wss://repository-identity-review.test/"],
        stage: "final",
      })
      results.push({
        kind: result.event.kind,
        pubkey: result.event.pubkey,
        identifier: result.event.tags.find(tag => tag[0] === "d")?.[1],
        ackedRelays: result.ackedRelays,
      })
    }
    return results
  } finally {
    journal.complete()
    dialog.props.onClose?.()
  }
}
