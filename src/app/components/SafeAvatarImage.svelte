<script lang="ts">
  import {AvatarImage as BaseAvatarImage} from "@nostr-git/ui"
  import {warnEmptyImageSource} from "@app/core/diagnostics"

  type Props = {
    ref?: HTMLElement | null
    src?: string | null
    alt?: string
    class?: string
    [key: string]: any
  }

  let {ref = $bindable(null), src, alt = "", ...restProps}: Props = $props()

  const safeSrc = $derived(String(src || "").trim())

  $effect(() => {
    if (src !== undefined && !safeSrc) warnEmptyImageSource("SafeAvatarImage")
  })
</script>

{#if safeSrc}
  <BaseAvatarImage bind:ref src={safeSrc} {alt} {...restProps} />
{/if}
