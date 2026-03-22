<script lang="ts">
  import {page} from "$app/stores"
  import {goto} from "$app/navigation"
  import type {MakeNonOptional} from "@welshman/lib"
  import {uniq} from "@welshman/lib"
  import {pubkey} from "@welshman/app"
  import Chat from "@lib/budabit/components/Chat.svelte"
  import {notifications, setChecked} from "@app/util/notifications"

  const {chat} = $page.params as MakeNonOptional<typeof $page.params>

  const recipient = $derived(chat.split(",")[0])

  // Derive pubkeys reactively - only valid when user is logged in
  const pubkeys = $derived($pubkey && recipient ? uniq([$pubkey, recipient]) : [])

  $effect(() => {
    if (chat.includes(",")) {
      goto("/chat", {replaceState: true})
    }
  })

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
