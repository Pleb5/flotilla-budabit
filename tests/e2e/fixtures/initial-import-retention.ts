import {finalizeEvent, getPublicKey} from "nostr-tools"
import {IndexedInitialImportStore} from "../../../packages/nostr-git-ui/src/lib/utils/initial-import-store"
import {
  prepareInitialImport,
  runInitialImport,
  type InitialImportRuntime,
} from "../../../packages/nostr-git-ui/src/lib/utils/initial-import"

/** Real browser IndexedDB; no network, event-body cache, spies, or UI progress log. */
export async function createImportRetentionFixture() {
  if (!import.meta.env.DEV) throw new Error("Development fixture only")
  const store = new IndexedInitialImportStore()
  const key = new Uint8Array(32).fill(19) // Public disposable test identity
  const owner = getPublicKey(key)
  const relay = "wss://grasp.test"
  const refs = [{ref: "refs/heads/main", oid: "a".repeat(40)}]
  let jobId = ""
  let gitReady = false
  let issueCount = 20
  let fail = false
  let lastPendingId = ""
  const runtime: InitialImportRuntime = {
    store,
    assertActor: () => {},
    pause: async () => {},
    inspectSource: async () => ({
      url: "https://github.com/a/b",
      owner: "a",
      name: "b",
      id: 1,
      description: "",
      defaultBranch: "main",
      sizeKiB: 1,
      openIssues: 250,
    }),
    git: {
      refs: async url => (url.includes("github.com") || gitReady ? refs : []),
      assertNew: async () => {},
      ready: async () => {},
      clone: async () => {},
      verifyLocal: async () => {},
      push: async () => {
        gitReady = true
      },
      settle: async () => true,
      cancel: async () => {},
      cleanup: async () => {},
    },
    sign: async template => finalizeEvent(template, key),
    publish: async event => {
      if (fail && event.kind === 1621) {
        lastPendingId ||= event.id
        if (event.id !== lastPendingId) throw new Error("Pending retry identity changed")
        throw new Error("Fixture offline")
      }
      return {event, ackedRelays: [relay], hasRelayOutcomes: true}
    },
    fetchEvents: async ({filters}) => {
      const current = jobId ? await store.get(jobId) : undefined
      return [current?.announcement, current?.state].filter((e): e is NonNullable<typeof e> =>
        Boolean(
          e &&
          (filters[0].ids ? filters[0].ids.includes(e.id) : filters[0].kinds?.includes(e.kind)),
        ),
      )
    },
    pages: async function* (_source, kind) {
      if (kind === "comments") return
      for (let id = 1; id <= issueCount; id++) {
        yield [
          {
            id,
            number: id,
            title: `Issue ${id}`,
            body: Array.from(
              {length: 2000},
              (_, n) => `${id}-${n.toString().padStart(8, "0")}`,
            ).join(" "),
            state: "open",
            user: {login: "a"},
            created_at: "2024-01-01T00:00:00Z",
            updated_at: "2024-01-01T00:00:00Z",
          },
        ]
      }
      throw new Error("Fixture page checkpoint")
    },
  }
  const prepared = await prepareInitialImport(
    {
      sourceUrl: "https://github.com/a/b",
      owner,
      name: `heap-${crypto.randomUUID()}`,
      relay,
      issues: true,
      comments: false,
    },
    runtime,
    new AbortController().signal,
  )
  await store.create(prepared)
  jobId = prepared.id
  return {
    async run(count: number, offline = false) {
      issueCount = count
      fail = offline
      const result = await runInitialImport(jobId, runtime, new AbortController().signal)
      return {
        events: result.counts.events,
        bytes: result.counts.bytes,
        pendingId: result.pending?.event.id,
        journalBytes: JSON.stringify(result).length,
        message: result.message,
      }
    },
  }
}
