<script lang="ts">
  import {getTagValue} from "@welshman/util"
  import {pubkey} from "@welshman/app"
  import WidgetFrame from "@app/components/WidgetFrame.svelte"
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
  import type {SmartWidgetEvent, WidgetHomeSlotType} from "@app/extensions/types"
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

  const makeWidgetContext = (widget: SmartWidgetEvent) => ({
    slot: {type: slotType, label: widget.slot?.label},
    community: {pubkey: communityPubkey, relays: relayHints},
    ...(communityContext ? {communityContext} : {}),
  })

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
      <section
        class="card2 bg-alt overflow-hidden shadow-md"
        aria-label={widget.slot?.label || title}
        title={description || undefined}>
        <WidgetFrame
          {widget}
          context={makeWidgetContext(widget)}
          class="w-full bg-base-100/30"
          minHeight={220} />
      </section>
    {/each}
  </div>
{/if}
