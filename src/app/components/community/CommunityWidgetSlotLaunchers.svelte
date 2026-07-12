<script lang="ts">
  import WidgetIcon from "@assets/icons/widget.svg?dataurl"
  import {pubkey} from "@welshman/app"
  import {onDestroy, onMount} from "svelte"
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
  import {logCommunityWidgetDebug} from "@app/extensions/community-widget-debug"
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
  let loadRequestId = 0
  let loadRefreshNonce = $state(0)
  let forceNextLoad = false
  let lastForcedRefreshAt = 0
  const FORCED_REFRESH_DEBOUNCE_MS = 1_000

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
  const communityRuntimeContext = $derived.by(() => {
    const definition = $activeCommunityDefinition
    if (
      !communityContext ||
      !definition ||
      normalizePubkey(definition.pubkey) !== normalizePubkey(communityPubkey)
    ) {
      return undefined
    }

    return {
      definition,
      profileListEvents: $activeCommunityProfileListEvents,
      reportState: $activeCommunityReportState,
      relays: $activeCommunityRelays.length ? $activeCommunityRelays : relayHints,
      relayHints,
      communityContext,
    }
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
        ...(communityRuntimeContext ? {communityRuntimeContext} : {}),
      },
    })
  }

  const refreshWidgets = (force = false) => {
    if (force) {
      const now = Date.now()
      if (now - lastForcedRefreshAt < FORCED_REFRESH_DEBOUNCE_MS) return
      lastForcedRefreshAt = now
      forceNextLoad = true
    }

    loadKey = ""
    loadRefreshNonce += 1
  }

  const refreshVisibleWidgets = () => {
    if (document.visibilityState === "visible") refreshWidgets(true)
  }

  $effect(() => {
    loadRefreshNonce
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
    const force = forceNextLoad
    forceNextLoad = false
    const requestId = ++loadRequestId

    loadCachedCommunityCuratedWidgets(input, {force})
      .then(result => {
        if (requestId !== loadRequestId || key !== loadKey) {
          logCommunityWidgetDebug("launcher slot discarded stale curated widgets result", {
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
      })
      .catch(error => {
        if (requestId !== loadRequestId || key !== loadKey) return

        console.warn("[community-widget-slots] Failed to load widgets", error)
        curatedWidgets = []
        loadKey = ""
      })
  })

  onMount(() => {
    const refresh = () => refreshWidgets(true)

    window.addEventListener("pageshow", refresh)
    window.addEventListener("focus", refresh)
    window.addEventListener("online", refresh)
    document.addEventListener("visibilitychange", refreshVisibleWidgets)

    return () => {
      window.removeEventListener("pageshow", refresh)
      window.removeEventListener("focus", refresh)
      window.removeEventListener("online", refresh)
      document.removeEventListener("visibilitychange", refreshVisibleWidgets)
    }
  })

  onDestroy(() => {
    loadRequestId += 1
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
