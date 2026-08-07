<script lang="ts">
  import {page} from "$app/stores"
  import {getContext, onDestroy} from "svelte"
  import {fade} from "svelte/transition"
  import {
    parsePullRequestEvent,
    GIT_PULL_REQUEST,
    GIT_PULL_REQUEST_UPDATE,
  } from "@nostr-git/core/events"
  import type {PullRequestEvent} from "@nostr-git/core/events"
  import {makeLoader} from "@welshman/net"
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
    HIDDEN_ROOT_IDS_KEY,
  } from "@app/core/git-state"
  import Button from "@lib/components/Button.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import AltArrowUp from "@assets/icons/alt-arrow-up.svg?dataurl"
  import PRView from "@app/components/PRView.svelte"

  const repoClass = getContext<Repo>(REPO_KEY)
  const repoRelaysStore = getContext<Readable<string[]>>(REPO_RELAYS_KEY)
  const pullRequestsStore = getContext<Readable<PullRequestEvent[]>>(PULL_REQUESTS_KEY)
  const hiddenRootIdsStore = getContext<Readable<Set<string>>>(HIDDEN_ROOT_IDS_KEY)

  if (!repoClass) {
    throw new Error("Repo context not available")
  }

  const repoRelays = $derived.by(() => (repoRelaysStore ? $repoRelaysStore : []) as string[])
  const pullRequests = $derived.by(
    () => (pullRequestsStore ? $pullRequestsStore : []) as PullRequestEvent[],
  )
  const prEditRelays = $derived(repoRelays)
  const hasRepoAnnouncement = $derived.by(() => Boolean(repoClass.repoEvent))
  const repoRelaysUnavailable = $derived(hasRepoAnnouncement && repoRelays.length === 0)
  const LOAD_TIMEOUT_MS = 15_000
  const SCROLL_TO_TOP_THRESHOLD = 300
  const loadDetail = makeLoader({delay: 100, timeout: LOAD_TIMEOUT_MS, threshold: 0.5})

  let isResolving = $state(true)
  let didTimeout = $state(false)
  let hasStartedResolve = $state(false)
  let resolvingPrId = $state("")
  let resolveTimeout: ReturnType<typeof setTimeout> | null = null
  let resolveController: AbortController | null = null
  let showScrollButton = $state(false)
  let pageContainerRef: HTMLElement | undefined = $state()
  let scrollParent: HTMLElement | null = $state(null)

  const prId = $derived($page.params.prid ?? "")
  const hiddenRootIds = $derived.by(() =>
    hiddenRootIdsStore ? $hiddenRootIdsStore : new Set<string>(),
  )
  const isHiddenRoot = $derived.by(() => hiddenRootIds.has(prId))
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

  const cancelResolve = () => {
    if (resolveTimeout) {
      clearTimeout(resolveTimeout)
      resolveTimeout = null
    }
    resolveController?.abort()
    resolveController = null
  }

  const resolveCurrentPr = async () => {
    const currentPrId = prId
    const relays = uniq(repoRelays.filter(Boolean))
    if (!currentPrId || relays.length === 0) return

    cancelResolve()
    isResolving = true
    didTimeout = false
    hasStartedResolve = true
    resolvingPrId = currentPrId
    const controller = new AbortController()
    resolveController = controller

    resolveTimeout = setTimeout(() => {
      if (resolveController !== controller) return
      resolveTimeout = null
      didTimeout = true
      isResolving = false
      controller.abort()
      resolveController = null
    }, LOAD_TIMEOUT_MS)

    const primaryEvents = await loadDetail({
      relays,
      filters: [{ids: [currentPrId]}],
      signal: controller.signal,
    }).catch(() => [] as TrustedEvent[])
    if (controller.signal.aborted) return

    const primaryEvent =
      primaryEvents.find(event => event.id === currentPrId && !isDeletedRepositoryEvent(event)) ||
      (() => {
        const event = repository.getEvent(currentPrId) as TrustedEvent | undefined
        return isDeletedRepositoryEvent(event) ? undefined : event
      })()

    if (primaryEvent?.kind === GIT_PULL_REQUEST_UPDATE) {
      const rootId =
        getFirstTagValue(primaryEvent as {tags?: string[][]}, "E") ||
        getFirstTagValue(primaryEvent as {tags?: string[][]}, "e")
      if (rootId) {
        await loadDetail({relays, filters: [{ids: [rootId]}], signal: controller.signal}).catch(
          () => [] as TrustedEvent[],
        )
      }
    }
  }

  $effect(() => {
    void prId
    void repoRelays
    hasStartedResolve = false
    isResolving = true
    didTimeout = false
    cancelResolve()
  })

  $effect(() => {
    if (hasStartedResolve || !isResolving || !prId || repoRelays.length === 0) return
    void resolveCurrentPr()
  })

  $effect(() => {
    if (!isResolving) return
    if (pr) {
      isResolving = false
      didTimeout = false
      cancelResolve()
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
      showScrollButton = scrollEl.scrollTop > SCROLL_TO_TOP_THRESHOLD
    }
    syncScrollState()
    scrollEl.addEventListener("scroll", syncScrollState, {passive: true})
    return () => scrollEl.removeEventListener("scroll", syncScrollState)
  })

  const scrollToTop = () => {
    scrollParent?.scrollTo({top: 0, behavior: "smooth"})
  }

  onDestroy(() => {
    hasStartedResolve = false
    cancelResolve()
  })
</script>

<svelte:head>
  <title>{repoClass.name} - {pr?.subject || "PR"}</title>
</svelte:head>

<div bind:this={pageContainerRef}>
  {#if isHiddenRoot}
    <div class="p-4 text-center text-muted-foreground">This pull request was hidden as spam.</div>
  {:else if pr && resolvedPrEvent}
    <PRView {pr} prEvent={resolvedPrEvent} repo={repoClass} {repoRelays} {prEditRelays} />
  {:else if repoRelaysUnavailable}
    <div class="p-4 text-center">
      <p class="font-medium">Repository Relays Unavailable</p>
      <p class="mt-1 text-sm text-muted-foreground">
        This pull request cannot be loaded until a valid repository announcement declares at least
        one relay.
      </p>
    </div>
  {:else if resolvingPrId !== prId || isResolving}
    <div class="p-4 text-center">Loading pull request...</div>
  {:else if resolvingPrId === prId && didTimeout}
    <div class="p-4 text-center text-muted-foreground">Pull request not found.</div>
  {/if}
</div>

{#if showScrollButton}
  <div in:fade class="chat__scroll-down !z-[20]">
    <Button class="btn btn-circle btn-neutral" onclick={scrollToTop}>
      <Icon icon={AltArrowUp} />
    </Button>
  </div>
{/if}
