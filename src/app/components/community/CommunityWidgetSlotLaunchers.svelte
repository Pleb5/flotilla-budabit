<script lang="ts">
  import WidgetIcon from "@assets/icons/widget.svg?dataurl"
  import {pubkey} from "@welshman/app"
  import {onDestroy, onMount} from "svelte"
  import {get} from "svelte/store"
  import WidgetModal from "@app/components/WidgetModal.svelte"
  import {normalizePubkey, type CommunityPointer} from "@app/core/community"
  import {
    activeCommunityDescriptor,
    activeCommunityProfileListEvents,
    activeCommunityReportState,
    isCommunityDescriptorReady,
  } from "@app/core/community-state"
  import {makeCommunityWidgetContext} from "@app/extensions/community-context"
  import {
    getCommunityWidgetCurationEvidenceKey,
    getEnabledCommunitySlotWidgets,
    loadCachedCommunityCuratedWidgets,
  } from "@app/extensions/community-widget-slots"
  import {logCommunityWidgetDebug} from "@app/extensions/community-widget-debug"
  import {effectiveExtensionSettings} from "@app/extensions/settings"
  import {getWidgetLineId} from "@app/extensions/widget-identity"
  import type {SmartWidgetEvent, WidgetActionSlotType} from "@app/extensions/types"
  import {pushModal} from "@app/util/modal"
  import {makeExactCommunityInputValue} from "@app/util/community-stars"

  type LauncherVariant = "message-actions" | "top-menu" | "home-quicklinks"

  type Props = {
    community: CommunityPointer
    slotType: WidgetActionSlotType
    variant?: LauncherVariant
    context?: Record<string, unknown>
  }

  const {community, slotType, variant = "message-actions", context = {}}: Props = $props()
  const descriptor = $derived(
    $activeCommunityDescriptor?.community.address === community.address
      ? $activeCommunityDescriptor
      : undefined,
  )
  const exactCommunity = $derived(descriptor?.community)
  const exactDefinition = $derived(descriptor?.definition)
  const relayHints = $derived(exactCommunity?.relayHints || [])
  const communityRelays = $derived(descriptor?.relays.length ? descriptor.relays : relayHints)
  const communityReady = $derived(isCommunityDescriptorReady(descriptor, community.address))
  const contextDefinition = $derived(
    exactDefinition ? {...exactDefinition, pubkey: exactDefinition.ownerPubkey} : undefined,
  )
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
    variant === "home-quicklinks"
      ? "contents"
      : variant === "top-menu"
        ? "relative isolate flex items-center gap-1"
        : "flex items-center gap-1",
  )
  const buttonClass = $derived(
    variant === "home-quicklinks"
      ? "btn btn-neutral gap-2 border-base-content/15 shadow-sm hover:border-base-content/25 md:text-lg"
      : variant === "top-menu"
        ? "btn btn-outline btn-sm gap-1"
        : "btn btn-circle btn-xs border border-solid border-neutral bg-base-100/90 shadow-sm backdrop-blur",
  )

  const getWidgetTitle = (widget: SmartWidgetEvent) =>
    widget.slot?.label || widget.content || widget.identifier || "Widget"

  const communityContext = $derived.by(() => {
    if (!exactDefinition || !exactCommunity || !communityReady) {
      return undefined
    }

    return makeCommunityWidgetContext({
      definition: contextDefinition as any,
      profileListEvents: $activeCommunityProfileListEvents,
      reportState: $activeCommunityReportState,
      userPubkey: $pubkey || "",
      relays: communityRelays,
      relayHints,
    })
  })
  const getCurrentCommunityRuntimeContext = () => {
    const descriptor = get(activeCommunityDescriptor)
    const exactCommunity = descriptor?.community
    const definition = descriptor?.definition
    if (
      !exactCommunity ||
      exactCommunity.address !== community.address ||
      !definition ||
      !isCommunityDescriptorReady(descriptor, community.address)
    ) {
      return undefined
    }

    const profileListEvents = get(activeCommunityProfileListEvents)
    const reportState = get(activeCommunityReportState)
    const relays = descriptor.relays.length ? descriptor.relays : exactCommunity.relayHints
    const currentCommunityContext = makeCommunityWidgetContext({
      definition: {...definition, pubkey: definition.ownerPubkey} as any,
      profileListEvents,
      reportState,
      userPubkey: get(pubkey) || "",
      relays,
      relayHints: exactCommunity.relayHints,
    })

    return {
      community: exactCommunity,
      definition,
      profileListEvents,
      reportState,
      relays,
      relayHints: exactCommunity.relayHints,
      communityContext: currentCommunityContext,
    }
  }
  const curationEvidence = $derived.by(() => {
    const definition = exactDefinition
    const matchesCommunity =
      communityReady &&
      definition &&
      exactCommunity &&
      definition.pointer.address === exactCommunity.address
    const profileListEvents = matchesCommunity ? $activeCommunityProfileListEvents : []
    const reportState = matchesCommunity ? $activeCommunityReportState : undefined

    return {
      ready: Boolean(matchesCommunity),
      key: matchesCommunity
        ? getCommunityWidgetCurationEvidenceKey({
            definitionEventId: definition.event.id,
            profileListEvents,
            reportState,
          })
        : "",
      profileListEvents,
      reportState,
    }
  })

  const openWidget = (widget: SmartWidgetEvent) => {
    if (!widget.appUrl || !exactCommunity || !communityReady) return

    pushModal(
      WidgetModal,
      {
        widget,
        wide: variant === "home-quicklinks",
        context: {
          ...context,
          slot: {type: slotType, label: widget.slot?.label},
          community: {
            address: exactCommunity.address,
            ownerPubkey: exactCommunity.ownerPubkey,
            communityId: exactCommunity.communityId,
            naddr: exactCommunity.naddr,
            relays: relayHints,
          },
          ...(communityContext ? {communityContext} : {}),
        },
        communityRuntimeContextProvider: getCurrentCommunityRuntimeContext,
      },
      variant === "home-quicklinks"
        ? {fullscreen: true, trapFocus: true, ariaLabel: getWidgetTitle(widget)}
        : {},
    )
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
    void loadRefreshNonce
    const input = exactCommunity ? makeExactCommunityInputValue(exactCommunity) : ""
    const evidence = curationEvidence
    const key =
      input && evidence.ready
        ? `${normalizePubkey($pubkey || "")}:${slotType}:${input}:${evidence.key}`
        : ""

    if (!key || !input) {
      curatedWidgets = []
      loadKey = ""
      loadRequestId += 1
      return
    }

    if (key === loadKey) return
    loadKey = key
    curatedWidgets = []
    const force = forceNextLoad
    forceNextLoad = false
    const requestId = ++loadRequestId

    loadCachedCommunityCuratedWidgets(input, {
      evidenceKey: evidence.key,
      force,
      profileListEvents: evidence.profileListEvents,
      reportState: evidence.reportState,
    })
      .then(result => {
        if (requestId !== loadRequestId || key !== loadKey) {
          logCommunityWidgetDebug("launcher slot discarded stale curated widgets result", {
            slotType,
            communityAddress: exactCommunity?.address,
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

{#if communityReady && slotWidgets.length > 0}
  <div class={containerClass} data-widget-slot={slotType}>
    {#each slotWidgets as widget (getWidgetLineId(widget))}
      {@const title = getWidgetTitle(widget)}
      <button
        type="button"
        class={buttonClass}
        {title}
        aria-label={title}
        aria-haspopup="dialog"
        onclick={() => openWidget(widget)}>
        {#if widget.iconUrl || widget.imageUrl}
          <img
            src={widget.iconUrl || widget.imageUrl}
            alt=""
            class={variant === "home-quicklinks"
              ? "h-6 w-6 shrink-0 object-contain"
              : "h-4 w-4 shrink-0 rounded object-cover"} />
        {:else}
          <img src={WidgetIcon} alt="" class="h-4 w-4 shrink-0" />
        {/if}
        {#if variant === "home-quicklinks"}
          <span class="truncate">{title}</span>
        {:else if variant === "top-menu"}
          <span class="hidden max-w-[100px] truncate lg:inline">{title}</span>
        {/if}
      </button>
    {/each}
  </div>
{/if}
