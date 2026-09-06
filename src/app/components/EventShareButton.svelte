<script lang="ts">
  import type {TrustedEvent} from "@welshman/util"
  import {Share2} from "@lucide/svelte"
  import {stopPropagation} from "@lib/html"
  import {makeEventShareEntityForEvent} from "@app/util/event-share"
  import {clip} from "@app/util/toast"

  const {event, noun, relays}: {event: TrustedEvent; noun: string; relays: string[]} = $props()

  const share = stopPropagation(() => clip(makeEventShareEntityForEvent(event, {relays})))
</script>

<button
  type="button"
  class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
  aria-label={`Share ${noun}`}
  title={`Share ${noun}`}
  data-stop-link
  data-stop-tap
  onclick={share}>
  <Share2 class="h-4 w-4" aria-hidden="true" />
</button>
