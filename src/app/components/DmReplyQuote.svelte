<script lang="ts">
  import type {TrustedEvent} from "@welshman/util"
  import {getPlaintext, pubkey, profilesByPubkey} from "@welshman/app"
  import {displayProfile, displayPubkey} from "@welshman/util"
  import {ensureDmPlaintext} from "@app/core/dm"

  const {parent}: {parent?: TrustedEvent} = $props()
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
  {#if parent}<div class="truncate text-xs font-bold">
      {parent.pubkey === $pubkey
        ? "You"
        : displayProfile($profilesByPubkey.get(parent.pubkey), displayPubkey(parent.pubkey))}
    </div>{/if}
  <div class="line-clamp-2 whitespace-pre-wrap break-words">
    {parent ? (text ?? "Encrypted message") : "Original message unavailable"}
  </div>
</div>
