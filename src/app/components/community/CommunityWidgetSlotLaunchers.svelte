<script lang="ts">
  import WidgetIcon from "@assets/icons/widget.svg?dataurl"
  import {pubkey} from "@welshman/app"
  import WidgetModal from "@app/components/WidgetModal.svelte"
  import {normalizePubkey} from "@app/core/community"
  import {
    activeCommunityDefinition,
    activeCommunityProfile,
    activeCommunityProfileListEvents,
    activeCommunityRelays,
    activeCommunityReportState,
  } from "@app/core/community-state"
  import {makeCommunityWidgetContext} from "@app/extensions/community-context"
  import {
    getEnabledCommunitySlotWidgets,
    loadCachedCommunityCuratedWidgets,
  } from "@app/extensions/community-widget-slots"
  import {effectiveExtensionSettings} from "@app/extensions/settings"
  import {getWidgetLineId} from "@app/extensions/widget-identity"
  import type {SmartWidgetEvent, WidgetActionSlotType} from "@app/extensions/types"
  import {pushModal} from "@app/util/modal"
  import {makeCommunityInputValue} from "@app/util/community-stars"

  type LauncherVariant = "message-actions" | "top-menu"

  type Props = {
    communityPubkey: string
    relayHints?: string[]
    slotType: WidgetActionSlotType
    variant?: LauncherVariant
    context?: Record<string, unknown>
  }

  const {
    communityPubkey,
    relayHints = [],
    slotType,
    variant = "message-actions",
    context = {},
  }: Props = $props()

  let curatedWidgets = $state<SmartWidgetEvent[]>([])
  let loadKey = ""

  const installedWidgets = $derived($effectiveExtensionSettings.installed?.widget || {})
  const enabledWidgetIds = $derived(new Set($effectiveExtensionSettings.enabled || []))
  const slotWidgets = $derived(
    getEnabledCommunitySlotWidgets({
      curatedWidgets,
      installedWidgets,
      enabledIds: enabledWidgetIds,
      slotType,
    }),
  )
  const containerClass = $derived(
    variant === "top-menu" ? "relative isolate flex items-center gap-1" : "flex items-center gap-1",
  )
  const buttonClass = $derived(
    variant === "top-menu"
      ? "btn btn-outline btn-sm gap-1"
      : "btn btn-circle btn-xs border border-solid border-neutral bg-base-100/90 shadow-sm backdrop-blur",
  )

  const getWidgetTitle = (widget: SmartWidgetEvent) =>
    widget.slot?.label || widget.content || widget.identifier || "Widget"

  const communityContext = $derived.by(() => {
    if (
      !$activeCommunityDefinition ||
      normalizePubkey($activeCommunityDefinition.pubkey) !== normalizePubkey(communityPubkey)
    ) {
      return undefined
    }

    return makeCommunityWidgetContext({
      definition: $activeCommunityDefinition,
      profile: $activeCommunityProfile,
      profileListEvents: $activeCommunityProfileListEvents,
      reportState: $activeCommunityReportState,
      userPubkey: $pubkey || "",
      relays: $activeCommunityRelays.length ? $activeCommunityRelays : relayHints,
      relayHints,
    })
  })

  const openWidget = (widget: SmartWidgetEvent) => {
    if (!widget.appUrl) return

    pushModal(WidgetModal, {
      widget,
      context: {
        ...context,
        slot: {type: slotType, label: widget.slot?.label},
        community: {pubkey: communityPubkey, relays: relayHints},
        ...(communityContext ? {communityContext} : {}),
      },
    })
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
        if (!disposed) console.warn("[community-widget-slots] Failed to load widgets", error)
        if (!disposed && key === loadKey) curatedWidgets = []
      })

    return () => {
      disposed = true
    }
  })
</script>

{#if slotWidgets.length > 0}
  <div class={containerClass} data-widget-slot={slotType}>
    {#each slotWidgets as widget (getWidgetLineId(widget))}
      {@const title = getWidgetTitle(widget)}
      <button class={buttonClass} title={title} aria-label={title} onclick={() => openWidget(widget)}>
        {#if widget.iconUrl || widget.imageUrl}
          <img
            src={widget.iconUrl || widget.imageUrl}
            alt=""
            class="h-4 w-4 shrink-0 rounded object-cover" />
        {:else}
          <img src={WidgetIcon} alt="" class="h-4 w-4 shrink-0" />
        {/if}
        {#if variant === "top-menu"}
          <span class="hidden max-w-[100px] truncate lg:inline">{title}</span>
        {/if}
      </button>
    {/each}
  </div>
{/if}
