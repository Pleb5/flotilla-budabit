<script lang="ts">
  import type {TrustedEvent} from "@welshman/util"
  import Button from "@lib/components/Button.svelte"
  import EventShareButton from "@app/components/EventShareButton.svelte"
  import {userSettingsValues} from "@app/core/state"
  import {getTradeEventDetails} from "@app/util/trade-events"

  const {
    event,
    relays = [],
    compact = false,
    depth = 0,
    hideMediaAtDepth = 1,
  }: {
    event: TrustedEvent
    relays?: string[]
    compact?: boolean
    depth?: number
    hideMediaAtDepth?: number
  } = $props()

  const view = $derived(getTradeEventDetails(event, relays))
  const showMedia = $derived($userSettingsValues.show_media && depth < hideMediaAtDepth)
  let failedImages = $state<string[]>([])
  let expanded = $state(false)
  const limit = $derived(compact ? 300 : 1200)
  const body = $derived(expanded ? view.description : view.description.slice(0, limit))
</script>

<div
  data-trade-content
  data-kind={event.kind}
  class="min-w-0 max-w-full space-y-3 [overflow-wrap:anywhere]">
  <header class="flex items-start justify-between gap-3">
    <div class="min-w-0 space-y-2">
      <div class="flex flex-wrap items-center gap-2 text-xs">
        <span class="badge badge-outline badge-sm">{view.label}</span>
        {#if view.status}<span class="badge badge-ghost badge-sm">{view.status}</span>{/if}
      </div>
      <h2
        class={compact
          ? "line-clamp-2 text-base font-semibold"
          : "text-2xl font-bold leading-tight"}>
        {view.title}
      </h2>
      <p class="text-sm font-semibold text-primary">{view.price}</p>
    </div>
    <EventShareButton {event} {relays} noun={view.label.toLowerCase()} />
  </header>
  {#if showMedia && view.images.length}
    <div class={compact ? "min-w-0" : "flex gap-3 overflow-x-auto"}>
      {#each compact ? view.images.slice(0, 1) : view.images as image}
        {#if !failedImages.includes(image)}
          <img
            src={image}
            alt={view.title}
            loading="lazy"
            decoding="async"
            referrerpolicy="no-referrer"
            class={compact
              ? "max-h-40 w-full rounded-lg object-cover"
              : "max-h-80 max-w-full shrink-0 rounded-lg object-contain"}
            onerror={() => (failedImages = [...failedImages, image])} />
        {/if}
      {/each}
    </div>
  {/if}
  {#if body}<p class="whitespace-pre-wrap text-sm" class:line-clamp-3={compact}>
      {body}{body.length < view.description.length ? "…" : ""}
    </p>{/if}
  {#if !compact && view.description.length > limit}
    <Button class="link text-sm" onclick={() => (expanded = !expanded)}
      >{expanded ? "Show less" : "Show more"}</Button>
  {/if}
  {#if view.location}<p class="text-xs opacity-70">Location · {view.location}</p>{/if}
  {#if view.categories.length}
    <div class="flex flex-wrap gap-2">
      {#each view.categories as category}<span class="rounded-full bg-base-200 px-2 py-1 text-xs"
          >{category}</span
        >{/each}
    </div>
  {/if}
  {#if view.parent}<a class="link inline-block text-sm" href={view.parent.href}
      >{view.parent.label}</a
    >{/if}
</div>
