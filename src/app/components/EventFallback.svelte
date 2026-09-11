<script lang="ts">
  import type {TrustedEvent} from "@welshman/util"
  import NoteCard from "@app/components/NoteCard.svelte"
  import Button from "@lib/components/Button.svelte"
  import {userSettingsValues} from "@app/core/state"
  import {getEventFallback} from "@app/util/event-fallback"
  import {makeEventShareEntityForEvent} from "@app/util/event-share"
  import {entityLink} from "@app/util/nostr-links"
  import {clip} from "@app/util/toast"

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
  const entity = $derived(makeEventShareEntityForEvent(event, {relays}))
  const warning = $derived(event.tags.find(tag => tag[0] === "content-warning"))
  let revealed = $state(false)
  let expanded = $state(false)
  let detailsOpen = $state(false)
  const hidden = $derived($userSettingsValues.hide_sensitive && !!warning && !revealed)
  const previewLength = $derived(compact ? 300 : 1200)
  const body = $derived(expanded ? view.body : view.body.slice(0, previewLength))
</script>

<article
  data-generic-event
  data-event={event.id}
  id={compact ? undefined : `event-${event.id}`}
  class="min-w-0 max-w-full rounded-xl border border-base-content/15 bg-base-100 p-4 text-left">
  <NoteCard {event} {relays} dateInteractive={false} minimal={compact}>
    {#if hidden}
      <p class="text-sm opacity-70">Content warning{warning?.[1] ? `: ${warning[1]}` : ""}</p>
      <Button class="btn btn-ghost btn-sm self-start" onclick={() => (revealed = true)}>
        Show anyway
      </Button>
    {:else}
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
      <div class="flex flex-wrap items-center gap-3 text-sm">
        {#if compact}
          <a href={entityLink(entity)} class="link">Open event</a>
        {:else}
          {#each view.related as related}
            <a href={related.href} class="link">{related.label}</a>
          {/each}
        {/if}
        <Button
          class="link"
          onclick={() => clip(new URL(entityLink(entity), window.location.origin).href)}
          >Copy link</Button>
      </div>
      {#if !compact}
        <details bind:open={detailsOpen} class="mt-2 min-w-0 border-t border-base-content/10 pt-3">
          <summary class="cursor-pointer text-sm">Event details</summary>
          {#if detailsOpen}
            <dl class="my-3 space-y-2 break-words text-xs [overflow-wrap:anywhere]">
              <div>
                <dt class="font-medium">Event ID</dt>
                <dd class="font-mono opacity-70">{event.id}</dd>
              </div>
              <div>
                <dt class="font-medium">Author</dt>
                <dd class="font-mono opacity-70">{event.pubkey}</dd>
              </div>
              <div>
                <dt class="font-medium">Created</dt>
                <dd>{new Date(event.created_at * 1000).toLocaleString()}</dd>
              </div>
              <div>
                <dt class="font-medium">Relay hints</dt>
                <dd>{relays.join(", ") || "No relay hints available"}</dd>
              </div>
            </dl>
            <div class="mb-2 flex flex-wrap gap-3 text-sm">
              <Button class="link" onclick={() => clip(`nostr:${entity}`)}
                >Copy Nostr reference</Button>
              <Button class="link" onclick={() => clip(JSON.stringify(event, null, 2))}
                >Copy JSON</Button>
            </div>
            <pre class="max-h-96 overflow-auto rounded-lg bg-base-200 p-3 text-xs"><code
                >{JSON.stringify(event, null, 2)}</code></pre>
          {/if}
        </details>
      {/if}
    {/if}
  </NoteCard>
</article>
