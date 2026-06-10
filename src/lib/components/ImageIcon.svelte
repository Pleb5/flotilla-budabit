<script lang="ts">
  import Icon from "@lib/components/Icon.svelte"
  import {warnEmptyImageSource} from "@app/core/diagnostics"

  type Props = {
    src?: string | null
    fallbackSrc?: string | null
    alt: string
    size?: number
    class?: string
  }

  const {src, fallbackSrc, alt, size = 5, ...props}: Props = $props()

  let failedSources = $state<string[]>([])

  const safeSrc = $derived(String(src || "").trim())
  const safeFallbackSrc = $derived(String(fallbackSrc || "").trim())
  const imageFailed = $derived(Boolean(safeSrc && failedSources.includes(safeSrc)))
  const activeSrc = $derived(!safeSrc || imageFailed ? safeFallbackSrc : safeSrc)
  const activeImageFailed = $derived(Boolean(activeSrc && failedSources.includes(activeSrc)))

  const markImageFailed = () => {
    if (activeSrc && !failedSources.includes(activeSrc))
      failedSources = [...failedSources, activeSrc]
  }

  $effect(() => {
    if (src !== undefined && !safeSrc) warnEmptyImageSource("ImageIcon")
  })
</script>

{#if !activeSrc || activeImageFailed}
  <span
    role={alt ? "img" : undefined}
    aria-label={alt || undefined}
    class="inline-block h-{size} w-{size} min-w-{size} min-h-{size} aspect-square {props.class}">
  </span>
{:else if activeSrc.includes("image/svg") || activeSrc.endsWith(".svg")}
  <Icon icon={activeSrc} {size} class={props.class} />
{:else}
  <img
    src={activeSrc}
    {alt}
    onerror={markImageFailed}
    class="h-{size} w-{size} min-w-{size} min-h-{size} aspect-square object-cover {props.class}" />
{/if}
