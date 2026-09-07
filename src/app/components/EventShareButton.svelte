<script lang="ts">
  import type {TrustedEvent} from "@welshman/util"
  import ShareCircle from "@assets/icons/share-circle.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import {stopPropagation} from "@lib/html"
  import {makeEventShareEntityForEvent} from "@app/util/event-share"
  import {clip} from "@app/util/toast"

  type Props = {
    event: TrustedEvent
    noun: string
    relays: string[]
    url?: string
    label?: string
    // Custom link/copy behavior must not replace the shared button or its interaction guards.
    onShare?: () => void | Promise<void>
    onComplete?: () => void
    class?: string
  }

  const {
    event,
    noun,
    relays,
    url = "",
    label = "",
    onShare,
    onComplete,
    class:
      className = "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
  }: Props = $props()

  const share = stopPropagation(async () => {
    await (onShare ? onShare() : clip(makeEventShareEntityForEvent(event, {url, relays})))
    onComplete?.()
  })
</script>

<button
  type="button"
  class={className}
  aria-label={label || `Share ${noun}`}
  title={label || `Share ${noun}`}
  data-stop-link
  data-stop-tap
  onclick={share}>
  <Icon icon={ShareCircle} size={4} />
  {#if label}{label}{/if}
</button>
