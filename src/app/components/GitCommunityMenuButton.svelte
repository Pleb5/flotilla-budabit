<script lang="ts">
  import CommunityMenu from "@app/components/CommunityMenu.svelte"
  import {activeCommunitySession} from "@app/core/community-state"
  import {pushDrawer} from "@app/util/modal"
  import MenuDots from "@assets/icons/menu-dots.svg?dataurl"
  import Button from "@lib/components/Button.svelte"
  import Icon from "@lib/components/Icon.svelte"

  const activeCommunityPubkey = $derived($activeCommunitySession?.communityPubkey || "")

  const openCommunityMenu = () => {
    if (activeCommunityPubkey) {
      pushDrawer(CommunityMenu, {community: activeCommunityPubkey}, {replaceState: true})
    }
  }
</script>

{#if activeCommunityPubkey}
  <Button aria-label="Open community menu" onclick={openCommunityMenu} class="btn btn-neutral btn-sm">
    <Icon icon={MenuDots} />
  </Button>
{/if}
