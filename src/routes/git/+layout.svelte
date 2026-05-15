<script lang="ts">
  import type {Snippet} from "svelte"
  import CommunityMenu from "@app/components/CommunityMenu.svelte"
  import {activeCommunitySession} from "@app/core/community-state"
  import SecondaryNav from "@lib/components/SecondaryNav.svelte"

  type Props = {
    children?: Snippet
  }

  const {children}: Props = $props()
  const activeCommunityPubkey = $derived($activeCommunitySession?.communityPubkey || "")
</script>

{#if activeCommunityPubkey}
  <SecondaryNav>
    <CommunityMenu community={activeCommunityPubkey} />
  </SecondaryNav>
{/if}

{@render children?.()}
