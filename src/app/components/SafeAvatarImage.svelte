<script lang="ts">
  import {AvatarImage as BaseAvatarImage} from "@nostr-git/ui"

  type Props = {
    ref?: HTMLElement | null
    src?: string | null
    alt?: string
    class?: string
    [key: string]: any
  }

  let {ref = $bindable(null), src, alt = "", ...restProps}: Props = $props()

  const safeSrc = $derived(String(src || "").trim())
</script>

{#if safeSrc}
  <BaseAvatarImage bind:ref src={safeSrc} {alt} {...restProps} />
{/if}
