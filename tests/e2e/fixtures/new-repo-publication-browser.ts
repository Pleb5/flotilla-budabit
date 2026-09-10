/** Exercise the actual New Repo route callback; no Git/provider operations. */
import {get} from "svelte/store"
import {loginWithPubkey, pubkey, repository, signer} from "@welshman/app"
import {
  NewRepoWizard,
  RepoCreationTransactionJournal,
  trackRepoCreationPublisher,
} from "@nostr-git/ui"
import {modals} from "../../../src/app/util/modal"
import {signTestEvent, TEST_PUBKEYS} from "./events"
import {createRepoStateEvent} from "@nostr-git/core/events"

const owner = TEST_PUBKEYS.alice
const other = TEST_PUBKEYS.bob
const identifier = "approved-new-repo"
const relay = "wss://new-repo-publication.test/"
const signed: ReturnType<typeof signTestEvent>[] = []
let changeDuringSigning = false

function assertFixture() {
  if (!import.meta.env.DEV || !(window as any).__mockRelayPublish)
    throw new Error("Isolated MockRelay session required")
}

export function installNewRepoPublicationFixture() {
  assertFixture()
  if (pubkey.get()) throw new Error("Anonymous test session required")
  signer.get = (() => ({
    sign: async (event: Parameters<typeof signTestEvent>[0]) => {
      if (
        ![30617, 30618].includes(event.kind) ||
        event.tags.find(tag => tag[0] === "d")?.[1] !== identifier
      )
        throw new Error("Unexpected fixture signing request")
      const result = signTestEvent(event)
      signed.push(result)
      if (changeDuringSigning) pubkey.set(other)
      return result
    },
  })) as typeof signer.get
  loginWithPubkey(owner)
}

export async function submitNewRepoPublicationFixture(mode: "unchanged" | "before" | "during") {
  assertFixture()
  const dialog = Object.values(get(modals)).find(modal => modal.component === NewRepoWizard)
  if (!dialog || dialog.props.userPubkey !== owner)
    throw new Error("Open the real New Repo wizard first")
  const journal = new RepoCreationTransactionJournal({
    id: "new-repo-publication-fixture",
    operation: "new",
    ownerPubkey: owner,
    repoName: identifier,
  })
  const publish = trackRepoCreationPublisher(journal, dialog.props.onPublishEvent)!
  if (mode === "before") pubkey.set(other)
  changeDuringSigning = mode === "during"
  let error = ""
  try {
    await publish(
      {
        kind: 30617,
        created_at: 100,
        content: "",
        tags: [
          ["d", identifier],
          ["name", "Approved repository"],
          ["clone", "https://github.com/fixture/new.git"],
          ["relays", relay],
        ],
      } as any,
      {relays: [relay], stage: "provisional"},
    )
    await publish(
      createRepoStateEvent({
        repoId: identifier,
        identifier,
        head: "main",
        refs: [{type: "heads", name: "main", commit: "1".repeat(40)}],
      }),
      {relays: [relay], stage: "final"},
    )
  } catch (failure) {
    error = String(failure)
  } finally {
    journal.complete()
    dialog.props.onDispose?.()
  }
  return {
    error,
    signed: signed.map(event => ({
      pubkey: event.pubkey,
      storedLocally: Boolean(repository.getEvent(event.id)),
    })),
  }
}
