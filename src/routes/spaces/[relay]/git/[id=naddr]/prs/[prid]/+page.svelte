<script lang="ts">
  import {page} from "$app/stores"
  import {getContext, onDestroy} from "svelte"
  import {fade} from "svelte/transition"
  import {
    getTags,
    parsePullRequestEvent,
    GIT_PULL_REQUEST,
    GIT_PULL_REQUEST_UPDATE,
  } from "@nostr-git/core/events"
  import type {PullRequestEvent} from "@nostr-git/core/events"
  import {load, makeLoader} from "@welshman/net"
  import {repository} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {type TrustedEvent} from "@welshman/util"
  import {uniq} from "@welshman/lib"
  import type {Repo} from "@nostr-git/ui"
  import type {Readable} from "svelte/store"
  import {
    REPO_KEY,
    REPO_RELAYS_KEY,
    PULL_REQUESTS_KEY,
    getRepoScopedRelays,
  } from "@app/core/git-state"
  import Button from "@lib/components/Button.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import AltArrowUp from "@assets/icons/alt-arrow-up.svg?dataurl"
  import PRView from "@src/lib/budabit/components/PRView.svelte"

  const repoClass = getContext<Repo>(REPO_KEY)
  const repoRelaysStore = getContext<Readable<string[]>>(REPO_RELAYS_KEY)
  const pullRequestsStore = getContext<Readable<PullRequestEvent[]>>(PULL_REQUESTS_KEY)

  if (!repoClass) {
    throw new Error("Repo context not available")
  }

  const repoRelays = $derived.by(() => (repoRelaysStore ? $repoRelaysStore : []) as string[])
  const pullRequests = $derived.by(
    () => (pullRequestsStore ? $pullRequestsStore : []) as PullRequestEvent[],
  )
  const naddrRelays = $derived.by(() => (($page.data as any)?.naddrRelays || []) as string[])
  const prEditRelays = $derived.by(() =>
    getRepoScopedRelays(repoClass.repoEvent as any, naddrRelays),
  )
  const LOAD_TIMEOUT_MS = 7000
  const loadDetail = makeLoader({delay: 100, timeout: LOAD_TIMEOUT_MS, threshold: 0.5})

  let isResolving = $state(true)
  let didTimeout = $state(false)
  let hasStartedResolve = $state(false)
  let resolveTimeout: ReturnType<typeof setTimeout> | null = null
  let showScrollButton = $state(false)
  let pageContainerRef: HTMLElement | undefined = $state()
  let scrollParent: HTMLElement | null = $state(null)

  const prId = $derived($page.params.prid ?? "")
  const isDeletedRepositoryEvent = (event?: TrustedEvent) =>
    Boolean(event && (repository as any).isDeleted?.(event))
  const getFirstTagValue = (event: {tags?: string[][]} | undefined, tagName: string) =>
    event?.tags?.find(tag => tag[0] === tagName)?.[1] || ""

  const prEvent = $derived.by(
    () =>
      (pullRequests || []).find((pr: PullRequestEvent) => pr.id === prId) as
        | PullRequestEvent
        | undefined,
  )
  const directEventStore = $derived.by(() => {
    if (!prId) return undefined
    return deriveEventsAsc(
      deriveEventsById({
        repository,
        filters: [{ids: [prId]}],
      }),
    )
  })
  const directEvent = $derived.by(() =>
    directEventStore &&
    !isDeletedRepositoryEvent($directEventStore?.[0] as TrustedEvent | undefined)
      ? ($directEventStore?.[0] as TrustedEvent | undefined)
      : undefined,
  )
  const directPrEvent = $derived.by(() =>
    directEvent && directEvent.kind === GIT_PULL_REQUEST
      ? (directEvent as PullRequestEvent)
      : undefined,
  )
  const updateRootId = $derived.by(() => {
    if (!directEvent || directEvent.kind !== GIT_PULL_REQUEST_UPDATE) return ""
    return getFirstTagValue(directEvent, "E") || getFirstTagValue(directEvent, "e") || ""
  })
  const updateRootEventStore = $derived.by(() => {
    if (!updateRootId) return undefined
    return deriveEventsAsc(
      deriveEventsById({
        repository,
        filters: [{ids: [updateRootId]}],
      }),
    )
  })
  const updateRootEvent = $derived.by(() =>
    updateRootEventStore &&
    !isDeletedRepositoryEvent($updateRootEventStore?.[0] as TrustedEvent | undefined)
      ? ($updateRootEventStore?.[0] as TrustedEvent | undefined)
      : undefined,
  )
  const updateRootPrEvent = $derived.by(() => {
    if (!updateRootId) return undefined
    return (
      (pullRequests || []).find((pr: PullRequestEvent) => pr.id === updateRootId) ||
      (updateRootEvent?.kind === GIT_PULL_REQUEST
        ? (updateRootEvent as PullRequestEvent)
        : undefined)
    )
  })
  const resolvedPrEvent = $derived.by(() => prEvent || directPrEvent || updateRootPrEvent)
  const pr = $derived.by(() =>
    resolvedPrEvent ? parsePullRequestEvent(resolvedPrEvent) : undefined,
  )

  const clearResolveTimeout = () => {
    if (!resolveTimeout) return
    clearTimeout(resolveTimeout)
    resolveTimeout = null
  }

  const resolveCurrentPr = async () => {
    const relays = uniq(repoRelays.filter(Boolean))
    if (relays.length === 0) {
      hasStartedResolve = false
      return
    }

    clearResolveTimeout()
    isResolving = true
    didTimeout = false
    hasStartedResolve = true

    resolveTimeout = setTimeout(() => {
      didTimeout = true
      isResolving = false
    }, LOAD_TIMEOUT_MS)

    const primaryEvents = await loadDetail({relays, filters: [{ids: [prId]}]}).catch(
      () => [] as TrustedEvent[],
    )
    const primaryEvent =
      primaryEvents.find(event => event.id === prId && !isDeletedRepositoryEvent(event)) ||
      (() => {
        const event = repository.getEvent(prId) as TrustedEvent | undefined
        return isDeletedRepositoryEvent(event) ? undefined : event
      })()

    if (primaryEvent?.kind === GIT_PULL_REQUEST_UPDATE) {
      const rootId =
        getFirstTagValue(primaryEvent as {tags?: string[][]}, "E") ||
        getFirstTagValue(primaryEvent as {tags?: string[][]}, "e")
      if (rootId) {
        await load({relays, filters: [{ids: [rootId]}]}).catch(() => [] as TrustedEvent[])
      }
    }
  }

  $effect(() => {
    void prId
    hasStartedResolve = false
    isResolving = true
    didTimeout = false
    clearResolveTimeout()
  })

  $effect(() => {
    if (hasStartedResolve || !isResolving) return
    void resolveCurrentPr()
  })

  $effect(() => {
    if (!isResolving) return
    if (pr) {
      isResolving = false
      didTimeout = false
      clearResolveTimeout()
    }
  })

  $effect(() => {
    const container = pageContainerRef
    if (!container) return
    scrollParent = container.closest(".scroll-container") as HTMLElement | null
  })

  $effect(() => {
    const scrollEl = scrollParent
    if (!scrollEl) return
    const syncScrollState = () => {
      showScrollButton = scrollEl.scrollTop > 1500
    }
    syncScrollState()
    scrollEl.addEventListener("scroll", syncScrollState, {passive: true})
    return () => scrollEl.removeEventListener("scroll", syncScrollState)
  })

  onDestroy(() => {
    hasStartedResolve = false
    clearResolveTimeout()
  })
</script>

<svelte:head>
  <title>{repoClass.name} - {pr?.subject || "PR"}</title>
</svelte:head>

<div bind:this={pageContainerRef}>
  {#if isResolving}
    <div class="p-4 text-center">Loading pull request...</div>
  {:else if pr && resolvedPrEvent}
    <PRView {pr} prEvent={resolvedPrEvent} repo={repoClass} {repoRelays} {prEditRelays} />
  {:else if didTimeout}
    <div class="p-4 text-center text-muted-foreground">Pull request not found.</div>
  {/if}
</div>

{#if showScrollButton}
  <div in:fade class="chat__scroll-down">
    <Button
      class="btn btn-circle btn-neutral"
      onclick={() => scrollParent?.scrollTo({top: 0, behavior: "smooth"})}>
      <Icon icon={AltArrowUp} />
    </Button>
  </div>
{/if}
