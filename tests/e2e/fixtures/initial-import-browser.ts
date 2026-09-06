/** Development-only, no-network component fixture. Uses the real executor and browser IndexedDB. */
import {mount, unmount} from "svelte"
import {finalizeEvent, getPublicKey} from "nostr-tools"
import InitialImportDialog from "../../../packages/nostr-git-ui/src/lib/components/git/InitialImportDialog.svelte"
import {IndexedInitialImportStore} from "../../../packages/nostr-git-ui/src/lib/utils/initial-import-store"
import {parseInitialImportUrl} from "../../../packages/nostr-git-ui/src/lib/utils/initial-import-source"
import type {InitialImportRuntime} from "../../../packages/nostr-git-ui/src/lib/utils/initial-import"

export async function mountInitialImportFixture(failFirstIssue = true) {
  if (!import.meta.env.DEV) throw new Error("Development fixture only")
  // This constant is a public disposable test identity, never a personal signing key.
  const testKey = new Uint8Array(32).fill(17)
  const owner = getPublicKey(testKey)
  const events = new Map<string, ReturnType<typeof finalizeEvent>>()
  const sourceRefs = [
    {ref: "refs/heads/main", oid: "a".repeat(40)},
    {ref: "refs/tags/v1", oid: "b".repeat(40)},
  ]
  let remoteRefs: typeof sourceRefs = []
  let pushes = 0
  let lostAck = failFirstIssue
  let attemptedIssueId = ""
  const store = new IndexedInitialImportStore()
  const target = document.createElement("div")
  target.setAttribute("data-initial-import-fixture", "")
  target.style.cssText =
    "position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:12px;background:rgba(0,0,0,.85)"
  document.body.append(target)
  const runtime: InitialImportRuntime = {
    store,
    assertActor: actor => {
      if (actor !== owner) throw new Error("Wrong test actor")
    },
    inspectSource: async value => ({
      ...parseInitialImportUrl(value),
      id: 17,
      description: "Isolated import fixture",
      defaultBranch: "main",
      sizeKiB: 1,
      openIssues: 1,
    }),
    pause: async () => {},
    git: {
      refs: async url => (url.includes("github.com") ? sourceRefs : remoteRefs),
      assertNew: async () => {},
      ready: async () => {},
      clone: async () => {},
      verifyLocal: async () => {},
      push: async () => {
        pushes++
        remoteRefs = sourceRefs
      },
      settle: async () => true,
      cancel: async () => {},
      cleanup: async () => {},
    },
    sign: async template => finalizeEvent(template, testKey),
    publish: async (event, context) => {
      events.set(event.id, event)
      if (event.kind === 1621) {
        attemptedIssueId = event.id
        if (lostAck) {
          lostAck = false
          throw new Error("Fixture: accepted issue, but ACK was lost")
        }
      }
      return {event, ackedRelays: context!.relays, failedRelays: [], hasRelayOutcomes: true}
    },
    fetchEvents: async ({filters}) =>
      [...events.values()].filter(e =>
        filters[0].ids ? filters[0].ids.includes(e.id) : filters[0].kinds?.includes(e.kind),
      ),
    pages: async function* (_source, kind) {
      yield [
        {
          id: kind === "issues" ? 1 : 2,
          number: 1,
          title: "A source issue",
          body: "Initial imported conversation",
          state: "closed",
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-02T00:00:00Z",
          user: {login: "alice"},
        },
      ]
    },
  }
  let component: ReturnType<typeof mount>
  component = mount(InitialImportDialog, {
    target,
    props: {
      owner,
      runtime,
      onClose: () => {
        void unmount(component)
        target.remove()
      },
    },
  })
  return {
    owner,
    evidence: () => ({
      pushes,
      attemptedIssueId,
      events: [...events.values()].map(e => ({id: e.id, kind: e.kind})),
    }),
  }
}
