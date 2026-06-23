<script lang="ts">
  import type {SmartWidgetEvent} from "@app/extensions/types"
  import WidgetFrame from "@app/components/WidgetFrame.svelte"
  import {clearModals} from "@app/util/modal"
  import Icon from "@lib/components/Icon.svelte"
  import CloseCircle from "@assets/icons/close-circle.svg?dataurl"

  type Props = {
    widget: SmartWidgetEvent
    context?: Record<string, unknown>
  }

  const {widget, context = {}}: Props = $props()
</script>

<div
  class="flex h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-xl bg-base-100 shadow-xl">
  <div class="flex items-center justify-between border-b border-base-300 px-4 py-3">
    <div class="flex items-center gap-3">
      {#if widget.iconUrl || widget.imageUrl}
        <img
          src={widget.iconUrl || widget.imageUrl}
          alt="icon"
          class="h-8 w-8 rounded object-cover" />
      {/if}
      <div>
        <h2 class="font-semibold">{widget.content || widget.identifier}</h2>
        <p class="text-xs opacity-70">Smart Widget • {widget.widgetType}</p>
      </div>
    </div>
    <button class="btn btn-ghost btn-sm" onclick={() => clearModals()}>
      <Icon icon={CloseCircle} size={5} />
    </button>
  </div>

  <div class="relative flex-1 overflow-hidden">
    <WidgetFrame {widget} {context} class="h-full" minHeight={500} />
  </div>
</div>
