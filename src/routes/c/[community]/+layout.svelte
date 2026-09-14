<script lang="ts">
  import {onMount, type Snippet} from "svelte"
  import {page} from "$app/stores"
  import PublicCommunityLayout from "@app/components/PublicCommunityLayout.svelte"
  import CommunityAccessShell from "@app/components/CommunityAccessShell.svelte"
  import {
    resolvePrivateCommunityScope,
    privateScopeVersion,
  } from "@app/core/private-community-scope"

  const {children}: {children?: Snippet} = $props()
  let mounted = $state(false)
  onMount(() => {
    mounted = true
  })
  const scope = $derived.by(() => {
    void $privateScopeVersion
    return mounted ? resolvePrivateCommunityScope($page.url) : undefined
  })
</script>

{#if mounted}
  {#if scope}
    {#key JSON.stringify([scope.pointer.address, scope.relays])}
      <CommunityAccessShell {scope} />
    {/key}
  {:else if $page.url.searchParams.has("read-access")}
    <section class="p-6" role="alert">
      Invalid private invitation. Ask the owner for a complete community invitation.
    </section>
  {:else}
    <PublicCommunityLayout {children} />
  {/if}
{/if}
