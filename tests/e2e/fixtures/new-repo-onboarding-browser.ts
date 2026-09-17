/** Isolated UI fixture: fake metadata, Git worker and publication, never live signing/writes. */
import {pubkey} from "@welshman/app"
import {NewRepoWizard, tokens} from "@nostr-git/ui"
import {clearModals, pushModal} from "../../../src/app/util/modal"
import {TEST_PUBKEYS} from "./events"

export const evidence = {
  requests: [] as string[],
  mutations: [] as string[],
  events: [] as any[],
  result: null as any,
}
let originalFetch: typeof fetch | undefined
let finishSlow: (() => void) | undefined
export function finishSlowInspection() {
  finishSlow?.()
}
const refs = [
  {ref: "refs/heads/trunk", oid: "1".repeat(40)},
  {ref: "refs/tags/v1", oid: "2".repeat(40)},
]

export function openOnboardingFixture(withTargetToken = false) {
  if (
    !import.meta.env.DEV ||
    !["localhost", "127.0.0.1"].includes(location.hostname) ||
    pubkey.get()
  )
    throw new Error("Anonymous local test browser required")
  clearModals()
  evidence.requests = []
  evidence.mutations = []
  evidence.events = []
  evidence.result = null
  tokens.clear()
  tokens.setTokenLoader(async () =>
    withTargetToken ? [{host: "codeberg.org", token: "disposable-fixture-token"}] : [],
  )
  if (withTargetToken) tokens.push({host: "codeberg.org", token: "disposable-fixture-token"})
  const destination = new Map<string, string>()
  originalFetch ||= window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const url = new URL(String(input), location.href)
    if (url.origin === location.origin) return originalFetch!(input, init)
    evidence.requests.push(`${init?.method || "GET"} ${url.origin}${url.pathname}`)
    if (url.hostname !== "codeberg.org")
      return new Response("Fixture: external HTTP blocked", {status: 503})
    if (
      [
        "/api/v1/repos/fixture/public",
        "/api/v1/repos/fixture/slow",
        "/api/v1/repos/fixture/empty",
      ].includes(url.pathname)
    ) {
      if (new Headers(init?.headers).has("authorization") || init?.credentials !== "omit")
        throw new Error("Source read must be anonymous")
      const name = url.pathname.split("/").at(-1)
      if (name === "slow")
        await new Promise<void>(resolve => {
          finishSlow = resolve
        })
      return Response.json({
        id: 123,
        name,
        full_name: `fixture/${name}`,
        private: false,
        empty: name === "empty",
        description: "Public source fixture",
        default_branch: "trunk",
        topics: ["nostr", "git"],
        html_url: `https://codeberg.org/fixture/${name}`,
        clone_url: `https://codeberg.org/fixture/${name}.git`,
      })
    }
    if (url.pathname === "/api/v1/user") return Response.json({login: "fixture-target", id: 7})
    return new Response("Not found", {status: 404})
  }
  const workerApi = {
    isRepoCloned: async () => false,
    listServerRefs: async ({url}: any) =>
      url.includes("/fixture/public") ? refs : [...destination].map(([ref, oid]) => ({ref, oid})),
    cloneRemoteRepo: async (options: any) => {
      if (!options.publicSource || options.token || options.depth)
        throw new Error("Anonymous full clone required")
      evidence.mutations.push("clone")
    },
    resolveRef: async ({ref}: any) => refs.find(item => item.ref === ref)?.oid,
    createRemoteRepo: async ({name, repoName, options}: any) => {
      const identifier = name || repoName || options?.name || "public"
      evidence.mutations.push("create-destination")
      return {
        success: true,
        provider: "forgejo",
        remoteUrl: `https://codeberg.org/fixture-target/${identifier}.git`,
        webUrl: `https://codeberg.org/fixture-target/${identifier}`,
      }
    },
    pushToRemote: async ({ref, initialImportRefs}: any) => {
      evidence.mutations.push(`push:${ref}`)
      destination.set(ref, initialImportRefs.find((item: any) => item.ref === ref).oid)
      return {success: true, details: {pushedRefs: [ref], failedRefs: []}}
    },
    deleteRepo: async () => {
      evidence.mutations.push("cleanup")
      return {success: true}
    },
    getOperationStatus: async ({operationId}: any) => ({
      operationId,
      operation: operationId.split(":").at(-2),
      state: "completed",
      stage: "done",
    }),
  }
  return pushModal(
    NewRepoWizard,
    {
      userPubkey: TEST_PUBKEYS.alice,
      workerApi,
      defaultRelays: ["wss://metadata.fixture.test/"],
      onPublishEvent: async (event: any, context: any) => {
        context?.assertCurrent?.()
        await context?.assertFresh?.()
        const signed = {
          ...event,
          pubkey: TEST_PUBKEYS.alice,
          id: (evidence.events.length + 1).toString(16).padStart(64, "0"),
          sig: "mock-signature",
        }
        evidence.events.push(signed)
        return {
          event: signed,
          ackedRelays: context.relays,
          failedRelays: [],
          hasRelayOutcomes: true,
        }
      },
      onFetchRelayEvents: async ({filters}: any) =>
        evidence.events.filter(event =>
          filters.some(
            (filter: any) =>
              (!filter.ids || filter.ids.includes(event.id)) &&
              (!filter.kinds || filter.kinds.includes(event.kind)) &&
              (!filter["#d"] ||
                filter["#d"].includes(event.tags.find((tag: any) => tag[0] === "d")?.[1])),
          ),
        ),
      onDeleteEvent: async () => {},
      onRepoCreated: (result: any) => {
        evidence.result = result
      },
      onCancel: clearModals,
    },
    {fullscreen: true, noEscape: true},
  )
}
