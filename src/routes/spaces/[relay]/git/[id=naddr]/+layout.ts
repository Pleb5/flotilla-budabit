export const ssr = false
import {derived, type Readable} from "svelte/store"
import {
  type IssueEvent,
  type PatchEvent,
  type RepoAnnouncementEvent,
  type RepoStateEvent,
  type PullRequestEvent,
  type StatusEvent,
  type CommentEvent,
  type LabelEvent,
  isCommentEvent,
} from "@nostr-git/shared-types"
import {
  GIT_REPO_ANNOUNCEMENT,
  GIT_REPO_STATE,
  GIT_PULL_REQUEST,
  normalizeRelayUrl,
} from "@nostr-git/shared-types"
import {GIT_ISSUE, GIT_PATCH, GIT_STATUS_OPEN, GIT_STATUS_DRAFT, GIT_STATUS_CLOSED, GIT_STATUS_COMPLETE, getTagValue, COMMENT, type TrustedEvent} from "@welshman/util"
import {nthEq} from "@welshman/lib"
import {nip19} from "nostr-tools"
import type {AddressPointer} from "nostr-tools/nip19"
import type {LayoutLoad} from "./$types"

export const load: LayoutLoad = async ({params}) => {
  const {id, relay} = params
  // Dynamic imports to avoid SSR issues
  const {decodeRelay} = await import("@app/core/state")
  const {GIT_RELAYS} = await import("@src/lib/budabit/state")
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

  const fallbackRelays = GIT_RELAYS
  const relayListFromUrl = (
    (decoded.relays?.length ?? 0) > 0 ? (decoded.relays as string[]) : fallbackRelays
  )
    .map((u: string) => normalizeRelayUrl(u))
    .filter(Boolean) as string[]

  const repoFilters = [
    {
      authors: [decoded.pubkey],
      kinds: [GIT_REPO_STATE, GIT_REPO_ANNOUNCEMENT],
    },
  ]

  // Start loading repo events immediately (will be used later)
  const repoLoadPromise = load({relays: relayListFromUrl as string[], filters: repoFilters})

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

  // Don't block on repo load - start loading in background and return immediately
  // The page will render with what we have, and reactive stores will update as data arrives
  
  // Extract maintainers reactively (non-blocking)
  const {parseRepoAnnouncementEvent} = await import("@nostr-git/shared-types")
  
  // Create reactive repoAuthors that updates when repo event loads
  const repoAuthors = derived(repoEvent, (repo) => {
    if (!repo) {
      // Fallback to just the pubkey if repo event not loaded yet
      return [decoded.pubkey]
    }
    try {
      const parsed = parseRepoAnnouncementEvent(repo)
      const authors = new Set<string>()
      authors.add(repo.pubkey) // Author of the repo announcement
      if (parsed.maintainers) {
        parsed.maintainers.forEach(m => authors.add(m))
      }
      return Array.from(authors)
    } catch {
      return [decoded.pubkey]
    }
  })

  // Create event stores that watch the repository
  // These stores watch for events matching the repo address pattern
  // When maintainer events are loaded (via the load() call below), they're added to the repository
  // The derived stores (issues, patches, etc.) then filter these events based on current authors
  const allIssueEvents = deriveEvents(repository, {
    filters: [{
      kinds: [GIT_ISSUE],
      // Note: We filter by repo address in the derived store below, not here
      // This allows us to see all events loaded for this repo (owner + maintainers)
    }],
  })

  const allPatchEvents = deriveEvents(repository, {
    filters: [{
      kinds: [GIT_PATCH],
    }],
  })

  const allPullRequestEvents = deriveEvents(repository, {
    filters: [{
      kinds: [GIT_PULL_REQUEST],
    }],
  })

  const allStatusEvents = deriveEvents(repository, {
    filters: [{
      kinds: [GIT_STATUS_OPEN, GIT_STATUS_DRAFT, GIT_STATUS_CLOSED, GIT_STATUS_COMPLETE],
    }],
  })

  // Load initial data in background (don't await - let it load asynchronously)
  const allReposFilter = {
    kinds: [GIT_REPO_ANNOUNCEMENT],
    "#d": [repoName],
  }

  // Start loading with initial authors
  Promise.all([
    repoLoadPromise,
    load({
      relays: relayListFromUrl as string[],
      filters: [allReposFilter],
    }),
    load({
      relays: relayListFromUrl as string[],
      filters: [
        {
          kinds: [GIT_ISSUE],
          "#a": [`${GIT_REPO_ANNOUNCEMENT}:${decoded.pubkey}:${repoName}`],
        },
        {
          kinds: [GIT_PATCH],
          "#a": [`${GIT_REPO_ANNOUNCEMENT}:${decoded.pubkey}:${repoName}`],
        },
        {
          kinds: [GIT_PULL_REQUEST],
          "#a": [`${GIT_REPO_ANNOUNCEMENT}:${decoded.pubkey}:${repoName}`],
        },
        {
          kinds: [GIT_STATUS_OPEN, GIT_STATUS_DRAFT, GIT_STATUS_CLOSED, GIT_STATUS_COMPLETE],
          "#a": [`${GIT_REPO_ANNOUNCEMENT}:${decoded.pubkey}:${repoName}`],
        },
      ],
    }),
  ]).then(() => {
    // Reactively load data when authors change (including when maintainers are discovered)
    // This subscription will be cleaned up automatically when the route changes
    repoAuthors.subscribe((authors) => {
      // Only load if we have more than just the initial pubkey
      if (authors.length > 1) {
        // Maintainers loaded, load with full author list
        load({
          relays: relayListFromUrl as string[],
          filters: [
            {
              kinds: [GIT_ISSUE],
              "#a": authors.map(a => `${GIT_REPO_ANNOUNCEMENT}:${a}:${repoName}`),
            },
            {
              kinds: [GIT_PATCH],
              "#a": authors.map(a => `${GIT_REPO_ANNOUNCEMENT}:${a}:${repoName}`),
            },
            {
              kinds: [GIT_PULL_REQUEST],
              "#a": authors.map(a => `${GIT_REPO_ANNOUNCEMENT}:${a}:${repoName}`),
            },
            {
              kinds: [GIT_STATUS_OPEN, GIT_STATUS_DRAFT, GIT_STATUS_CLOSED, GIT_STATUS_COMPLETE],
              "#a": authors.map(a => `${GIT_REPO_ANNOUNCEMENT}:${a}:${repoName}`),
            },
          ],
        }).catch(() => {}) // Ignore errors - this is background loading
      }
    })
  }).catch(() => {}) // Don't block on errors

  // Create derived stores that filter events reactively based on current authors
  // This ensures we include events from maintainers when they're discovered
  // Layer 2: Filter events by repo address (owner + maintainers)
  // The address tag format is: ["a", "kind:pubkey:identifier"]
  // So we check if the event's address matches any of our current authors' addresses
  const issues: Readable<IssueEvent[]> = derived(
    [allIssueEvents, repoAuthors],
    ([events, authors]) => {
      const authorAddresses = new Set(authors.map(a => `${GIT_REPO_ANNOUNCEMENT}:${a}:${repoName}`))
      return (events || []).filter((event: TrustedEvent) => {
        const addressTag = event.tags.find((t: string[]) => t[0] === "a")
        // Check if event's address matches any of our current authors (owner + maintainers)
        return addressTag && authorAddresses.has(addressTag[1])
      }) as IssueEvent[]
    },
  )

  const patches: Readable<PatchEvent[]> = derived(
    [allPatchEvents, repoAuthors],
    ([events, authors]) => {
      const authorAddresses = new Set(authors.map(a => `${GIT_REPO_ANNOUNCEMENT}:${a}:${repoName}`))
      return (events || []).filter((event: TrustedEvent) => {
        const addressTag = event.tags.find((t: string[]) => t[0] === "a")
        return addressTag && authorAddresses.has(addressTag[1])
      }) as PatchEvent[]
    },
  )

  const pullRequests: Readable<PullRequestEvent[]> = derived(
    [allPullRequestEvents, repoAuthors],
    ([events, authors]) => {
      const authorAddresses = new Set(authors.map(a => `${GIT_REPO_ANNOUNCEMENT}:${a}:${repoName}`))
      return (events || []).filter((event: TrustedEvent) => {
        const addressTag = event.tags.find((t: string[]) => t[0] === "a")
        return addressTag && authorAddresses.has(addressTag[1])
      }) as PullRequestEvent[]
    },
  )

  const statusEvents: Readable<StatusEvent[]> = derived(
    [allStatusEvents, repoAuthors],
    ([events, authors]) => {
      const authorAddresses = new Set(authors.map(a => `${GIT_REPO_ANNOUNCEMENT}:${a}:${repoName}`))
      return (events || []).filter((event: TrustedEvent) => {
        const addressTag = event.tags.find((t: string[]) => t[0] === "a")
        return addressTag && authorAddresses.has(addressTag[1])
      }) as StatusEvent[]
    },
  )

  // Create statusEventsByRoot map
  const statusEventsByRoot: Readable<Map<string, StatusEvent[]>> = derived(
    statusEvents,
    events => {
      const map = new Map<string, StatusEvent[]>()
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

  // Get all root IDs from issues, patches, and PRs reactively
  const allRootIds = derived([issues, patches, pullRequests], ([issueEvents, patchEvents, prEvents]) => {
    const ids: string[] = []
    if (issueEvents) ids.push(...issueEvents.map((issue: IssueEvent) => issue.id))
    if (patchEvents) ids.push(...patchEvents.map((patch: PatchEvent) => patch.id))
    if (prEvents) ids.push(...prEvents.map((pr: PullRequestEvent) => pr.id))
    return ids
  })

  // Create comment events store that filters comments by root IDs
  // We use a broad filter and then filter reactively based on root IDs
  const allCommentEvents = deriveEvents(repository, {
    filters: [{
      kinds: [COMMENT],
    }],
  })

  const commentEvents: Readable<CommentEvent[]> = derived(
    [allCommentEvents, allRootIds],
    ([events, rootIds]) => {
      if (rootIds.length === 0) return []
      // Filter to only comments that reference our root IDs
      return (events || []).filter((event) => {
        const eTags = event.tags.filter((t: string[]) => t[0] === "E" || t[0] === "e")
        return eTags.some((tag: string[]) => rootIds.includes(tag[1]))
      }).filter(isCommentEvent) as CommentEvent[]
    },
  )

  // Load comments reactively when root IDs are available
  // Use a derived store with a side effect to trigger loading
  let lastLoadedIds = new Set<string>()
  const commentLoadTrigger = derived(allRootIds, (rootIds) => {
    if (rootIds.length > 0) {
      const idsKey = rootIds.sort().join(',')
      if (!lastLoadedIds.has(idsKey)) {
        lastLoadedIds.add(idsKey)
        // Trigger load in background (non-blocking)
        load({
          relays: relayListFromUrl as string[],
          filters: [{
            kinds: [COMMENT],
            "#E": rootIds,
          }],
        }).catch(() => {}) // Ignore errors - this is background loading
      }
    }
    return rootIds
  })

  // Subscribe to trigger the load (this is necessary to trigger the derived store)
  // This subscription will be cleaned up automatically when the route changes
  commentLoadTrigger.subscribe(() => {
    // The actual loading is handled in the derived store above
  })

  const emptyRepoStateEvents = derived([], () => [] as RepoStateEvent[])
  const emptyLabelEvents = derived([], () => [] as LabelEvent[])
  const repoClass = new Repo({
    repoEvent,
    repoStateEvent,
    issues,
    patches,
    repoStateEvents: emptyRepoStateEvents as unknown as Readable<RepoStateEvent[]>,
    statusEvents,
    commentEvents,
    labelEvents: emptyLabelEvents as unknown as Readable<LabelEvent[]>,
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
