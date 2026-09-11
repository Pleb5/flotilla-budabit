/** Disposable recovery fixtures. Never use a real account, signer, or Git target. */
import {mount} from "svelte"
import {pubkey, repository, signer} from "@welshman/app"
import {
  RepoCreationTransactionJournal,
  getPendingRepoCreationTransactions,
  type RepoCreationRecoveryRecord,
} from "@nostr-git/ui"
import RepoCreationRecovery from "../../../src/app/components/RepoCreationRecovery.svelte"
import {signTestEvent, TEST_PUBKEYS} from "./events"
import type {NostrEvent} from "nostr-tools"
import {getInitializedGitWorker} from "../../../src/app/core/worker-singleton"

export const identifier = "legacy:stable-id"
export const relay = "wss://recovery-fixture.test/"
export const owner = TEST_PUBKEYS.alice
export const source = signTestEvent({
  kind: 30617,
  pubkey: owner,
  created_at: 100,
  content: "Old owner content",
  tags: [
    ["d", identifier],
    ["name", "Old display name"],
    ["maintainers", TEST_PUBKEYS.bob],
    ["u", "https://old-upstream.test/repo.git"],
    ["clone", "https://old-host.test/repo.git"],
    ["relays", relay],
  ],
})
export const current = signTestEvent({
  ...source,
  created_at: 101,
  content: "Current owner content",
  tags: [
    ["d", identifier],
    ["name", "Current owner name"],
    ["description", "Owner-approved description"],
    ["u", "https://current-upstream.test/repo.git"],
    ["x-fixture", "preserve", "unchanged"],
    ["clone", "https://current-host.test/repo.git"],
    ["relays", relay],
  ],
})
export const recoveryRecord = (): RepoCreationRecoveryRecord => ({
  version: 2,
  id: "recovery-browser-fixture",
  operation: "fork",
  ownerPubkey: owner,
  repoName: identifier,
  phase: "metadata-preparing",
  repositoryRelayUrls: [relay],
  localResource: {ownedByTransaction: false, stage: "planned"},
  sourceMetadata: {
    announcementEvent: source,
    cloneUrls: ["https://old-host.test/repo.git"],
    webUrls: [],
  },
  targets: [
    {
      id: "git:fixture",
      provider: "github",
      label: "Verified fixture host",
      stage: "verified",
      remoteUrl: "https://github.com/fixture/recovery.git",
      refs: [{ref: "refs/heads/main", commit: "1".repeat(40), stage: "verified"}],
      cleanup: {stage: "not-needed", manualAttention: false},
      manualAttention: false,
      updatedAt: 1,
    },
  ],
  targetResults: [],
  publishedEvents: [],
  eventAcks: [],
  pendingCompensations: [],
  cleanup: {stage: "not-needed", manualAttention: false},
  manualAttention: {required: false},
  createdAt: 1,
  updatedAt: 1,
})

let signedCount = 0
let refReads = 0
let attemptedMutations = 0
let lastSignedState: NostrEvent | undefined
const refReadUrls: string[] = []
export const completionFailedHost = "https://unprovisioned-fixture.test/repo.git"
export async function installRecoveryFixture(
  failState = false,
  advanceRefsOnStateSign = false,
  record = recoveryRecord(),
) {
  if (!import.meta.env.DEV || !(window as any).__mockRelayPublish || pubkey.get())
    throw new Error("Anonymous isolated MockRelay session required")
  const worker = await getInitializedGitWorker()
  let liveCommit = "1".repeat(40)
  // Only the read-only ref endpoint is mocked. Unexpected URLs fail closed;
  // recovery must not perform any provider or Git mutation in this fixture.
  worker.api = new Proxy(worker.api, {
    get(target, property) {
      if (["createRemoteRepo", "pushToRemote", "deleteRepo"].includes(String(property)))
        return () => {
          attemptedMutations++
          throw new Error("Fixture: Git/provider mutations are forbidden")
        }
      if (property !== "listServerRefs") return Reflect.get(target, property)
      return async ({url}: {url: string}) => {
        refReadUrls.push(url)
        if (url === completionFailedHost) throw new Error("Fixture: HTTP 404 Not Found")
        if (
          ![
            "https://github.com/fixture/recovery.git",
            "https://current-host.test/repo.git",
            "https://old-host.test/repo.git",
          ].includes(url)
        )
          throw new Error("Unexpected Git ref read")
        refReads++
        return [
          ...record.targets[0].refs.map(ref => ({
            ref: ref.ref,
            oid: ref.ref === "refs/heads/main" ? liveCommit : ref.commit,
          })),
          {ref: "HEAD", target: "refs/heads/main", oid: liveCommit},
        ]
      }
    },
  })
  RepoCreationTransactionJournal.resume(record)
  let shouldFailState = failState
  // The transport and route remain real; only the signer is replaced with the
  // existing disposable test-event signer. All WebSockets are intercepted.
  signer.get = (() => ({
    sign: async (event: NostrEvent) => {
      if (
        event.kind === 5 &&
        event.pubkey === owner &&
        event.tags.some(tag => tag[0] === "e") &&
        event.tags
          .filter(tag => tag[0] === "e")
          .every(tag => record.publishedEvents.some(item => item.event.id === tag[1]))
      )
        return signTestEvent(event)
      if (
        ![30617, 30618].includes(event.kind) ||
        event.pubkey !== owner ||
        event.tags.find(tag => tag[0] === "d")?.[1] !== identifier
      )
        throw new Error("Unexpected fixture signing request")
      if (event.kind === 30618 && shouldFailState) {
        shouldFailState = false
        throw new Error("Fixture state signer interrupted")
      }
      signedCount++
      if (event.kind === 30618 && advanceRefsOnStateSign) liveCommit = "2".repeat(40)
      const signed = signTestEvent(event)
      if (event.kind === 30618) lastSignedState = signed
      return signed
    },
  })) as typeof signer.get
  pubkey.set(owner)
}

