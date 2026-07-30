<script lang="ts">
  import {page} from "$app/stores"
  import {pubkey} from "@welshman/app"
  import CommunityWidgetSlotLaunchers from "@app/components/community/CommunityWidgetSlotLaunchers.svelte"
  import {
    activeCommunityBootstrapStatus,
    activeCommunityDefinition,
    activeCommunityPermissionStatus,
    activeCommunityRelays,
    activeCommunitySession,
    getCommunityBootstrapKey,
  } from "@app/core/community-state"
  import {normalizePubkey, normalizeRelays} from "@app/core/community"
  import {isCommunityHomeCoreReady} from "@app/extensions/community-home-readiness"
  import {parseCommunityRouteParam} from "@app/util/routes"

  const parsedCommunity = $derived(parseCommunityRouteParam($page.params.community))
  const relayHints = $derived(
    $activeCommunityRelays.length > 0 ? $activeCommunityRelays : parsedCommunity?.relays || [],
  )
  const expectedBootstrapKey = $derived(
    parsedCommunity && $activeCommunitySession?.communityPubkey === parsedCommunity.pubkey
      ? getCommunityBootstrapKey($activeCommunitySession, $pubkey || "")
      : "",
  )
  const expectedPermissionKeyPrefix = $derived(
    parsedCommunity && $activeCommunityDefinition?.pubkey === parsedCommunity.pubkey
      ? `${normalizePubkey($pubkey || "")}:${$activeCommunityDefinition.event.id}:${normalizeRelays($activeCommunityRelays).join(",")}:`
      : "",
  )
  const communityCoreReady = $derived(
    isCommunityHomeCoreReady({
      communityPubkey: parsedCommunity?.pubkey || "",
      definitionPubkey: $activeCommunityDefinition?.pubkey || "",
      expectedBootstrapKey,
      expectedPermissionKeyPrefix,
      bootstrapStatus: $activeCommunityBootstrapStatus,
      permissionStatus: $activeCommunityPermissionStatus,
    }),
  )
</script>

{#if parsedCommunity && communityCoreReady}
  <CommunityWidgetSlotLaunchers
    communityPubkey={parsedCommunity.pubkey}
    {relayHints}
    slotType="global-menu"
    variant="top-menu"
    context={{route: $page.url.pathname}} />
{/if}
