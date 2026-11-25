<script lang="ts">
  import type {TrustedEvent} from "@welshman/util"
  import {getPlaintext, pubkey} from "@welshman/app"
  import {ensureDmPlaintext} from "@app/core/dm"
  import {deriveBudabitProfileDisplay} from "@app/core/profile-resolver"

  const {
    parent,
    parentId,
    relays = [],
  }: {parent?: TrustedEvent; parentId?: string; relays?: string[]} = $props()
  const parentAuthorDisplay = $derived(
    parent && parent.pubkey !== $pubkey
      ? deriveBudabitProfileDisplay(parent.pubkey, {relays})
      : undefined,
  )
  let text = $state<string | undefined>()
  $effect(() => {
    const controller = new AbortController()
    text = parent ? getPlaintext(parent) : undefined
    if (parent && $pubkey && text === undefined) {
      ensureDmPlaintext(parent, $pubkey, {signal: controller.signal})
        .then(value => {
          if (!controller.signal.aborted) text = value
        })
        .catch(() => {})
    }
    return () => controller.abort()
  })
</script>

<div class="min-w-0 border-l-2 border-primary pl-2 text-sm">
  {#if parent}
    <div class="truncate text-xs font-bold">
      {parent.pubkey === $pubkey ? "You" : $parentAuthorDisplay}
    </div>
  {:else if parentId}
    <div class="truncate text-xs font-semibold opacity-70">↩ Reply · tap to load</div>
  {/if}
  <div class="line-clamp-2 whitespace-pre-wrap break-words">
    {parent ? (text ?? "Encrypted message") : "Original message unavailable"}
  </div>
</div>