export const recoveryEvidence = () => ({
  records: getPendingRepoCreationTransactions(),
  signedCount,
  refReads,
  attemptedMutations,
  stateStoredLocally: Boolean(lastSignedState && repository.getEvent(lastSignedState.id)),
  refReadUrls,
})

export async function installCompletionRecoveryFixture(
  mode: "failed-host" | "partial-state" | "future-state" | "stuck-state",
  announcement: NostrEvent,
  state?: NostrEvent,
) {
  if (
    [announcement, ...(state ? [state] : [])].some(
      event => event.pubkey !== owner || event.tags.find(tag => tag[0] === "d")?.[1] !== identifier,
    )
  )
    throw new Error("Wrong completion fixture coordinate")
  const record = recoveryRecord()
  record.operation = "new"
  record.sourceMetadata = undefined
  record.publishedEvents = [
    {
      event: announcement,
      stage: mode === "stuck-state" ? "final" : "provisional",
      relayUrls: [relay],
    },
  ]
  if (mode === "failed-host")
    record.targets.push({
      id: "grasp:failed-fixture",
      label: "Failed provisional fixture",
      provider: "grasp",
      stage: "failed",
      remoteUrl: completionFailedHost,
      relayUrl: "wss://unprovisioned-fixture.test/",
      createdRemote: false,
      refs: [{ref: "refs/heads/main", commit: "1".repeat(40), stage: "failed"}],
      cleanup: {stage: "completed", manualAttention: false},
      manualAttention: false,
      updatedAt: 1,
    })
  if (mode === "partial-state")
    record.targets[0].refs.push({
      ref: "refs/heads/feature",
      commit: "2".repeat(40),
      stage: "verified",
    })
  if (mode === "partial-state" || mode === "stuck-state") {
    if (!state) throw new Error("Signed fixture state required")
    record.publishedEvents.push({
      event: state,
      stage: mode === "stuck-state" ? "final" : "provisional",
      relayUrls: [relay],
    })
  }
  if (mode === "stuck-state") record.phase = "metadata-pending"
  await installRecoveryFixture(false, false, record)
}

/** Read-only visual fixture: no auth, journal, network, or publication callback. */
export function mountRecoveryReviewFixture() {
  if (!import.meta.env.DEV) throw new Error("Development-only visual fixture")
  const target = document.createElement("div")
  target.dataset.recoveryVisualFixture = "true"
  target.style.cssText =
    "position:fixed;inset:0;z-index:10000;overflow:auto;padding:16px;background:var(--background,#171717)"
  document.body.append(target)
  mount(RepoCreationRecovery, {
    target,
    props: {
      records: [
        {
          ...recoveryRecord(),
          phase: "metadata-review",
          reviewAnnouncement: current,
          manualAttention: {
            required: true,
            reason:
              "Owner metadata changed. Review the current announcement before finishing hosting.",
          },
        },
      ],
      busy: [],
      onRecover: async () => {
        throw new Error("Read-only visual fixture")
      },
    },
  })
}
