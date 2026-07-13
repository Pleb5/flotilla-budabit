<script lang="ts">
  import {getTagValue} from "@welshman/util"
  import {pubkey, repository} from "@welshman/app"
  import {onDestroy, onMount} from "svelte"
  import WidgetFrame from "@app/components/WidgetFrame.svelte"
  import {normalizePubkey} from "@app/core/community"
  import {
    activeCommunityDefinition,
    activeCommunityPermissionStatus,
    activeCommunityProfile,
    activeCommunityProfileListEvents,
    activeCommunityRelays,
    activeCommunityReportState,
    loadCommunityEvents,
  } from "@app/core/community-state"
  import {makeCommunityWidgetContext} from "@app/extensions/community-context"
  import {
    COMMUNITY_SHARED_CONFIG_KIND,
    getEnabledCommunitySlotWidgetsWithSharedConfig,
    getEnabledCommunitySlotWidgets,
    getEnabledInstalledCommunitySlotWidgets,
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
  let curatedWidgetsLoading = $state(false)
  let loadKey = ""
  let loadRequestId = 0
  let loadRefreshNonce = $state(0)
  let forceNextLoad = false
  let lastForcedRefreshAt = 0
  let curatedWidgetsBaseKey = ""
  let lastLoadReadinessKey = ""
  let loadedCommunitySharedConfigEvents = $state<any[]>([])
  let sharedConfigLoadKey = ""
  let sharedConfigLoadRequestId = 0
  const FORCED_REFRESH_DEBOUNCE_MS = 1_000

  const installedWidgets = $derived($effectiveExtensionSettings.installed?.widget || {})
  const enabledWidgetIds = $derived(new Set($effectiveExtensionSettings.enabled || []))
  const installedSlotWidgets = $derived.by(() => {
    return getEnabledInstalledCommunitySlotWidgets({
      installedWidgets,
      enabledIds: enabledWidgetIds,
      slotType,
    })
  })
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

  const communityReadinessKey = $derived.by(() => {
    const status = $activeCommunityPermissionStatus

    return normalizePubkey(status.communityPubkey) === normalizePubkey(communityPubkey)
      ? JSON.stringify({
          permissionKey: status.key,
          permissionLoading: status.loading,
          permissionLoaded: status.loaded,
          permissionHasCachedEvents: status.hasCachedEvents,
        })
        : ""
  })
  const communityPermissionEvidenceLoading = $derived.by(() => {
    const status = $activeCommunityPermissionStatus

    return Boolean(
      normalizePubkey(status.communityPubkey) === normalizePubkey(communityPubkey) &&
        status.loading &&
        !status.loaded,
    )
  })
  const cachedCommunitySharedConfigEvents = $derived.by(() => {
    communityReadinessKey
    loadRefreshNonce

    try {
      return repository.query([{kinds: [COMMUNITY_SHARED_CONFIG_KIND], limit: 200}] as any)
    } catch (error) {
      console.warn("[community-home-widgets] Failed to query cached shared config", error)
      return []
    }
  })
  const communitySharedConfigEvents = $derived.by(() => {
    const byId = new Map<string, any>()

    for (const event of [...cachedCommunitySharedConfigEvents, ...loadedCommunitySharedConfigEvents]) {
      const key = event?.id || JSON.stringify(event?.tags || [])
      if (key && !byId.has(key)) byId.set(key, event)
    }

    return Array.from(byId.values())
  })
  const sharedConfigSlotWidgets = $derived.by(() => {
    return getEnabledCommunitySlotWidgetsWithSharedConfig({
      communityPubkey,
      sharedConfigEvents: communitySharedConfigEvents,
      installedWidgets,
      enabledIds: enabledWidgetIds,
      slotType,
    })
  })

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
      readinessKey: communityReadinessKey,
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
  const frameWidgets = $derived.by(() => {
    if (slotWidgets.length > 0) return slotWidgets

    return sharedConfigSlotWidgets
  })
  const loadingSlotWidgets = $derived.by(() => {
    if (frameWidgets.length > 0) return []

    const loadingCandidates = new Map<string, SmartWidgetEvent>()
    const addWidget = (widget: SmartWidgetEvent) => {
      const key = getWidgetLineId(widget) || widget.identifier
      if (key && !loadingCandidates.has(key)) loadingCandidates.set(key, widget)
    }

    for (const widget of slotWidgets) addWidget(widget)
    for (const widget of sharedConfigSlotWidgets) addWidget(widget)
    if (curatedWidgetsLoading || communityPermissionEvidenceLoading || !communityContext) {
      for (const widget of installedSlotWidgets) addWidget(widget)
    }

    return Array.from(loadingCandidates.values())
  })

  const makeWidgetContext = (widget: SmartWidgetEvent) => ({
    slot: {type: slotType, label: widget.slot?.label},
    community: {pubkey: communityPubkey, relays: relayHints},
    ...(communityContext ? {communityContext} : {}),
    ...(communityRuntimeContext ? {communityRuntimeContext} : {}),
  })

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
    const normalizedCommunityPubkey = normalizePubkey(communityPubkey)
    const relays = $activeCommunityRelays.length ? $activeCommunityRelays : relayHints
    const key = normalizedCommunityPubkey
      ? `${normalizedCommunityPubkey}:${relays.join("|")}:${communityReadinessKey}`
      : ""

    if (!key || relays.length === 0) {
      loadedCommunitySharedConfigEvents = []
      sharedConfigLoadKey = ""
      sharedConfigLoadRequestId += 1
      return
    }

    if (key === sharedConfigLoadKey) return
    sharedConfigLoadKey = key
    const requestId = ++sharedConfigLoadRequestId

    loadCommunityEvents(
      relays,
      [{kinds: [COMMUNITY_SHARED_CONFIG_KIND], "#p": [normalizedCommunityPubkey], limit: 200} as any],
      {
        authenticate: true,
        priorityAuthRelays: relayHints,
        settle: "first-non-empty",
        timeout: 3_000,
      },
    )
      .then(events => {
        if (requestId === sharedConfigLoadRequestId && key === sharedConfigLoadKey) {
          loadedCommunitySharedConfigEvents = events
        }
      })
      .catch(error => {
        if (requestId !== sharedConfigLoadRequestId || key !== sharedConfigLoadKey) return

        console.warn("[community-home-widgets] Failed to load shared config hints", error)
        loadedCommunitySharedConfigEvents = []
      })
  })

  $effect(() => {
    loadRefreshNonce
    const input = makeCommunityInputValue({pubkey: communityPubkey, relayHints})
    const baseKey = input ? `${slotType}:${input}` : ""
    const readinessKey = communityReadinessKey
    const key = baseKey ? `${baseKey}:${readinessKey}` : ""

    if (!key || !input) {
      curatedWidgets = []
      curatedWidgetsLoading = false
      curatedWidgetsBaseKey = ""
      lastLoadReadinessKey = ""
      loadKey = ""
      loadRequestId += 1
      return
    }

    if (baseKey !== curatedWidgetsBaseKey) {
      curatedWidgets = []
      curatedWidgetsLoading = false
      curatedWidgetsBaseKey = baseKey
      lastLoadReadinessKey = ""
    }

    if (key === loadKey) return
    loadKey = key
    const readinessChanged = Boolean(lastLoadReadinessKey && lastLoadReadinessKey !== readinessKey)
    lastLoadReadinessKey = readinessKey
    const force = forceNextLoad || readinessChanged
    forceNextLoad = false
    const requestId = ++loadRequestId
    curatedWidgetsLoading = true

    logCommunityWidgetDebug("home slot loading curated widgets", {
      slotType,
      communityPubkey,
      relayHints,
      input,
      key,
      force,
    })

    loadCachedCommunityCuratedWidgets(input, {force})
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

        curatedWidgetsLoading = false
        const nextCuratedWidgets = result?.status === "community" ? result.widgets : []
        const preserveCurrentWidgets = Boolean(
          nextCuratedWidgets.length === 0 &&
            curatedWidgets.length > 0 &&
            curatedWidgetsBaseKey === baseKey &&
            communityPermissionEvidenceLoading,
        )

        if (!preserveCurrentWidgets) curatedWidgets = nextCuratedWidgets
        logCommunityWidgetDebug("home slot loaded curated widgets", {
          slotType,
          communityPubkey,
          key,
          status: result?.status,
          preservedCurrentWidgets: preserveCurrentWidgets,
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

        curatedWidgetsLoading = false
        console.warn("[community-home-widgets] Failed to load widgets", error)
        logCommunityWidgetDebug("home slot failed to load curated widgets", {
          slotType,
          communityPubkey,
          key,
          error: error instanceof Error ? error.message : String(error),
        })
        if (!(communityPermissionEvidenceLoading && curatedWidgets.length > 0)) curatedWidgets = []
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

{#if frameWidgets.length > 0}
  <div class="flex flex-col gap-2">
    {#each frameWidgets as widget (getWidgetLineId(widget))}
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
          minHeight={220}
          resizeMinHeight={0} />
      </section>
    {/each}
  </div>
{:else if loadingSlotWidgets.length > 0}
  <div class="flex flex-col gap-2">
    {#each loadingSlotWidgets as widget (getWidgetLineId(widget))}
      {@const title = widget.slot?.label || getWidgetTitle(widget)}
      <section class="overflow-visible" aria-label={title} aria-busy="true">
        <div
          class="flex min-h-[220px] items-center justify-center rounded-box bg-base-200 p-6 text-center text-sm text-base-content/70">
          <div class="flex flex-col items-center gap-3">
            <span class="loading loading-spinner loading-lg text-primary"></span>
            <p>Loading {title}...</p>
          </div>
        </div>
      </section>
    {/each}
  </div>
{/if}
