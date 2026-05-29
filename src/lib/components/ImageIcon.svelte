<script lang="ts">
  import Icon from "@lib/components/Icon.svelte"
  import {warnEmptyImageSource} from "@app/core/diagnostics"

  type Props = {
    src?: string | null
    alt: string
    size?: number
    class?: string
  }

  const {src, alt, size = 5, ...props}: Props = $props()

  let failedSrc = $state("")

  const safeSrc = $derived(String(src || "").trim())
  const imageFailed = $derived(Boolean(safeSrc && failedSrc === safeSrc))

  const markImageFailed = () => {
    failedSrc = safeSrc
  }

  $effect(() => {
    if (src !== undefined && !safeSrc) warnEmptyImageSource("ImageIcon")
  })
</script>

{#if !safeSrc || imageFailed}
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
    onerror={markImageFailed}
    class="h-{size} w-{size} min-w-{size} min-h-{size} aspect-square object-cover {props.class}" />
{/if}
