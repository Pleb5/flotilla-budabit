export const ssr = false
import {derived, type Readable} from "svelte/store"
import {
  type IssueEvent,
  type PatchEvent,
  type RepoAnnouncementEvent,
  type RepoStateEvent,
  type PullRequestEvent,
} from "@nostr-git/shared-types"
import {
  GIT_REPO_ANNOUNCEMENT,
  GIT_REPO_STATE,
  GIT_PULL_REQUEST,
  normalizeRelayUrl,
} from "@nostr-git/shared-types"
import {GIT_ISSUE, GIT_PATCH, GIT_STATUS_OPEN, GIT_STATUS_DRAFT, GIT_STATUS_CLOSED, GIT_STATUS_COMPLETE, getTagValue} from "@welshman/util"
import {nthEq} from "@welshman/lib"
import {nip19} from "nostr-tools"
import type {AddressPointer} from "nostr-tools/nip19"
import type {LayoutLoad} from "./$types"

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
      kinds: [GIT_REPO_STATE, GIT_REPO_ANNOUNCEMENT],
    },
  ]

  await load({relays: relayListFromUrl as string[], filters})

  const repoEvent = derived(
    deriveEvents(repository, {
      filters: [
        {
          authors: [decoded.pubkey],
          kinds: [GIT_REPO_ANNOUNCEMENT],
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
      const relaysTag = re.tags.find(nthEq(0, "relays"))
      if (relaysTag) {
        const [_, ...relaysList] = relaysTag
        console.log(`[Layout] Raw relays from repo event tags:`, relaysList)
        // Filter out invalid relay URLs and log warnings
        const validRelays = relaysList.filter((relay: string) => {
          try {
            const url = new URL(relay)
            const isValid = url.protocol === 'ws:' || url.protocol === 'wss:'
            if (!isValid) {
              console.warn(`Invalid relay URL protocol: ${relay} (protocol: ${url.protocol})`)
            }
            return isValid
          } catch (e) {
            console.warn(`Invalid relay URL found in repo event tags: ${relay}`, e)
            return false
          }
        })
        console.log(`[Layout] Extracted ${validRelays.length} valid relays from repo event:`, validRelays)
        return validRelays
      }
    }
    console.log(`[Layout] Using fallback relay list:`, relayListFromUrl)
    return relayListFromUrl
  })

  // First, load all repo announcements with the same name to get all related repos
  const allReposFilter = {
    kinds: [GIT_REPO_ANNOUNCEMENT],
    "#d": [repoName],
  }

  await load({
    relays: relayListFromUrl as string[],
    filters: [allReposFilter],
  })

  // Extract maintainers and author from repo event for filtering
  const {parseRepoAnnouncementEvent} = await import("@nostr-git/shared-types")

  // Wait for repo event to be available
  let repoAuthors: string[] = [decoded.pubkey]
  const unsubscribe = repoEvent.subscribe(repo => {
    if (repo) {
      const parsed = parseRepoAnnouncementEvent(repo)
      const authors = new Set<string>()
      authors.add(repo.pubkey) // Author of the repo announcement
      if (parsed.maintainers) {
        parsed.maintainers.forEach(m => authors.add(m))
      }
      repoAuthors = Array.from(authors)
    }
  })
  unsubscribe()

  // Filter issues and patches by authors (maintainers + repo author)
  const issueFilters = {
    kinds: [GIT_ISSUE],
    "#a": repoAuthors.map(a => `${GIT_REPO_ANNOUNCEMENT}:${a}:${repoName}`),
  }

  const patchFilters = {
    kinds: [GIT_PATCH],
    "#a": repoAuthors.map(a => `${GIT_REPO_ANNOUNCEMENT}:${a}:${repoName}`),
  }

  const pullRequestFilters = {
    kinds: [GIT_PULL_REQUEST],
    "#a": repoAuthors.map(a => `${GIT_REPO_ANNOUNCEMENT}:${a}:${repoName}`),
  }

  const statusFilters = {
    kinds: [GIT_STATUS_OPEN, GIT_STATUS_DRAFT, GIT_STATUS_CLOSED, GIT_STATUS_COMPLETE],
    "#a": repoAuthors.map(a => `${GIT_REPO_ANNOUNCEMENT}:${a}:${repoName}`),
  }
  // Load issues and patches
  await load({
    relays: relayListFromUrl as string[],
    filters: [issueFilters, patchFilters, pullRequestFilters, statusFilters],
  })

  // Create derived stores that will include all issues/patches
  // The Repo class will filter to only those matching its canonical identity
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

  const pullRequests: Readable<PullRequestEvent[]> = derived(
    deriveEvents(repository, {
      filters: [pullRequestFilters],
    }),
    events => (events || []) as PullRequestEvent[],
  )

  const statusEvents: Readable<any[]> = derived(
    deriveEvents(repository, {
      filters: [statusFilters],
    }),
    events => events || [],
  )

  // Create statusEventsByRoot map
  const statusEventsByRoot: Readable<Map<string, any[]>> = derived(
    statusEvents,
    events => {
      const map = new Map<string, any[]>()
      for (const event of events) {
        const rootId = getTagValue("e", event.tags)
        if (rootId) {
          if (!map.has(rootId)) {
            map.set(rootId, [])
          }
          map.get(rootId)!.push(event)
        }
      }
      return map
    }
  )

  const emptyArr = derived([], () => [] as any[])
  const repoClass = new Repo({
    repoEvent,
    repoStateEvent,
    issues,
    patches,
    repoStateEvents: emptyArr as unknown as Readable<any[]>,
    statusEvents,
    commentEvents: emptyArr as unknown as Readable<any[]>,
    labelEvents: emptyArr as unknown as Readable<any[]>,
  })

  return {
    repoClass,
    repoRelays: bestRelayList,
    statusEventsByRoot,
    pullRequests,
    url,
    repoId,
    ...params,
  }
}
