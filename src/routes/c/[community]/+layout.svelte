<script lang="ts">
  import {untrack, type Snippet} from "svelte"
  import {page} from "$app/stores"
  import CommunityLayout from "@app/components/CommunityLayout.svelte"
  import CommunityRelayAccess from "@app/components/CommunityRelayAccess.svelte"
  import {
    resolvePrivateCommunityScope,
    type PrivateCommunityScope,
  } from "@app/core/private-community-scope"

  const {children}: {children?: Snippet} = $props()
  let resolved = $state<{url: URL; scope?: PrivateCommunityScope}>()
  $effect.pre(() => {
    const url = $page.url
    // Register consent before loaders on initial and client-side navigation.
    untrack(() => {
      resolved = {url, scope: resolvePrivateCommunityScope(url)}
    })
  })
  const scope = $derived(resolved?.scope)
  const invalidInvite = $derived(
    $page.url.searchParams.has("read-access") && (!scope || scope.error),
  )
</script>

{#if resolved?.url === $page.url}
  {#if invalidInvite}
    <section class="p-6" role="alert">
      Invalid private invitation. Ask the owner for a complete community invitation.
    </section>
  {:else}
    <CommunityLayout {children} connection={scope ? connection : undefined} />
  {/if}
{/if}

{#snippet connection()}
  {#if scope}
    {#key JSON.stringify([scope.pointer.address, scope.relays])}
      <CommunityRelayAccess {scope} />
    {/key}
  {/if}
{/snippet}
