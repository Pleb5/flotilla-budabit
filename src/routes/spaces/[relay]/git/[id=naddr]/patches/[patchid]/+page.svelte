<script lang="ts">
  import {page} from "$app/stores"
  import {getContext, onDestroy} from "svelte"
  import {fade} from "svelte/transition"
  import {getTags, parsePullRequestEvent, GIT_PULL_REQUEST_UPDATE} from "@nostr-git/core/events"
  import type {PatchEvent, PullRequestEvent} from "@nostr-git/core/events"
  import {parseGitPatchFromEvent} from "@nostr-git/core/git"
  import {load, makeLoader} from "@welshman/net"
  import {repository} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {type TrustedEvent} from "@welshman/util"
  import {uniq} from "@welshman/lib"
  import type {Repo} from "@nostr-git/ui"
  import type {Readable} from "svelte/store"
  import {REPO_KEY, REPO_RELAYS_KEY, PULL_REQUESTS_KEY, getRepoScopedRelays} from "@lib/budabit/state"
  import Button from "@lib/components/Button.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import AltArrowUp from "@assets/icons/alt-arrow-up.svg?dataurl"
  import PRView from "@src/lib/budabit/components/PRView.svelte"
  import PatchView from "@src/lib/budabit/components/PatchView.svelte"

  const repoClass = getContext<Repo>(REPO_KEY)
  const repoRelaysStore = getContext<Readable<string[]>>(REPO_RELAYS_KEY)
  const pullRequestsStore = getContext<Readable<PullRequestEvent[]>>(PULL_REQUESTS_KEY)

  if (!repoClass) {
    throw new Error("Repo context not available")
  }

  const repoRelays = $derived.by(() => (repoRelaysStore ? $repoRelaysStore : []) as string[])
  const pullRequests = $derived.by(() => (pullRequestsStore ? $pullRequestsStore : []) as PullRequestEvent[])
  const naddrRelays = $derived.by(() => (($page.data as any)?.naddrRelays || []) as string[])
  const prEditRelays = $derived.by(() => getRepoScopedRelays(repoClass.repoEvent as any, naddrRelays))
  const LOAD_TIMEOUT_MS = 7000
  const loadDetail = makeLoader({delay: 100, timeout: LOAD_TIMEOUT_MS, threshold: 0.5})

  let isResolving = $state(true)
  let didTimeout = $state(false)
  let hasStartedResolve = $state(false)
  let resolveTimeout: ReturnType<typeof setTimeout> | null = null
  let showScrollButton = $state(false)
  let pageContainerRef: HTMLElement | undefined = $state()
  let scrollParent: HTMLElement | null = $state(null)

  const patchId = $derived($page.params.patchid ?? "")
  const getFirstTagValue = (event: {tags?: string[][]} | undefined, tagName: string) =>
    event?.tags?.find(tag => tag[0] === tagName)?.[1] || ""

  const patchEvent = $derived.by(() =>
    repoClass.patches.find((p: {id: string}) => p.id === patchId) as PatchEvent | undefined,
  )
  const directEventStore = $derived.by(() => {
    if (!patchId) return undefined
    return deriveEventsAsc(
      deriveEventsById({
        repository,
        filters: [{ids: [patchId]}],
      }),
    )
  })
  const directEvent = $derived.by(() =>
    directEventStore ? ($directEventStore?.[0] as TrustedEvent | undefined) : undefined,
  )
  const directPatchEvent = $derived.by(() =>
    directEvent && directEvent.kind === 1617 ? (directEvent as PatchEvent) : undefined,
  )

  const prEvent = $derived.by(() =>
    (pullRequests || []).find((pr: PullRequestEvent) => pr.id === patchId) as PullRequestEvent | undefined,
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
    updateRootEventStore ? ($updateRootEventStore?.[0] as TrustedEvent | undefined) : undefined,
  )
  const updateRootPrEvent = $derived.by(() => {
    if (!updateRootId) return undefined
    return (
      (pullRequests || []).find((pr: PullRequestEvent) => pr.id === updateRootId) ||
      (updateRootEvent?.kind === 1618 ? (updateRootEvent as PullRequestEvent) : undefined)
    )
  })
  const directPrEvent = $derived.by(() =>
    directEvent && directEvent.kind === 1618 ? (directEvent as PullRequestEvent) : undefined,
  )
  const resolvedPatchEvent = $derived.by(() => patchEvent || directPatchEvent)
  const resolvedPrEvent = $derived.by(() => prEvent || directPrEvent || updateRootPrEvent)
  const patch = $derived.by(() =>
    resolvedPatchEvent ? parseGitPatchFromEvent(resolvedPatchEvent) : undefined,
  )
  const pr = $derived.by(() => (resolvedPrEvent ? parsePullRequestEvent(resolvedPrEvent) : undefined))

  const clearResolveTimeout = () => {
    if (!resolveTimeout) return
    clearTimeout(resolveTimeout)
    resolveTimeout = null
  }

  const resolveCurrentPatchOrPr = async () => {
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

    const primaryEvents = await loadDetail({
      relays,
      filters: [{ids: [patchId]}],
    }).catch(() => [] as TrustedEvent[])
    const primaryEvent =
      primaryEvents.find(event => event.id === patchId) ||
      (repository.getEvent(patchId) as TrustedEvent | undefined)

    const loadedEvent = primaryEvent
    if (loadedEvent?.kind === GIT_PULL_REQUEST_UPDATE) {
      const rootId =
        getFirstTagValue(loadedEvent as {tags?: string[][]}, "E") ||
        getFirstTagValue(loadedEvent as {tags?: string[][]}, "e")
      if (rootId) {
        await load({
          relays,
          filters: [{ids: [rootId]}],
        }).catch(() => [] as TrustedEvent[])
      }
    }
  }

  $effect(() => {
    void patchId
    hasStartedResolve = false
    isResolving = true
    didTimeout = false
    clearResolveTimeout()
  })

  $effect(() => {
    if (hasStartedResolve || !isResolving) return
    void resolveCurrentPatchOrPr()
  })

  $effect(() => {
    if (!isResolving) return
    if (patch || pr) {
      isResolving = false
      didTimeout = false
      clearResolveTimeout()
    }
  })

  onDestroy(() => {
    hasStartedResolve = false
    clearResolveTimeout()
  })

  const rootPatchId = $derived.by(() => {
    let rootId = patchId
    let currentPatch = resolvedPatchEvent as PatchEvent | null | undefined
    while (currentPatch) {
      const replyTags = getTags(currentPatch, "e")
      if (replyTags.length === 0) break

      const parentId = replyTags[0][1]
      const parentPatch = repoClass.patches.find((p: PatchEvent) => p.id === parentId)
      if (!parentPatch) break

      rootId = parentId
      currentPatch = parentPatch
    }
    return rootId
  })

  const patchSet = $derived.by(() =>
    repoClass.patches
      .filter((p: PatchEvent & {id: string}): p is PatchEvent => {
        if (p.id === patchId) return true
        const directReplyToThis = getTags(p, "e").some((tag) => tag[1] === patchId)
        if (directReplyToThis) return true
        if (rootPatchId !== patchId) {
          const replyTags = getTags(p, "e")
          if (replyTags.length === 0) {
            let checkPatch: PatchEvent | undefined = p
            let foundRoot = false

            while (checkPatch) {
              if (checkPatch.id === rootPatchId) {
                foundRoot = true
                break
              }

              const checkReplyTags: [string, ...string[]][] = getTags(checkPatch, "e")
              if (checkReplyTags.length === 0) break

              const checkParentId: string = checkReplyTags[0][1]
              checkPatch = repoClass.patches.find((p: PatchEvent) => p.id === checkParentId)
              if (!checkPatch) break
            }
            return foundRoot
          }
        }
        return false
      })
      .sort((a: PatchEvent, b: PatchEvent) => a.created_at - b.created_at)
      .sort((a: PatchEvent, b: PatchEvent) => (a.id === rootPatchId ? -1 : 1))
      .map((p: PatchEvent) => parseGitPatchFromEvent(p)),
  )

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

  const scrollToTop = () => {
    scrollParent?.scrollTo({top: 0, behavior: "smooth"})
  }
</script>

<svelte:head>
  <title>{repoClass.name} - {patch?.title || pr?.subject || "Patch"}</title>
</svelte:head>

<div bind:this={pageContainerRef}>
  {#if isResolving}
    <div class="p-4 text-center">Loading patch or pull request...</div>
  {:else if !patch && pr && resolvedPrEvent}
    <PRView
      {pr}
      prEvent={resolvedPrEvent}
      repo={repoClass}
      repoRelays={repoRelays}
      {prEditRelays} />
  {:else if patch && patchSet}
    <PatchView {patch} {patchSet} repo={repoClass} repoRelays={repoRelays} />
  {:else if didTimeout}
    <div class="p-4 text-center text-muted-foreground">Patch or pull request not found.</div>
  {/if}
</div>

{#if showScrollButton}
  <div in:fade class="chat__scroll-down">
  <Button class="btn btn-circle btn-neutral" onclick={scrollToTop}>
    <Icon icon={AltArrowUp} />
  </Button>
  </div>
{/if}
