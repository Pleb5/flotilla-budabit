<script lang="ts">
  import {page} from "$app/stores"
  import type {Snippet} from "svelte"
  import {onDestroy, onMount, setContext} from "svelte"
  import {writable} from "svelte/store"
  import CommunityMenu from "@app/components/CommunityMenu.svelte"
  import {activeExactCommunityPointer} from "@app/core/community-state"
  import {REPO_LIST_HYDRATION_READY_KEY} from "@app/core/git-state"
  import {preloadRepositoryList} from "@app/core/repo-list-preload"
  import {createGitRepoCollections} from "@app/core/repo-collection-context"
  import {REPO_COLLECTION_CONTEXT_KEY} from "@app/core/repo-collection-loader"
  import SecondaryNav from "@lib/components/SecondaryNav.svelte"

  type Props = {
    children?: Snippet
  }

  const {children}: Props = $props()
  const repoListHydrationReady = writable(false)
  const repoCollections = createGitRepoCollections()
  setContext(REPO_COLLECTION_CONTEXT_KEY, repoCollections)
  onMount(() => repoCollections.start())
  let repoListPreloadController: AbortController | null = null
  let repoListPreloadStarted = false

  const stopRepoListPreload = () => {
    repoListPreloadController?.abort()
    repoListPreloadController = null
  }

  setContext(REPO_LIST_HYDRATION_READY_KEY, repoListHydrationReady)

  $effect(() => {
    const isRepositoryList = $page.route.id === "/git"

    if (!isRepositoryList || repoListPreloadStarted) return

    repoListPreloadStarted = true
    const controller = new AbortController()
    repoListPreloadController = controller
    void preloadRepositoryList({
      signal: controller.signal,
      onHydrated: () => {
        if (!controller.signal.aborted) repoListHydrationReady.set(true)
      },
      onHydrationError: error => {
        console.warn("[repo-list] Failed to hydrate eligible repository announcements", error)
      },
    }).catch(error => {
      if (!controller.signal.aborted) {
        console.warn("[repo-list] Failed to preload repository announcements", error)
      }
    })
  })

  onDestroy(() => {
    repoCollections.dispose()
    stopRepoListPreload()
    repoListHydrationReady.set(false)
  })
</script>

{#if $activeExactCommunityPointer}
  <SecondaryNav>
    <CommunityMenu community={$activeExactCommunityPointer} />
  </SecondaryNav>
{/if}

{@render children?.()}
