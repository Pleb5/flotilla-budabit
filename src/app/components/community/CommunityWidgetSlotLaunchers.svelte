<script lang="ts">
  import WidgetIcon from "@assets/icons/widget.svg?dataurl"
  import {pubkey} from "@welshman/app"
  import {onDestroy, onMount} from "svelte"
  import {derived, get} from "svelte/store"
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
    getLastValidatedCommunityCuratedWidgets,
    getEnabledCommunitySlotWidgets,
    loadCachedCommunityCuratedWidgets,
    shouldPreserveCuratedWidgetView,
  } from "@app/extensions/community-widget-slots"
  import {logCommunityWidgetDebug} from "@app/extensions/community-widget-debug"
  import type {
    CommunityHomeWidgetRecoveryState,
    CommunityHomeWidgetSlotInitialState,
  } from "@app/extensions/community-home-widget-recovery"
  import {effectiveExtensionSettings} from "@app/extensions/settings"
  import {getWidgetLineId} from "@app/extensions/widget-identity"
  import type {
    CommunityWidgetRuntimeContext,
    SmartWidgetEvent,
    WidgetActionSlotType,
  } from "@app/extensions/types"
  import {pushModal} from "@app/util/modal"
  import {makeExactCommunityInputValue} from "@app/util/community-stars"

  type LauncherVariant = "message-actions" | "top-menu" | "home-quicklinks"

  type Props = {
    community: CommunityPointer
    slotType: WidgetActionSlotType
    variant?: LauncherVariant
    context?: Record<string, unknown>
    recovery?: CommunityHomeWidgetRecoveryState
    onInitialState?: (state: CommunityHomeWidgetSlotInitialState) => void
  }

  const {
    community,
    slotType,
    variant = "message-actions",
    context = {},
    recovery,
    onInitialState,
  }: Props = $props()
  const descriptor = $derived(
    $activeCommunityDescriptor?.community.address === community.address
      ? $activeCommunityDescriptor
      : undefined,
  )
  const exactCommunity = $derived(descriptor?.community)
  const exactDefinition = $derived(descriptor?.definition)
  const relayHints = $derived(exactCommunity?.relayHints || [])
  const communityReady = $derived(isCommunityDescriptorReady(descriptor, community.address))
  let curatedWidgets = $state<SmartWidgetEvent[]>([])
  let loadKey = ""
  let curationContextKey = ""
  let loadRequestId = 0
  let loadRefreshNonce = $state(0)
  let forceNextLoad = false
  let lastForcedRefreshAt = 0
  let loadTerminal = $state(false)
  let loadController: AbortController | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let retryDelay = 1_000
  const FORCED_REFRESH_DEBOUNCE_MS = 1_000

  const installedWidgets = $derived($effectiveExtensionSettings.installed?.widget || {})
  const enabledWidgetIds = $derived(new Set($effectiveExtensionSettings.enabled || []))
  const slotWidgets = $derived(
    getEnabledCommunitySlotWidgets({
      curatedWidgets: recovery
        ? recovery.communityAddress === community.address
          ? recovery.curatedWidgets
          : []
        : curatedWidgets,
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

    // The modal can outlive its launcher (including hash navigation). Own a store
    // subscription in WidgetFrame so public context and bridge checks stay in sync.
    const communityAddress = exactCommunity.address
    const communityRuntimeContextStore = derived(
      [
        activeCommunityDescriptor,
        activeCommunityProfileListEvents,
        activeCommunityReportState,
        pubkey,
      ],
      ([descriptor, profileListEvents, reportState, userPubkey]):
        | CommunityWidgetRuntimeContext
        | undefined => {
        if (
          descriptor?.community.address !== communityAddress ||
          descriptor.definition?.pointer.address !== communityAddress
        )
          return undefined
        const definition = descriptor.definition
        const community = descriptor.community
        const relays = descriptor.relays.length ? descriptor.relays : community.relayHints
        const communityContext = makeCommunityWidgetContext({
          definition,
          profileListEvents,
          reportState,
          userPubkey: userPubkey || "",
          relays,
          relayHints: community.relayHints,
          readinessKey: `${descriptor.authorityReadiness.key}:${descriptor.authorityReadiness.state}`,
        })
        return {
          community,
          definition,
          profileListEvents,
          reportState,
          relays,
          relayHints: community.relayHints,
          authorityEvidenceSettled: isCommunityDescriptorReady(descriptor, communityAddress),
          communityContext,
        }
      },
    )
    const communityContext = get(communityRuntimeContextStore)?.communityContext
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
        communityRuntimeContextStore,
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
    if (recovery) return
    void loadRefreshNonce
    const input = exactCommunity ? makeExactCommunityInputValue(exactCommunity) : ""
    const evidence = curationEvidence
    const key =
      input && evidence.ready
        ? `${normalizePubkey($pubkey || "")}:${slotType}:${input}:${evidence.key}`
        : ""

    if (!key || !input) {
      loadController?.abort()
      if (retryTimer) clearTimeout(retryTimer)
      retryTimer = undefined
      loadTerminal = false
      curatedWidgets = []
      loadKey = ""
      curationContextKey = ""
      loadRequestId += 1
      return
    }

    if (key === loadKey) return
    loadKey = key
    // Refresh in place on focus/visibility changes. Only a different community,
    // account, slot, or authority snapshot invalidates the displayed launchers.
    if (key !== curationContextKey) {
      curatedWidgets = getLastValidatedCommunityCuratedWidgets(input, $pubkey || "", evidence.key)
      loadTerminal = false
      retryDelay = 1_000
      curationContextKey = key
    }
    const force = forceNextLoad
    forceNextLoad = false
    const requestId = ++loadRequestId
    loadController?.abort()
    const controller = new AbortController()
    loadController = controller
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = undefined
    const scheduleRetry = () => {
      retryTimer = setTimeout(() => {
        retryTimer = undefined
        refreshWidgets(true)
      }, retryDelay)
      retryDelay = Math.min(retryDelay * 2, 15_000)
    }

    loadCachedCommunityCuratedWidgets(input, {
      evidenceKey: evidence.key,
      force,
      profileListEvents: evidence.profileListEvents,
      reportState: evidence.reportState,
      signal: controller.signal,
      onWidgets: widgets => {
        if (
          !controller.signal.aborted &&
          requestId === loadRequestId &&
          key === loadKey &&
          widgets.length
        ) {
          curatedWidgets = widgets
        }
      },
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

        const nextWidgets = result?.status === "community" ? result.widgets : []
        loadTerminal = true
        if (result?.complete === false) scheduleRetry()
        else retryDelay = 1_000
        if (
          !shouldPreserveCuratedWidgetView(
            curatedWidgets,
            nextWidgets,
            key === curationContextKey,
            result?.complete ?? true,
          )
        ) {
          curatedWidgets = nextWidgets
        }
      })
      .catch(error => {
        if (requestId !== loadRequestId || key !== loadKey) return
        if (controller.signal.aborted) return

        console.warn("[community-widget-slots] Failed to load widgets", error)
        loadTerminal = true
        scheduleRetry()
        loadKey = ""
      })
  })

  $effect(() => {
    onInitialState?.({
      slotType,
      frameCount: 0,
      loadedCount: 0,
      resolvedCount: 0,
      terminal:
        communityReady &&
        (recovery
          ? recovery.communityAddress === community.address && recovery.curatedFirstAttemptTerminal
          : loadTerminal),
    })
  })

  onMount(() => {
    if (recovery) return
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
    loadController?.abort()
    if (retryTimer) clearTimeout(retryTimer)
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
