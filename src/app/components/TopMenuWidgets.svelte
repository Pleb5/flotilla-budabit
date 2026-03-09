<script lang="ts">
  import {extensionSettings, getWidgetsForLocation} from "@app/extensions/settings"
  import type {SmartWidgetEvent} from "@app/extensions/types"

  let showWidgetModal = $state<SmartWidgetEvent | null>(null)
  let currentIndex = $state(0)
  const maxVisible = 3

  const topMenuWidgets = $derived.by(() => {
    const _ = $extensionSettings
    return getWidgetsForLocation("top-menu")
  })

  const visibleWidgets = $derived(
    topMenuWidgets.slice(currentIndex, currentIndex + maxVisible)
  )

  const canGoBack = $derived(currentIndex > 0)
  const canGoForward = $derived(currentIndex + maxVisible < topMenuWidgets.length)
  const needsPagination = $derived(topMenuWidgets.length > maxVisible)

  const goBack = () => {
    if (canGoBack) currentIndex--
  }

  const goForward = () => {
    if (canGoForward) currentIndex++
  }

  const openWidget = (widget: SmartWidgetEvent) => {
    showWidgetModal = widget
  }

  const closeWidget = () => {
    showWidgetModal = null
  }

  $effect(() => {
    if (currentIndex >= topMenuWidgets.length && topMenuWidgets.length > 0) {
      currentIndex = Math.max(0, topMenuWidgets.length - maxVisible)
    }
  })
</script>

{#if topMenuWidgets.length > 0}
  <div class="relative isolate flex items-center gap-1">
    {#if needsPagination}
      <button
        class="btn btn-ghost btn-xs px-1"
        disabled={!canGoBack}
        onclick={goBack}
        aria-label="Previous widgets">
        ‹
      </button>
    {/if}
    {#each visibleWidgets as widget (widget.identifier)}
      <button
        class="btn btn-sm btn-outline gap-1"
        title={widget.content || widget.identifier}
        onclick={() => openWidget(widget)}>
        {#if widget.iconUrl || widget.imageUrl}
          <img
            src={widget.iconUrl || widget.imageUrl}
            alt={widget.content || widget.identifier}
            class="h-4 w-4 shrink-0 rounded object-cover" />
        {/if}
        <span class="hidden max-w-[100px] truncate lg:inline">{widget.content || widget.identifier}</span>
      </button>
    {/each}
    {#if needsPagination}
      <button
        class="btn btn-ghost btn-xs px-1"
        disabled={!canGoForward}
        onclick={goForward}
        aria-label="Next widgets">
        ›
      </button>
    {/if}
  </div>
{/if}

{#if showWidgetModal?.appUrl}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="fixed inset-0 z-modal flex items-center justify-center bg-black/50"
    role="dialog"
    aria-modal="true"
    aria-label="Widget modal"
    tabindex="-1"
    onclick={closeWidget}
    onkeydown={(e) => e.key === "Escape" && closeWidget()}>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="flex h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-xl bg-base-100 shadow-2xl"
      onclick={e => e.stopPropagation()}
      onkeydown={e => e.stopPropagation()}>
      <div class="flex items-center justify-between border-b border-base-300 px-4 py-3">
        <div class="flex items-center gap-3">
          {#if showWidgetModal.iconUrl || showWidgetModal.imageUrl}
            <img
              src={showWidgetModal.iconUrl || showWidgetModal.imageUrl}
              alt="icon"
              class="h-8 w-8 rounded object-cover" />
          {/if}
          <div>
            <h2 class="font-semibold">{showWidgetModal.content || showWidgetModal.identifier}</h2>
            <p class="text-xs opacity-70">Smart Widget • {showWidgetModal.widgetType}</p>
          </div>
        </div>
        <button class="btn btn-ghost btn-sm" onclick={closeWidget}>✕</button>
      </div>
      <div class="relative flex-1">
        <iframe
          src={showWidgetModal.appUrl}
          title={showWidgetModal.content || showWidgetModal.identifier}
          class="absolute inset-0 h-full w-full border-0"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        ></iframe>
      </div>
    </div>
  </div>
{/if}
