<script lang="ts">
  import {Copy, ExternalLink} from '@lucide/svelte'
  import type {NostrEvent} from '../types'
  import {externalUrlForEvent} from '../workflows'

  const {event, label, copyText, openEvent}: {
    event: NostrEvent
    label: string
    copyText: (value: string, label: string) => void | Promise<void>
    openEvent: (id: string) => void
  } = $props()
</script>

<div class="flex flex-wrap items-center gap-x-3 gap-y-2">
  <button class="inline-flex items-center gap-1 text-xs text-primary hover:underline" onclick={() => void copyText(event.id, `${label} ID`)}>
    <Copy class="h-3 w-3" /> Copy ID
  </button>
  <button class="inline-flex items-center gap-1 text-xs text-primary hover:underline" onclick={() => void copyText(JSON.stringify(event, null, 2), `${label} JSON`)}>
    <Copy class="h-3 w-3" /> Copy JSON
  </button>
  <button class="inline-flex items-center gap-1 text-xs text-primary hover:underline" onclick={() => openEvent(event.id)}>
    Open <ExternalLink class="h-3 w-3" />
  </button>
  {#if externalUrlForEvent(event)}
    <a class="inline-flex items-center gap-1 text-xs text-primary hover:underline" href={externalUrlForEvent(event)} target="_blank" rel="noreferrer">
      Output <ExternalLink class="h-3 w-3" />
    </a>
  {/if}
</div>
