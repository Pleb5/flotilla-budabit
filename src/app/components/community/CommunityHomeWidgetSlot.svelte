<script lang="ts">
  import {getTagValue} from "@welshman/util"
  import WidgetIcon from "@assets/icons/widget.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import WidgetModal from "@app/components/WidgetModal.svelte"
  import {
    getEnabledCommunitySlotWidgets,
    loadCachedCommunityCuratedWidgets,
  } from "@app/extensions/community-widget-slots"
  import {effectiveExtensionSettings} from "@app/extensions/settings"
  import {getWidgetLineId} from "@app/extensions/widget-identity"
  import type {SmartWidgetEvent, WidgetHomeSlotType} from "@app/extensions/types"
  import {pushModal} from "@app/util/modal"
  import {makeCommunityInputValue} from "@app/util/community-stars"

  type Props = {
    communityPubkey: string
    relayHints?: string[]
    slotType: WidgetHomeSlotType
  }

  const {communityPubkey, relayHints = [], slotType}: Props = $props()

  let curatedWidgets = $state<SmartWidgetEvent[]>([])
  let loadKey = ""

  const installedWidgets = $derived($effectiveExtensionSettings.installed?.widget || {})
  const enabledWidgetIds = $derived(new Set($effectiveExtensionSettings.enabled || []))
  const slotWidgets = $derived.by(() => {
    return getEnabledCommunitySlotWidgets({
      curatedWidgets,
      installedWidgets,
      enabledIds: enabledWidgetIds,
      slotType,
    })
  })

  const getWidgetTitle = (widget: SmartWidgetEvent) =>
    getTagValue("title", widget.tags) || widget.content || widget.identifier || "Widget"

  const getWidgetDescription = (widget: SmartWidgetEvent) =>
    getTagValue("description", widget.tags) ||
    (getTagValue("title", widget.tags) ? widget.content : "")

  const openWidget = (widget: SmartWidgetEvent) => {
    if (widget.appUrl) pushModal(WidgetModal, {widget})
  }

  $effect(() => {
    const input = makeCommunityInputValue({pubkey: communityPubkey, relayHints})
    const key = input ? `${slotType}:${input}` : ""

    if (!key || !input) {
      curatedWidgets = []
      loadKey = ""
      return
    }

    if (key === loadKey) return
    loadKey = key

    let disposed = false

    loadCachedCommunityCuratedWidgets(input)
      .then(result => {
        if (disposed || key !== loadKey) return
        curatedWidgets = result?.status === "community" ? result.widgets : []
      })
      .catch(error => {
        if (!disposed) console.warn("[community-home-widgets] Failed to load widgets", error)
        if (!disposed && key === loadKey) curatedWidgets = []
      })

    return () => {
      disposed = true
    }
  })
</script>

{#if slotWidgets.length > 0}
  <div class="flex flex-col gap-2">
    {#each slotWidgets as widget (getWidgetLineId(widget))}
      {@const title = getWidgetTitle(widget)}
      {@const description = getWidgetDescription(widget)}
      <section class="card2 bg-alt flex flex-col gap-3 p-4 shadow-md">
        <div class="flex min-w-0 items-start gap-3">
          {#if widget.iconUrl || widget.imageUrl}
            <img
              src={widget.iconUrl || widget.imageUrl}
              alt=""
              class="h-10 w-10 shrink-0 rounded object-cover" />
          {:else}
            <div class="center h-10 w-10 shrink-0 rounded bg-base-300">
              <Icon icon={WidgetIcon} size={5} />
            </div>
          {/if}
          <div class="min-w-0 flex-1">
            <h2 class="break-words text-lg font-semibold">{widget.slot?.label || title}</h2>
            {#if widget.slot?.label && widget.slot.label !== title}
              <p class="break-words text-sm font-medium opacity-80">{title}</p>
            {/if}
            {#if description}
              <p class="mt-1 whitespace-pre-wrap text-sm opacity-70">{description}</p>
            {/if}
          </div>
        </div>

        {#if widget.buttons.length > 0}
          <div class="flex flex-wrap gap-2">
            {#each widget.buttons as button (`${getWidgetLineId(widget)}:${button.index}`)}
              {#if button.type === "app"}
                <Button class="btn btn-primary btn-sm" onclick={() => openWidget(widget)}>
                  {button.label}
                </Button>
              {:else}
                <a
                  href={button.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="btn btn-outline btn-sm">
                  {button.label}
                </a>
              {/if}
            {/each}
          </div>
        {/if}
      </section>
    {/each}
  </div>
{/if}
