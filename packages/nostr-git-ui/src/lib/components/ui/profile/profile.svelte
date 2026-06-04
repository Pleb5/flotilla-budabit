<script lang="ts">
  import { Avatar as AvatarPrimitive } from "bits-ui";
  import { cn } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    pubkey: _pubkey,
    hideDetails: _hideDetails,
    relays: _relays = [],
    ...restProps
  }: AvatarPrimitive.RootProps & { pubkey?: string; hideDetails?: boolean; relays?: string[] } =
    $props();
</script>

<AvatarPrimitive.Root
  bind:ref={ref}
  class={cn("relative flex size-10 shrink-0 overflow-hidden rounded-full", className)}
  {...restProps}
/>
