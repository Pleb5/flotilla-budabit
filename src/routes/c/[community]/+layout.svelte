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
  // Modal hashes are UI state, not a new community scope. Comparing URL objects
  // briefly hid and remounted the whole editor on every modal open/close, losing
  // unsaved drafts and the PageContent scroll position.
  const scopeKey = $derived($page.url.pathname + $page.url.search)
  let resolved = $state<{key: string; scope?: PrivateCommunityScope}>()
  $effect.pre(() => {
    const key = scopeKey
    // Register consent before loaders on initial and client-side navigation.
    untrack(() => {
      resolved = {key, scope: resolvePrivateCommunityScope($page.url)}
    })
  })
  const scope = $derived(resolved?.scope)
  const invalidInvite = $derived(
    $page.url.searchParams.has("read-access") && (!scope || scope.error),
  )
</script>

{#if resolved?.key === scopeKey}
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
