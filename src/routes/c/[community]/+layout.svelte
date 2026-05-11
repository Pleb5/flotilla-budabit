<script lang="ts">
  import type {Snippet} from "svelte"
  import {onMount} from "svelte"
  import {page} from "$app/stores"
  import Page from "@lib/components/Page.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import {parseCommunityRouteParam} from "@app/util/routes"
  import {
    loadCommunityBootstrap,
    makeCommunitySession,
    setActiveCommunityDefinition,
    setActiveCommunityInput,
  } from "@app/core/community-state"

  type Props = {
    children?: Snippet
  }

  const {children}: Props = $props()

  const parsedCommunity = $derived(parseCommunityRouteParam($page.params.community))

  let loading = $state(true)
  let loadError = $state("")

  onMount(() => {
    let cancelled = false

    const load = async () => {
      loading = true
      loadError = ""

      if (!parsedCommunity) {
        loading = false
        return
      }

      setActiveCommunityInput(decodeURIComponent($page.params.community || ""))

      try {
        const bootstrap = await loadCommunityBootstrap(makeCommunitySession(parsedCommunity))
        if (!cancelled && bootstrap.definition) {
          setActiveCommunityDefinition(bootstrap.definition)
        }
      } catch (error) {
        if (!cancelled) {
          loadError = String(error)
        }
      } finally {
        if (!cancelled) {
          loading = false
        }
      }
    }

    load()

    return () => {
      cancelled = true
    }
  })
</script>

<Page>
  {#if !parsedCommunity}
    <div class="content p-4">
      <h1 class="text-2xl font-bold">Invalid community</h1>
      <p>Use a valid community npub, hex pubkey, or encoded ncommunity value.</p>
    </div>
  {:else if loading}
    <div class="flex min-h-80 items-center justify-center">
      <Spinner loading>Loading community...</Spinner>
    </div>
  {:else}
    {#if loadError}
      <div class="content p-4 text-warning">
        Community metadata could not be fully loaded: {loadError}
      </div>
    {/if}
    {@render children?.()}
  {/if}
</Page>
