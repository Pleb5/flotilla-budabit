<script lang="ts">
  import Icon from "@lib/components/Icon.svelte"

  type Props = {
    src?: string | null
    alt: string
    size?: number
    class?: string
  }

  const {src, alt, size = 5, ...props}: Props = $props()

  const safeSrc = $derived(String(src || "").trim())
</script>

{#if !safeSrc}
  <span
    role={alt ? "img" : undefined}
    aria-label={alt || undefined}
    class="inline-block h-{size} w-{size} min-w-{size} min-h-{size} aspect-square {props.class}">
  </span>
{:else if safeSrc.includes("image/svg") || safeSrc.endsWith(".svg")}
  <Icon icon={safeSrc} {size} class={props.class} />
{:else}
  <img
    src={safeSrc}
    {alt}
    class="h-{size} w-{size} min-w-{size} min-h-{size} aspect-square object-cover {props.class}" />
{/if}
