<script lang="ts">
  import type {Readable} from "svelte/store"
  import type {CommunityWidgetRuntimeContext, SmartWidgetEvent} from "@app/extensions/types"
  import WidgetFrame from "@app/components/WidgetFrame.svelte"
  import {clearModals} from "@app/util/modal"
  import Icon from "@lib/components/Icon.svelte"
  import CloseCircle from "@assets/icons/close-circle.svg?dataurl"

  type Props = {
    widget: SmartWidgetEvent
    context?: Record<string, unknown>
    communityRuntimeContextProvider?: () => CommunityWidgetRuntimeContext | undefined
    communityRuntimeContextStore?: Readable<CommunityWidgetRuntimeContext | undefined>
    wide?: boolean
  }

  const {
    widget,
    context = {},
    communityRuntimeContextProvider,
    communityRuntimeContextStore,
    wide = false,
  }: Props = $props()
</script>

<div
  class={`flex h-[85vh] flex-col overflow-hidden rounded-xl bg-base-100 shadow-xl ${wide ? "w-[calc(100vw-3rem)] max-w-5xl" : "w-full max-w-md"}`}>
  <div class="flex shrink-0 items-center justify-between border-b border-base-300 px-4 py-3">
    <div class="flex items-center gap-3">
      {#if widget.iconUrl || widget.imageUrl}
        <img
          src={widget.iconUrl || widget.imageUrl}
          alt="icon"
          class="h-8 w-8 rounded object-cover" />
      {/if}
      <div>
        <h2 class="font-semibold">
          {(wide && widget.slot?.label) || widget.content || widget.identifier}
        </h2>
        <p class="text-xs opacity-70">Smart Widget • {widget.widgetType}</p>
      </div>
    </div>
    <button class="btn btn-ghost btn-sm" aria-label="Close widget" onclick={() => clearModals()}>
      <Icon icon={CloseCircle} size={5} />
    </button>
  </div>

  <div class="relative min-h-0 flex-1 overflow-hidden">
    <WidgetFrame
      {widget}
      {context}
      {communityRuntimeContextProvider}
      {communityRuntimeContextStore}
      class="h-full"
      minHeight={0}
      resizable={false} />
  </div>
</div>
