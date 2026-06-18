<script lang="ts">
  import {page} from "$app/stores"
  import CommunityWidgetSlotLaunchers from "@app/components/community/CommunityWidgetSlotLaunchers.svelte"
  import {activeCommunityRelays} from "@app/core/community-state"
  import {parseCommunityRouteParam} from "@app/util/routes"

  const parsedCommunity = $derived(parseCommunityRouteParam($page.params.community))
  const relayHints = $derived(
    $activeCommunityRelays.length > 0 ? $activeCommunityRelays : parsedCommunity?.relays || [],
  )
</script>

{#if parsedCommunity}
  <CommunityWidgetSlotLaunchers
    communityPubkey={parsedCommunity.pubkey}
    {relayHints}
    slotType="global-menu"
    variant="top-menu"
    context={{route: $page.url.pathname}} />
{/if}
