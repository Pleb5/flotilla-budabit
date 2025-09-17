export const ssr = false
import {derived, type Readable} from "svelte/store"
import {
  type IssueEvent,
  type PatchEvent,
  type RepoAnnouncementEvent,
  type RepoStateEvent,
} from "@nostr-git/shared-types"
import {GIT_ISSUE, GIT_PATCH} from "@welshman/util"
import {nip19} from "nostr-tools"
import type {AddressPointer} from "nostr-tools/nip19"
import {nthEq} from "@welshman/lib"
import {GIT_REPO, GIT_REPO_STATE} from "@src/lib/util.js"
import type {LayoutLoad} from "./$types"
import {normalizeRelayUrl} from "@welshman/util"

export const load: LayoutLoad = async ({params}) => {
  const {id, relay} = params

  // Dynamic imports to avoid SSR issues
  const {decodeRelay, INDEXER_RELAYS} = await import("@app/core/state")
  const {deriveEvents} = await import("@welshman/store")
  const {repository} = await import("@welshman/app")
  const {load} = await import("@welshman/net")
  const {Repo} = await import("@nostr-git/ui")
  const {canonicalRepoKey} = await import("@nostr-git/core")

  const decoded = nip19.decode(id).data as AddressPointer
  const repoId = `${decoded.pubkey}:${decoded.identifier}`
  const repoName = decoded.identifier
  // Enforce canonical repo key at routing layer (fail fast)
  try {
    canonicalRepoKey(repoId)
  } catch (e) {
    throw new Error(
      `Invalid repoId: "${repoId}". Expected canonical repoId in the form "owner/name" or "owner:name".`,
    )
  }
  const url = decodeRelay(relay)

  const fallbackRelays = INDEXER_RELAYS
  const relayListFromUrl = (
    (decoded.relays?.length ?? 0) > 0 ? (decoded.relays as string[]) : fallbackRelays
  )
    .map(u => normalizeRelayUrl(u))
    .filter(Boolean) as string[]

  const filters = [
    {
      authors: [decoded.pubkey],
      kinds: [GIT_REPO_STATE, GIT_REPO],
      "#d": [repoName],
    },
  ]

  await load({relays: relayListFromUrl as string[], filters})

  const repoEvent = derived(
    deriveEvents(repository, {
      filters: [
        {
          authors: [decoded.pubkey],
          kinds: [GIT_REPO],
          "#d": [repoName],
        },
      ],
    }),
    events => events[0],
  ) as Readable<RepoAnnouncementEvent>

  const repoStateEvent = derived(
    deriveEvents(repository, {
      filters: [
        {
          authors: [decoded.pubkey],
          kinds: [GIT_REPO_STATE],
          "#d": [repoName],
        },
      ],
    }),
    events => {
      const stateEvent = events?.[0]
      if (stateEvent) {
        // Repository State event loaded successfully
      } else {
        // No Repository State event found
      }
      return stateEvent
    },
  ) as Readable<RepoStateEvent>

  // Get relays from event tags
  const bestRelayList = derived(repoEvent, re => {
    if (re) {
      const [_, ...relaysList] = re.tags.find(nthEq(0, "relays")) || []
      return (relaysList as string[]).map(u => normalizeRelayUrl(u)).filter(Boolean) as string[]
    }
    return relayListFromUrl
  })

  const issueFilters = {
    kinds: [GIT_ISSUE],
    "#a": [`${GIT_REPO}:${repoId}`],
  }

  const patchFilters = {
    kinds: [GIT_PATCH],
    "#a": [`${GIT_REPO}:${repoId}`],
  }

  await load({
    relays: relayListFromUrl as string[],
    filters: [issueFilters, patchFilters],
  })

  // Create derived stores for issues and patches
  const issues: Readable<IssueEvent[]> = derived(
    deriveEvents(repository, {
      filters: [issueFilters],
    }),
    events => (events || []) as IssueEvent[],
  )

  const patches: Readable<PatchEvent[]> = derived(
    deriveEvents(repository, {
      filters: [patchFilters],
    }),
    events => (events || []) as PatchEvent[],
  )

  // Token store is now initialized at app level - no need to set up here

  const emptyArr = derived([], () => [] as any[])
  const repoClass = new Repo({
    repoEvent,
    repoStateEvent,
    issues,
    patches,
    repoStateEvents: emptyArr as unknown as Readable<any[]>,
    statusEvents: emptyArr as unknown as Readable<any[]>,
    commentEvents: emptyArr as unknown as Readable<any[]>,
    labelEvents: emptyArr as unknown as Readable<any[]>,
  })

  return {
    repoClass,
    repoRelays: bestRelayList,
    url,
    repoId,
    ...params,
  }
}
