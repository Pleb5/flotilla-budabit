/** Development-only, no-network component fixture. Uses the real executor and browser IndexedDB. */
import {mount, unmount} from "svelte"
import {finalizeEvent, getPublicKey} from "nostr-tools"
import InitialImportDialog from "../../../packages/nostr-git-ui/src/lib/components/git/InitialImportDialog.svelte"
import {IndexedInitialImportStore} from "../../../packages/nostr-git-ui/src/lib/utils/initial-import-store"
import {parseInitialImportUrl} from "../../../packages/nostr-git-ui/src/lib/utils/initial-import-source"
import type {InitialImportRuntime} from "../../../packages/nostr-git-ui/src/lib/utils/initial-import"

type FixtureRelayState = {
  events: ReturnType<typeof finalizeEvent>[]
  pushes: number
  attemptedIssueId: string
}

export async function mountInitialImportFixture(
  failFirstIssue = true,
  restored?: FixtureRelayState,
) {
  if (!import.meta.env.DEV) throw new Error("Development fixture only")
  // This constant is a public disposable test identity, never a personal signing key.
  const testKey = new Uint8Array(32).fill(17)
  const owner = getPublicKey(testKey)
  const events = new Map((restored?.events || []).map(event => [event.id, event]))
  const sourceRefs = [
    {ref: "refs/heads/main", oid: "a".repeat(40)},
    {ref: "refs/tags/v1", oid: "b".repeat(40)},
  ]
  let remoteRefs: typeof sourceRefs = restored?.pushes ? sourceRefs : []
  let pushes = restored?.pushes || 0
  let lostAck = failFirstIssue
  let attemptedIssueId = restored?.attemptedIssueId || ""
  const store = new IndexedInitialImportStore()
  const makeGate = () => {
    let armed = false
    let waiting = false
    let release: (() => void) | undefined
    return {
      arm: () => {
        armed = true
      },
      release: () => release?.(),
      waiting: () => waiting,
      async wait() {
        if (!armed) return
        armed = false
        waiting = true
        await new Promise<void>(resolve => {
          release = resolve
        })
        waiting = false
      },
    }
  }
  const saveGate = makeGate()
  const publishGate = makeGate()
  let storeClosed = false
  let disposed = false
  let savedStatus = ""
  let confirmedKind = 0
  const save = store.save.bind(store)
  store.save = async job => {
    await saveGate.wait()
    await save(job)
    savedStatus = job.status
  }
  const confirm = store.confirm.bind(store)
  store.confirm = async job => {
    const result = await confirm(job)
    confirmedKind = job.pending!.event.kind
    return result
  }
  const close = store.close.bind(store)
  store.close = async () => {
    await close()
    storeClosed = true
  }
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
      await publishGate.wait()
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
        void destroy()
      },
      onDispose: () => {
        disposed = true
      },
      onOpenRepo: async () => {
        throw new Error("Fixture: repository navigation failed")
      },
    },
  })
  async function destroy() {
    await unmount(component)
    target.remove()
  }
  return {
    owner,
    destroy,
    saveGate,
    publishGate,
    // Small mock relay state only; production recovery always uses its real relay and saved job.
    relayState: () => ({events: [...events.values()], pushes, attemptedIssueId}),
    evidence: () => ({
      storeClosed,
      disposed,
      savedStatus,
      confirmedKind,
      pushes,
      attemptedIssueId,
      events: [...events.values()].map(e => ({id: e.id, kind: e.kind})),
    }),
  }
}
