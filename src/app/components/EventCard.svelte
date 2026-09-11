<script lang="ts">
  import type {Snippet} from "svelte"
  import type {TrustedEvent} from "@welshman/util"
  import NoteCard from "@app/components/NoteCard.svelte"
  import Button from "@lib/components/Button.svelte"
  import {userSettingsValues} from "@app/core/state"
  import {makeEventShareEntityForEvent} from "@app/util/event-share"
  import {entityLink} from "@app/util/nostr-links"
  import {clip} from "@app/util/toast"

  const {
    event,
    relays = [],
    compact = false,
    variant = "generic",
    children,
    actions,
  }: {
    event: TrustedEvent
    relays?: string[]
    compact?: boolean
    variant?: "generic" | "article"
    children: Snippet
    actions?: Snippet
  } = $props()

  const entity = $derived(makeEventShareEntityForEvent(event, {relays}))
  const warning = $derived(event.tags.find(tag => tag[0] === "content-warning"))
  let revealedEvent = $state("")
  let detailsOpen = $state(false)
  const hidden = $derived(
    $userSettingsValues.hide_sensitive && !!warning && revealedEvent !== event.id,
  )
</script>

<article
  data-generic-event={variant === "generic" ? "" : undefined}
  data-longform-article={variant === "article" ? "" : undefined}
  data-event={event.id}
  id={compact ? undefined : `event-${event.id}`}
  class="min-w-0 max-w-full rounded-xl border border-base-content/15 bg-base-100 p-4 text-left">
  <NoteCard
    {event}
    {relays}
    dateInteractive={false}
    minimal={compact}
    hideDate={variant === "article"}>
    {#if hidden}
      <p class="text-sm opacity-70">Content warning{warning?.[1] ? `: ${warning[1]}` : ""}</p>
      <Button class="btn btn-ghost btn-sm self-start" onclick={() => (revealedEvent = event.id)}>
        Show anyway
      </Button>
    {:else}
      {@render children()}
      <div class="flex flex-wrap items-center gap-3 text-sm">
        {@render actions?.()}
        {#if compact}
          <a href={entityLink(entity)} class="link"
            >{variant === "article" ? "Read article" : "Open event"}</a>
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
