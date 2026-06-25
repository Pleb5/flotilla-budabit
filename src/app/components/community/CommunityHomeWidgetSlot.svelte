<script lang="ts">
  import {getTagValue} from "@welshman/util"
  import {pubkey} from "@welshman/app"
  import {onDestroy} from "svelte"
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
  import {logCommunityWidgetDebug} from "@app/extensions/community-widget-debug"
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
  let loadRequestId = 0

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
      loadRequestId += 1
      return
    }

    if (key === loadKey) return
    loadKey = key
    const requestId = ++loadRequestId

    logCommunityWidgetDebug("home slot loading curated widgets", {
      slotType,
      communityPubkey,
      relayHints,
      input,
      key,
    })

    loadCachedCommunityCuratedWidgets(input)
      .then(result => {
        if (requestId !== loadRequestId || key !== loadKey) {
          logCommunityWidgetDebug("home slot discarded stale curated widgets result", {
            slotType,
            communityPubkey,
            key,
            currentKey: loadKey,
            requestId,
            currentRequestId: loadRequestId,
            status: result?.status,
            widgetCount: result?.status === "community" ? result.widgets.length : 0,
          })
          return
        }

        curatedWidgets = result?.status === "community" ? result.widgets : []
        logCommunityWidgetDebug("home slot loaded curated widgets", {
          slotType,
          communityPubkey,
          key,
          status: result?.status,
          widgets: curatedWidgets.map(widget => ({
            id: getWidgetLineId(widget),
            identifier: widget.identifier,
            pubkey: widget.pubkey,
            slot: widget.slot,
            appUrl: widget.appUrl,
          })),
        })
      })
      .catch(error => {
        if (requestId !== loadRequestId || key !== loadKey) return

        console.warn("[community-home-widgets] Failed to load widgets", error)
        logCommunityWidgetDebug("home slot failed to load curated widgets", {
          slotType,
          communityPubkey,
          key,
          error: error instanceof Error ? error.message : String(error),
        })
        curatedWidgets = []
        loadKey = ""
      })
  })

  onDestroy(() => {
    loadRequestId += 1
  })
</script>

{#if slotWidgets.length > 0}
  <div class="flex flex-col gap-2">
    {#each slotWidgets as widget (getWidgetLineId(widget))}
      {@const title = getWidgetTitle(widget)}
      {@const description = getWidgetDescription(widget)}
      <section
        class="overflow-visible"
        aria-label={widget.slot?.label || title}
        title={description || undefined}>
        <WidgetFrame
          {widget}
          context={makeWidgetContext(widget)}
          class="w-full"
          minHeight={220} />
      </section>
    {/each}
  </div>
{/if}
