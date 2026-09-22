<script lang="ts">
  import {getTagValue} from "@welshman/util"
  import {pubkey} from "@welshman/app"
  import {untrack} from "svelte"
  import WidgetFrame from "@app/components/WidgetFrame.svelte"
  import {normalizePubkey, type CommunityPointer} from "@app/core/community"
  import {measurePerformanceDiagnosticsWork} from "@app/core/performance-diagnostics"
  import {
    activeCommunityDescriptor,
    activeCommunityProfileListEvents,
    activeCommunityReportState,
  } from "@app/core/community-state"
  import {makeCommunityWidgetContext} from "@app/extensions/community-context"
  import {
    getEnabledCommunitySlotWidgetsWithSharedConfig,
    getEnabledCommunitySlotWidgets,
    mergeCommunitySlotWidgets,
  } from "@app/extensions/community-widget-slots"
  import {effectiveExtensionSettings} from "@app/extensions/settings"
  import {getWidgetLineId} from "@app/extensions/widget-identity"
  import {hasWidgetControlledVisibility} from "@app/extensions/widget-visibility"
  import type {
    CommunityHomeWidgetRecoveryState,
    CommunityHomeWidgetSlotInitialState,
  } from "@app/extensions/community-home-widget-recovery"
  import type {SmartWidgetEvent, WidgetHomeSlotType, WidgetFrameState} from "@app/extensions/types"

  type Props = {
    community: CommunityPointer
    recovery: CommunityHomeWidgetRecoveryState
    slotType: WidgetHomeSlotType
    onInitialState?: (state: CommunityHomeWidgetSlotInitialState) => void
  }

  const {community, recovery, slotType, onInitialState}: Props = $props()
  const descriptor = $derived(
    $activeCommunityDescriptor?.community.address === community.address
      ? $activeCommunityDescriptor
      : undefined,
  )
  const exactCommunity = $derived(descriptor?.community)
  const exactDefinition = $derived(descriptor?.definition)
  const communityAddress = $derived(community.address)
  const relayHints = $derived(community.relayHints)
  const communityRelays = $derived(descriptor?.relays.length ? descriptor.relays : relayHints)
  const contextDefinition = $derived(
    exactDefinition ? {...exactDefinition, pubkey: exactDefinition.ownerPubkey} : undefined,
  )
  const recoveryMatchesCommunity = $derived(recovery.communityAddress === communityAddress)
  const installedWidgets = $derived($effectiveExtensionSettings.installed?.widget || {})
  const enabledWidgetIds = $derived(new Set($effectiveExtensionSettings.enabled || []))
  const slotWidgets = $derived.by(() => {
    const curatedWidgets = recoveryMatchesCommunity ? recovery.curatedWidgets : []
    return measurePerformanceDiagnosticsWork(
      {
        owner: "widget-slot",
        phase: "curated-selection",
        detail: {slotType, candidates: curatedWidgets.length},
      },
      () =>
        getEnabledCommunitySlotWidgets({
          curatedWidgets,
          installedWidgets,
          enabledIds: enabledWidgetIds,
          slotType,
        }),
    )
  })
  const sharedConfigSlotWidgets = $derived.by(() => {
    const sharedConfigEvents = recoveryMatchesCommunity ? recovery.sharedConfigEvents : []
    return measurePerformanceDiagnosticsWork(
      {
        owner: "widget-slot",
        phase: "shared-config-selection",
        detail: {slotType, events: sharedConfigEvents.length},
      },
      () =>
        getEnabledCommunitySlotWidgetsWithSharedConfig({
          communityAddress,
          sharedConfigEvents,
          authorizedPubkeys: recoveryMatchesCommunity ? recovery.authorizedPubkeys : new Set(),
          descriptorAuthorities: recoveryMatchesCommunity ? recovery.descriptorAuthorities : [],
          installedWidgets,
          enabledIds: enabledWidgetIds,
          slotType,
        }),
    )
  })
  const frameWidgets = $derived.by(() =>
    exactCommunity ? mergeCommunitySlotWidgets(slotWidgets, sharedConfigSlotWidgets) : [],
  )
  const communityReadinessKey = $derived.by(() => {
    const readiness = descriptor?.authorityReadiness
    return readiness?.communityAddress === community.address && readiness.state === "ready"
      ? JSON.stringify({authorityKey: readiness.key, authorityState: readiness.state})
      : ""
  })
  const communityContext = $derived.by(() => {
    if (!exactDefinition || !exactCommunity || !communityReadinessKey) return undefined
    return makeCommunityWidgetContext({
      definition: contextDefinition as any,
      profileListEvents: $activeCommunityProfileListEvents,
      reportState: $activeCommunityReportState,
      userPubkey: $pubkey || "",
      relays: communityRelays,
      relayHints,
      readinessKey: communityReadinessKey,
    })
  })
  const communityRuntimeContext = $derived.by(() => {
    if (!communityContext || !exactDefinition || !exactCommunity) return undefined
    return {
      community: exactCommunity,
      definition: exactDefinition,
      profileListEvents: $activeCommunityProfileListEvents,
      authorityEvidenceSettled: true,
      reportState: $activeCommunityReportState,
      relays: communityRelays,
      relayHints,
      communityContext,
    }
  })

  const frameStates = $state<Record<string, WidgetFrameState>>({})

  const getWidgetTitle = (widget: SmartWidgetEvent) =>
    getTagValue("title", widget.tags) || widget.content || widget.identifier || "Widget"
  const getWidgetDescription = (widget: SmartWidgetEvent) =>
    getTagValue("description", widget.tags) ||
    (getTagValue("title", widget.tags) ? widget.content : "")
  const getWidgetLoadKey = (widget: SmartWidgetEvent) =>
    [
      communityAddress,
      normalizePubkey($pubkey || ""),
      slotType,
      getWidgetLineId(widget),
      widget.appUrls?.join("|") || widget.appUrl || "",
    ].join(":")
  const isWidgetVisible = (widget: SmartWidgetEvent) =>
    (frameStates[getWidgetLoadKey(widget)]?.visibility ||
      (hasWidgetControlledVisibility(widget) ? "pending" : "visible")) === "visible"
  const hasVisibleWidgets = $derived(frameWidgets.some(isWidgetVisible))
  const makeWidgetContext = (widget: SmartWidgetEvent) => {
    if (!exactCommunity) return {}
    return {
      slot: {type: slotType, label: widget.slot?.label},
      community: {
        address: exactCommunity.address,
        ownerPubkey: exactCommunity.ownerPubkey,
        communityId: exactCommunity.communityId,
        naddr: exactCommunity.naddr,
        relays: relayHints,
      },
      ...(communityContext ? {communityContext} : {}),
      ...(communityRuntimeContext ? {communityRuntimeContext} : {}),
    }
  }
  const setFrameState = (key: string, state: WidgetFrameState) => {
    if (JSON.stringify(untrack(() => frameStates[key])) !== JSON.stringify(state)) {
      frameStates[key] = state
    }
  }

  $effect(() => {
    const activeLoadKeys = new Set(frameWidgets.map(getWidgetLoadKey))
    for (const key of Object.keys(frameStates)) {
      if (!activeLoadKeys.has(key)) delete frameStates[key]
    }
  })

  $effect(() => {
    if (!onInitialState) return
    const loadKeys = frameWidgets.map(getWidgetLoadKey)
    const catalogTerminal =
      recovery.curatedFirstAttemptTerminal && recovery.sharedConfigFirstAttemptTerminal
    const resolvedCount = loadKeys.filter(key => frameStates[key]?.terminal).length
    onInitialState({
      slotType,
      frameCount: loadKeys.length,
      loadedCount: loadKeys.filter(key => frameStates[key]?.loaded).length,
      resolvedCount,
      terminal: catalogTerminal && resolvedCount === loadKeys.length,
    })
  })
</script>

{#if frameWidgets.length > 0 && communityRuntimeContext}
  <div
    class={hasVisibleWidgets ? "relative flex flex-col" : "absolute inset-x-0"}
    data-widget-slot={slotType}>
    {#each frameWidgets as widget (getWidgetLineId(widget))}
      {@const title = getWidgetTitle(widget)}
      {@const description = getWidgetDescription(widget)}
      {@const widgetLoadKey = getWidgetLoadKey(widget)}
      {@const visible = isWidgetVisible(widget)}
      <section
        class={visible ? "relative overflow-visible px-2 py-3 sm:px-4 sm:py-4" : "relative"}
        aria-label={widget.slot?.label || title}
        aria-hidden={!visible}
        title={description || undefined}>
        {#key widgetLoadKey}
          <WidgetFrame
            {widget}
            context={makeWidgetContext(widget)}
            class="w-full"
            minHeight={1}
            resizeMinHeight={1}
            autoHeight
            onState={state => setFrameState(widgetLoadKey, state)} />
        {/key}
      </section>
    {/each}
  </div>
{/if}
