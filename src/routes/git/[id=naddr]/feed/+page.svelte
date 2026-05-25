<script lang="ts">
  import {getContext} from "svelte"
  import {page} from "$app/stores"
  import {formatTimestampAsDate} from "@welshman/lib"
  import type {TrustedEvent} from "@welshman/util"
  import {
    GIT_ISSUE,
    GIT_STATUS_CLOSED,
    GIT_STATUS_COMPLETE,
    GIT_STATUS_DRAFT,
    GIT_STATUS_OPEN,
  } from "@welshman/util"
  import type {Readable} from "svelte/store"
  import Spinner from "@lib/components/Spinner.svelte"
  import RepoFeedGitItem from "@app/components/RepoFeedGitItem.svelte"
  import {
    REPO_FEED_ACTIVITY_KEY,
    REPO_KEY,
    REPO_RELAYS_KEY,
    STATUS_EVENTS_BY_ROOT_KEY,
  } from "@app/core/git-state"
  import type {Repo} from "@nostr-git/ui"
  import type {StatusEvent} from "@nostr-git/core/events"

  type ActivityElement =
    | {type: "date"; id: string; value: string}
    | {type: "activity"; id: string; value: TrustedEvent}

  const repoClass = getContext<Repo>(REPO_KEY)
  const repoRelaysStore = getContext<Readable<string[]>>(REPO_RELAYS_KEY)
  const repoFeedActivityStore = getContext<Readable<TrustedEvent[]>>(REPO_FEED_ACTIVITY_KEY)
  const statusEventsByRootStore =
    getContext<Readable<Map<string, StatusEvent[]>>>(STATUS_EVENTS_BY_ROOT_KEY)

  if (!repoClass) {
    throw new Error("Repo context not available")
  }

  const routeUrl = (($page.data as any)?.url || "") as string
  const basePath = $derived.by(() => $page.url.pathname.replace(/\/feed$/, ""))
  const repoFeedActivity = $derived.by(() => $repoFeedActivityStore || [])
  const repoRelays = $derived.by(() => $repoRelaysStore || [])
  const statusEventsByRoot = $derived.by(() => $statusEventsByRootStore || new Map())
  const defaultThreadCommunityPubkey = $derived(repoClass.community?.pubkey || "")

  const activityEvents = $derived.by(() => {
    const deduped = new Map<string, TrustedEvent>()

    for (const event of repoFeedActivity) {
      deduped.set(event.id, event)
    }

    return Array.from(deduped.values()).sort(
      (a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id),
    )
  })

  const elements = $derived.by((): ActivityElement[] => {
    const nextElements: ActivityElement[] = []
    let previousDate = ""

    for (const event of activityEvents) {
      const date = formatTimestampAsDate(event.created_at)

      if (date !== previousDate) {
        nextElements.push({type: "date", id: `date:${date}`, value: date})
        previousDate = date
      }

      nextElements.push({type: "activity", id: event.id, value: event})
    }

    return nextElements
  })

  const getOpenHref = (event: TrustedEvent) =>
    event.kind === GIT_ISSUE ? `${basePath}/issues/${event.id}` : `${basePath}/prs/${event.id}`

  const statusStateById = $derived.by(() => {
    const byId = new Map<string, "open" | "draft" | "closed" | "applied">()

    for (const event of repoFeedActivity) {
      const statusEvent = statusEventsByRoot.get(event.id)?.at(-1)

      switch (statusEvent?.kind) {
        case GIT_STATUS_DRAFT:
          byId.set(event.id, "draft")
          break
        case GIT_STATUS_CLOSED:
          byId.set(event.id, "closed")
          break
        case GIT_STATUS_COMPLETE:
          byId.set(event.id, "applied")
          break
        case GIT_STATUS_OPEN:
        default:
          byId.set(event.id, "open")
          break
      }
    }

    return byId
  })
</script>

<svelte:head>
  <title>{repoClass.name} - Activity</title>
</svelte:head>

<div class="mx-auto flex w-full max-w-4xl flex-col gap-4 px-1 py-2 sm:px-2">
  {#if elements.length === 0}
    <div
      class="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
      <Spinner>No repository activity yet.</Spinner>
    </div>
  {:else}
    <div class="flex flex-col gap-2">
      {#each elements as element (element.id)}
        {#if element.type === "date"}
          <div class="z-10 sticky top-0 flex items-center gap-3 py-2">
            <div class="h-px flex-1 bg-border"></div>
            <span
              class="rounded-full border border-border bg-base-100 px-3 py-1 text-xs text-muted-foreground shadow-sm">
              {element.value}
            </span>
            <div class="h-px flex-1 bg-border"></div>
          </div>
        {:else}
          <RepoFeedGitItem
            url={routeUrl}
            interactionRelays={repoRelays}
            event={element.value}
            openHref={getOpenHref(element.value)}
            statusState={statusStateById.get(element.value.id) || "open"}
            {defaultThreadCommunityPubkey} />
        {/if}
      {/each}
    </div>
  {/if}
</div>
