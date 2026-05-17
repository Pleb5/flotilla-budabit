<script lang="ts">
  import {browser} from "$app/environment"
  import {goto} from "$app/navigation"
  import {page} from "$app/stores"
  import Spinner from "@lib/components/Spinner.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import {makeCommunityPath, parseCommunityRouteParam} from "@app/util/routes"

  const parsedCommunity = $derived(parseCommunityRouteParam($page.params.community))

  $effect(() => {
    if (browser && parsedCommunity) {
      void goto(makeCommunityPath(parsedCommunity.pubkey), {replaceState: true})
    }
  })
</script>

<PageContent class="flex h-full items-center justify-center p-4 text-center opacity-70">
  <Spinner loading>Opening community...</Spinner>
</PageContent>
