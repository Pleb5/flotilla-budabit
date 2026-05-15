<script lang="ts">
  import {page} from "$app/stores"
  import {pubkey} from "@welshman/app"
  import Settings from "@assets/icons/settings.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import CommunityCreate from "@app/components/CommunityCreate.svelte"
  import CommunityMenuButton from "@app/components/CommunityMenuButton.svelte"
  import {activeCommunityDefinition, activeCommunityProfile} from "@app/core/community-state"
  import {normalizePubkey} from "@app/core/community"
  import {parseCommunityRouteParam} from "@app/util/routes"

  const parsedCommunity = $derived(parseCommunityRouteParam($page.params.community))
  const communityPubkey = $derived(parsedCommunity?.pubkey || "")
  const canEditCommunity = $derived(
    Boolean(
      $pubkey &&
      $activeCommunityDefinition &&
      normalizePubkey($pubkey) === normalizePubkey($activeCommunityDefinition.pubkey),
    ),
  )
</script>

<PageBar>
  {#snippet icon()}
    <div class="center"><Icon icon={Settings} /></div>
  {/snippet}
  {#snippet title()}<strong>Community Admin</strong>{/snippet}
  {#snippet action()}
    <CommunityMenuButton community={communityPubkey} />
  {/snippet}
</PageBar>

<PageContent class="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 md:p-8">
  {#if !$activeCommunityDefinition}
    <p class="py-8 text-center opacity-70">Community definition is not loaded.</p>
  {:else if !canEditCommunity}
    <p class="py-8 text-center opacity-70">
      Log in as this community pubkey to publish community definition updates.
    </p>
  {:else}
    <CommunityCreate
      mode="edit"
      definition={$activeCommunityDefinition}
      profile={$activeCommunityProfile}
      embedded />
  {/if}
</PageContent>
