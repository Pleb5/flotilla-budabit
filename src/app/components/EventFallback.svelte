<script lang="ts">
  import type {TrustedEvent} from "@welshman/util"
  import EventCard from "@app/components/EventCard.svelte"
  import Button from "@lib/components/Button.svelte"
  import {getEventFallback} from "@app/util/event-fallback"

  const {
    event,
    relays = [],
    compact = false,
  }: {
    event: TrustedEvent
    relays?: string[]
    compact?: boolean
  } = $props()

  const view = $derived(getEventFallback(event))
  let expanded = $state(false)
  const previewLength = $derived(compact ? 300 : 1200)
  const body = $derived(expanded ? view.body : view.body.slice(0, previewLength))
</script>

<EventCard {event} {relays} {compact}>
  <div class="flex min-w-0 flex-wrap items-center gap-2">
    <h2 class="min-w-0 break-words font-semibold [overflow-wrap:anywhere]">{view.title}</h2>
    <span class="badge badge-ghost badge-sm shrink-0">Kind {event.kind}</span>
  </div>
  {#if view.summary && view.summary !== view.body}
    <p class="break-words text-sm opacity-70 [overflow-wrap:anywhere]">
      {view.summary.slice(0, compact ? 300 : 1200)}
    </p>
  {/if}
  {#if body}
    {#if view.format === "json"}
      <pre class="max-h-96 overflow-auto rounded-lg bg-base-200 p-3 text-xs"><code
          >{body}{expanded || view.body.length <= previewLength ? "" : "…"}</code></pre>
    {:else}
      <p class="whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">
        {body}{expanded || view.body.length <= previewLength ? "" : "…"}
      </p>
    {/if}
  {:else if view.metadata.length === 0}
    <p class="text-sm opacity-70">This event has no text content or metadata.</p>
  {/if}
  {#if (!view.body || event.kind === 10002) && view.metadata.length > 0}
    <dl class="space-y-1 rounded-lg bg-base-200 p-3 text-xs">
      {#each view.metadata as item}
        <div class="flex min-w-0 gap-2">
          <dt class="shrink-0 font-medium">{item.name}</dt>
          <dd class="min-w-0 break-words opacity-70 [overflow-wrap:anywhere]">{item.value}</dd>
        </div>
      {/each}
    </dl>
  {/if}
  {#if !compact && view.body.length > previewLength}
    <Button class="link self-start text-sm" onclick={() => (expanded = !expanded)}>
      {expanded ? "Show less" : "Show more"}
    </Button>
  {/if}
  <p class="text-xs opacity-60">Budabit is showing a basic view of this event.</p>
  {#snippet actions()}
    {#if !compact}
      {#each view.related as related}
        <a href={related.href} class="link">{related.label}</a>
      {/each}
    {/if}
  {/snippet}
</EventCard>
