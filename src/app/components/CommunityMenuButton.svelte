<script lang="ts">
  import CommunityMenu from "@app/components/CommunityMenu.svelte"
  import {pubkey} from "@welshman/app"
  import {activeCommunitySession} from "@app/core/community-state"
  import {pushDrawer} from "@app/util/modal"
  import MenuDots from "@assets/icons/menu-dots.svg?dataurl"
  import Button from "@lib/components/Button.svelte"
  import Icon from "@lib/components/Icon.svelte"

  type Props = {
    community?: string
  }

  const {community}: Props = $props()
  const communityPubkey = $derived(community || $activeCommunitySession?.communityPubkey || "")

  const openCommunityMenu = () => {
    if (communityPubkey) pushDrawer(CommunityMenu, {community: communityPubkey}, {replaceState: true})
  }
</script>

{#if communityPubkey}
  <Button
    aria-label="Open community menu"
    onclick={openCommunityMenu}
    class={`btn btn-neutral btn-sm ${$pubkey ? "lg:hidden" : ""}`}>
    <Icon icon={MenuDots} />
  </Button>
{/if}
