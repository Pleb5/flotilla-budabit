<script lang="ts">
  import {page} from "$app/stores"
  import type {MakeNonOptional} from "@welshman/lib"
  import {append, uniq} from "@welshman/lib"
  import {pubkey} from "@welshman/app"
  import Chat from "@app/components/Chat.svelte"
  import {notifications, setChecked} from "@app/util/notifications"
  import {splitChatId} from "@app/core/state"

  const {chat} = $page.params as MakeNonOptional<typeof $page.params>

  // Derive pubkeys reactively - only valid when user is logged in
  const pubkeys = $derived($pubkey ? uniq(append($pubkey, splitChatId(chat))) : [])

  // We have to watch this one, since on mobile the badge will be visible when active
  $effect(() => {
    if ($notifications.has($page.url.pathname)) {
      setChecked($page.url.pathname)
    }
  })
</script>

{#if $pubkey && pubkeys.length > 0}
  <Chat {pubkeys} />
{:else}
  <div class="flex items-center justify-center h-full">
    <p class="text-muted-foreground">Please log in to access chat.</p>
  </div>
{/if}
