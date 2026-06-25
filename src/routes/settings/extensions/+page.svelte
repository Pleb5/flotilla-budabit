<script lang="ts">
  import {page} from "$app/stores"
  import {tick} from "svelte"
  import {profilesByPubkey, pubkey, repository, tracker} from "@welshman/app"
  import {Router} from "@welshman/router"
  import {request} from "@welshman/net"
  import {deriveEventsDesc, deriveEventsById} from "@welshman/store"
  import {DELETE, type Filter, type TrustedEvent} from "@welshman/util"
  import {
    defaultExtensionWidgets,
    effectiveExtensionSettings,
    setWidgetDisplayConfig,
  } from "@app/extensions/settings"
  import ExtensionCard from "@app/components/ExtensionCard.svelte"
  import {
    enableExtension,
    disableExtension,
    installExtension,
    uninstallExtension,
    installWidgetFromEvent,
    installWidgetByNaddr,
    checkForWidgetUpdate,
    refreshWidget,
    publishDelete,
  } from "@app/core/commands"
  import {activeCommunitySession, activeUserCommunityRefs} from "@app/core/community-state"
  import {
    TARGETED_PUBLICATION_KIND,
    normalizePubkey,
    normalizeRelays,
    parseTargetedPublication,
  } from "@app/core/community"
  import {
    COMMUNITY_WRITE_TARGETS,
    communityWritableSectionsSupportTarget,
  } from "@app/core/community-permissions"
  import {SMART_WIDGET_KIND} from "@app/core/community-feeds"
  import {getWidgetLineId} from "@app/extensions/widget-identity"
  import {INDEXER_RELAYS, SMART_WIDGET_RELAYS} from "@app/core/state"
  import {loadCommunityCuratedWidgets} from "@app/extensions/community-curation"
  import {clearCommunityWidgetSlotCache} from "@app/extensions/community-widget-slots"
  import {
    getManualCommunityWidgets,
    getTrustedCommunityWidgets,
  } from "@app/extensions/community-widget-trust"
  import {makeCommunityInputValue} from "@app/util/community-stars"
  import {pushToast} from "@app/util/toast"
  import type {ExtensionManifest, SmartWidgetEvent} from "@app/extensions/types"
  import type {WidgetUpdate} from "@app/extensions/widget-updates"
  import {
    getWidgetAddress,
    getWidgetCommunityOptionRelayHints,
    getWidgetTargetEventRelayHints,
    getWidgetTargetPublishRelays,
    publishWidgetEventToTargets,
    publishWidgetTargetingEvent,
    type WidgetCommunityOption,
  } from "@app/extensions/widget-targeting"
  import FieldInline from "@lib/components/FieldInline.svelte"
  import Button from "@lib/components/Button.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import Collapse from "@lib/components/Collapse.svelte"
  import ExtensionIcon from "@app/components/ExtensionIcon.svelte"
  import ProfileCircle from "@app/components/ProfileCircle.svelte"
  import ProfileLink from "@app/components/ProfileLink.svelte"
  import BoxMinimalistic from "@assets/icons/box-minimalistic.svg?dataurl"
  import LinkRound from "@assets/icons/link-round.svg?dataurl"

  type InstalledItem =
    | {type: "nip89"; id: string; manifest: ExtensionManifest; isDefault: boolean}
    | {type: "widget"; id: string; manifest: SmartWidgetEvent; isDefault: boolean}
  type InstalledWidgetItem = {id: string; widget: SmartWidgetEvent}

  type CommunityDiscoveryState = "idle" | "loading" | "invalid" | "not-community" | "community"

  const settings = $derived($effectiveExtensionSettings)
  const defaultWidgets = $derived($defaultExtensionWidgets)
  const defaultIds = $derived(new Set(defaultWidgets.map(getWidgetLineId)))
  const installedNip89 = $derived<ExtensionManifest[]>(
    Object.values(settings.installed?.nip89 || {}),
  )
  const installedWidgetItems = $derived.by<InstalledWidgetItem[]>(() =>
    Object.entries(settings.installed?.widget || {}).map(([id, widget]) => ({id, widget})),
  )
  const installedWidgets = $derived<SmartWidgetEvent[]>(
    installedWidgetItems.map(item => item.widget),
  )
  const installed = $derived.by<InstalledItem[]>(() => {
    const byId = new Map<string, InstalledItem>()

    for (const manifest of installedNip89) {
      byId.set(manifest.id, {
        type: "nip89",
        id: manifest.id,
        manifest,
        isDefault: defaultIds.has(manifest.id),
      })
    }

    for (const {id, widget} of installedWidgetItems) {
      byId.set(id, {
        type: "widget",
        id,
        manifest: widget,
        isDefault: defaultIds.has(id),
      })
    }

    return Array.from(byId.values())
  })
  const enabledIds = $derived<string[]>(settings.enabled || [])

  let communityDiscoveryState = $state<CommunityDiscoveryState>("idle")
  let communityDiscoveryMessage = $state("Select a community to see its curated widgets.")
  let curatedWidgets = $state<SmartWidgetEvent[]>([])
  let trustedWidgetAuthorPubkeys = $state<string[]>([])
  let communityDiscoveryRequestId = 0
  let selectedCommunityPubkey = $state("")
  let communityWidgetLoadKey = ""
  let widgetTargetLoadKey = ""
  let widgetTargetDeleteLoadKey = ""
  let widgetUpdateLoadKey = ""
  let widgetUpdateRequestId = 0
  let widgetUpdates = $state<Record<string, WidgetUpdate>>({})
  let checkingWidgetUpdates = $state<Record<string, boolean>>({})
  let refreshingWidgetUpdates = $state<Record<string, boolean>>({})
  let trustedInstallInProgress = $state(false)
  let trustedSectionElement = $state<HTMLElement | null>(null)
  let highlightTrustedSection = $state(false)
  let focusedTrustedSectionKey = ""

  let manifestUrl = $state("")
  let installing = $state(false)
  let widgetNaddr = $state("")
  let installingWidget = $state(false)

  const communityDiscoveryLoading = $derived(communityDiscoveryState === "loading")
  const getCommunityOptionLabel = (communityPubkey: string) => {
    const profile = $profilesByPubkey.get(communityPubkey)
    return (
      profile?.display_name ||
      profile?.name ||
      `${communityPubkey.slice(0, 8)}...${communityPubkey.slice(-6)}`
    )
  }

  const communityDiscoveryOptions = $derived.by((): WidgetCommunityOption[] =>
    $activeUserCommunityRefs.map(ref => ({
      pubkey: ref.communityPubkey,
      label: getCommunityOptionLabel(ref.communityPubkey),
      relays: ref.definition.relays,
      relayHints: ref.relayHints,
    })),
  )
  const widgetCommunityOptions = $derived.by((): WidgetCommunityOption[] =>
    $activeUserCommunityRefs
      .filter(ref =>
        communityWritableSectionsSupportTarget({
          definition: ref.definition,
          writableSections: ref.writableSections,
          target: COMMUNITY_WRITE_TARGETS.widget,
        }),
      )
      .map(ref => ({
        pubkey: ref.communityPubkey,
        label: getCommunityOptionLabel(ref.communityPubkey),
        relays: ref.definition.relays,
        relayHints: ref.relayHints,
      })),
  )
  const selectedCommunityOption = $derived(
    communityDiscoveryOptions.find(
      option => normalizePubkey(option.pubkey) === normalizePubkey(selectedCommunityPubkey),
    ),
  )
  const trustedCuratedWidgets = $derived(
    getTrustedCommunityWidgets(curatedWidgets, trustedWidgetAuthorPubkeys),
  )
  const otherCuratedWidgets = $derived(
    getManualCommunityWidgets(curatedWidgets, trustedWidgetAuthorPubkeys),
  )
  const installedWidgetIds = $derived(new Set(installedWidgetItems.map(item => item.id)))
  const widgetUpdateCheckWidgets = $derived(
    installedWidgetItems.filter(item => !defaultIds.has(item.id)),
  )
  const widgetUpdateCount = $derived(Object.keys(widgetUpdates).length)
  const widgetUpdateCheckingCount = $derived(
    Object.values(checkingWidgetUpdates).filter(Boolean).length,
  )
  const trustedWidgetsToInstall = $derived(
    trustedCuratedWidgets.filter(widget => !enabledIds.includes(getWidgetLineId(widget))),
  )
  const requestedCommunityPubkey = $derived(
    normalizePubkey($page.url.searchParams.get("community") || ""),
  )
  const focusTrustedExtensions = $derived($page.url.searchParams.get("focus") === "trusted")

  const getUserOutboxRelays = () => {
    try {
      return Router.get().FromUser().getUrls() || []
    } catch {
      return []
    }
  }

  const makeTargetDeleteFilters = (events: TrustedEvent[]): Filter[] => {
    const ids = events.map(event => event.id).filter(Boolean)

    return ids.length ? [{kinds: [DELETE], "#e": ids, limit: ids.length * 2}] : []
  }

  const getDeletedTargetEventIds = (targetEvents: TrustedEvent[], deleteEvents: TrustedEvent[]) => {
    const targetAuthors = new Map(
      targetEvents.map(event => [event.id, normalizePubkey(event.pubkey)]),
    )
    const deleted = new Set<string>()

    for (const event of deleteEvents) {
      if (event.kind !== DELETE) continue
      const author = normalizePubkey(event.pubkey)

      for (const tag of event.tags || []) {
        if (tag[0] !== "e" || !tag[1]) continue
        if (targetAuthors.get(tag[1]) === author) deleted.add(tag[1])
      }
    }

    return deleted
  }

  const widgetTargetRelays = $derived.by(() =>
    normalizeRelays([
      ...SMART_WIDGET_RELAYS,
      ...INDEXER_RELAYS,
      ...getUserOutboxRelays(),
      ...widgetCommunityOptions.flatMap(option => getWidgetCommunityOptionRelayHints(option)),
    ]),
  )

  const widgetAddresses = $derived(installedWidgets.map(getWidgetAddress).filter(Boolean))
  const widgetTargetFilters = $derived.by((): Filter[] =>
    $pubkey && widgetAddresses.length
      ? [
          {
            kinds: [TARGETED_PUBLICATION_KIND],
            authors: [$pubkey],
            "#a": widgetAddresses,
            "#k": [String(SMART_WIDGET_KIND)],
          },
        ]
      : [],
  )
  const widgetTargetEventsStore = $derived(
    widgetTargetFilters.length
      ? deriveEventsDesc(deriveEventsById({repository, filters: widgetTargetFilters as any}))
      : undefined,
  )
  const widgetTargetDeleteFilters = $derived.by(() =>
    makeTargetDeleteFilters(
      $widgetTargetEventsStore ? ($widgetTargetEventsStore as TrustedEvent[]) : [],
    ),
  )
  const widgetTargetDeleteEventsStore = $derived(
    widgetTargetDeleteFilters.length
      ? deriveEventsDesc(deriveEventsById({repository, filters: widgetTargetDeleteFilters as any}))
      : undefined,
  )
  const deletedWidgetTargetIds = $derived.by(() =>
    getDeletedTargetEventIds(
      $widgetTargetEventsStore ? ($widgetTargetEventsStore as TrustedEvent[]) : [],
      $widgetTargetDeleteEventsStore ? ($widgetTargetDeleteEventsStore as TrustedEvent[]) : [],
    ),
  )
  const activeWidgetTargetEvents = $derived.by(() =>
    ($widgetTargetEventsStore ? ($widgetTargetEventsStore as TrustedEvent[]) : []).filter(
      event => !deletedWidgetTargetIds.has(event.id),
    ),
  )

  const toggle = (id: string, value: boolean) => {
    if (value) enableExtension(id)
    else disableExtension(id)
  }

  const getWidgetUpdateCheckKey = (widgets: InstalledWidgetItem[]) =>
    widgets
      .map(({id, widget}) => [id, widget.pubkey || "", widget.created_at || 0].join(":"))
      .sort()
      .join("|")

  const checkInstalledWidgetUpdates = async (widgets: InstalledWidgetItem[]) => {
    const ids = widgets.map(widget => widget.id).filter(Boolean)
    const requestId = ++widgetUpdateRequestId

    if (ids.length === 0) {
      widgetUpdates = {}
      checkingWidgetUpdates = {}
      return
    }

    checkingWidgetUpdates = Object.fromEntries(ids.map(id => [id, true]))
    try {
      const results = await Promise.all(
        ids.map(async id => {
          try {
            return [id, await checkForWidgetUpdate(id)] as const
          } catch (e) {
            console.warn("Widget update check failed", id, e)
            return [id, null] as const
          }
        }),
      )

      if (requestId !== widgetUpdateRequestId) return

      widgetUpdates = Object.fromEntries(
        results.filter((entry): entry is readonly [string, WidgetUpdate] => Boolean(entry[1])),
      )
    } finally {
      if (requestId === widgetUpdateRequestId) checkingWidgetUpdates = {}
    }
  }

  const onUpdateWidget = async (id: string) => {
    const update = widgetUpdates[id]
    if (!update) return

    refreshingWidgetUpdates = {...refreshingWidgetUpdates, [id]: true}
    try {
      const widget = await refreshWidget(id, update.latest, {relays: update.relays})
      const version = update.diff.version?.to
      widgetUpdates = Object.fromEntries(
        Object.entries(widgetUpdates).filter(([key]) => key !== id),
      )
      clearCommunityWidgetSlotCache()
      pushToast({
        theme: "success",
        message: `Updated widget ${widget.content || widget.identifier}${version ? ` to v${version}` : ""}`,
      })
    } catch (e: any) {
      pushToast({theme: "error", message: e?.message || "Failed to update widget."})
    } finally {
      refreshingWidgetUpdates = {...refreshingWidgetUpdates, [id]: false}
    }
  }

  const searchCommunityExtensions = async (option = selectedCommunityOption) => {
    if (!option) return

    communityDiscoveryState = "loading"
    communityDiscoveryMessage = "Looking for community-curated widgets..."
    curatedWidgets = []
    trustedWidgetAuthorPubkeys = []

    const requestId = ++communityDiscoveryRequestId
    const communityInput =
      makeCommunityInputValue({
        pubkey: option.pubkey,
        relayHints: getWidgetCommunityOptionRelayHints(option),
      }) || option.pubkey

    try {
      const result = await loadCommunityCuratedWidgets(communityInput)
      if (requestId !== communityDiscoveryRequestId) return

      if (result.status === "invalid-input") {
        communityDiscoveryState = "invalid"
        communityDiscoveryMessage = "Enter a valid community npub, hex pubkey, or ncommunity."
        return
      }

      if (result.status === "not-community") {
        communityDiscoveryState = "not-community"
        communityDiscoveryMessage = "Not a community profile."
        return
      }

      communityDiscoveryState = "community"
      curatedWidgets = result.widgets
      trustedWidgetAuthorPubkeys = result.trustedWidgetAuthorPubkeys
      communityDiscoveryMessage = result.widgets.length
        ? `${result.widgets.length} curated widget${result.widgets.length === 1 ? "" : "s"} found.`
        : "No curated widgets found."
    } catch (e: any) {
      if (requestId !== communityDiscoveryRequestId) return
      communityDiscoveryState = "not-community"
      communityDiscoveryMessage = e?.message || "Not a community profile."
    }
  }

  const getWidgetTargetEvents = (widget: SmartWidgetEvent) => {
    const address = getWidgetAddress(widget)
    if (!address) return []

    return activeWidgetTargetEvents.filter(event => {
      const targeting = parseTargetedPublication(event)

      return (
        targeting?.kind === SMART_WIDGET_KIND &&
        targeting.ref?.type === "a" &&
        targeting.ref.value === address
      )
    })
  }

  const getWidgetTargetedCommunityPubkeys = (widget: SmartWidgetEvent) => {
    const eligiblePubkeys = new Set(widgetCommunityOptions.map(option => option.pubkey))

    return Array.from(
      new Set(
        getWidgetTargetEvents(widget)
          .flatMap(event => parseTargetedPublication(event)?.communities || [])
          .map(community => normalizePubkey(community.pubkey))
          .filter(pubkey => pubkey && eligiblePubkeys.has(pubkey)),
      ),
    )
  }

  const getWidgetOriginalRelayHints = (widget: SmartWidgetEvent) =>
    normalizeRelays([
      ...Array.from(tracker.getRelays(widget.id) || []),
      ...SMART_WIDGET_RELAYS,
      ...INDEXER_RELAYS,
    ])

  const getWidgetInstallSourceRelays = (widget: SmartWidgetEvent) =>
    normalizeRelays([
      ...getWidgetOriginalRelayHints(widget),
      ...getWidgetCommunityOptionRelayHints(selectedCommunityOption),
    ])

  const waitForPublishThunks = async (thunks: Array<{complete?: Promise<unknown>} | undefined>) => {
    await Promise.allSettled(thunks.map(thunk => thunk?.complete || Promise.resolve()))
  }

  const onWidgetTargetedCommunitiesChange = async (
    widget: SmartWidgetEvent,
    communityPubkeys: string[],
  ) => {
    if (!$pubkey) {
      pushToast({theme: "error", message: "Log in to edit widget community targets."})
      return
    }

    const widgetPubkey = normalizePubkey(widget.pubkey || "")
    const widgetAddress = getWidgetAddress(widget)
    if (!widgetPubkey || !widgetAddress) {
      pushToast({theme: "error", message: "Widget is missing author or identifier metadata."})
      return
    }

    const targetEvents = getWidgetTargetEvents(widget)
    const previousCommunityPubkeys = targetEvents.flatMap(
      event =>
        parseTargetedPublication(event)?.communities.map(community => community.pubkey) || [],
    )
    const baseRelays = normalizeRelays([
      ...getWidgetOriginalRelayHints(widget),
      ...getUserOutboxRelays(),
    ])

    try {
      const publishRelays = normalizeRelays([
        ...baseRelays,
        ...targetEvents.flatMap(getWidgetTargetEventRelayHints),
        ...getWidgetTargetPublishRelays({
          communityOptions: widgetCommunityOptions,
          communityPubkeys: [...previousCommunityPubkeys, ...communityPubkeys],
        }),
      ])
      const deleteThunks = targetEvents.map(event => {
        const thunk = publishDelete({event, relays: publishRelays})
        if (thunk?.event) repository.publish(thunk.event as TrustedEvent)
        return thunk
      })

      const ownWidgetRepublish =
        widgetPubkey === normalizePubkey($pubkey)
          ? publishWidgetEventToTargets({
              event: {
                kind: SMART_WIDGET_KIND,
                content: widget.content,
                tags: (widget.tags || []).filter(tag => tag[0] !== "h"),
              },
              baseRelays: publishRelays,
              communityOptions: widgetCommunityOptions,
              communityPubkeys,
            })
          : undefined
      const targetingThunk = communityPubkeys.length
        ? publishWidgetTargetingEvent({
            widget,
            baseRelays: publishRelays,
            communityOptions: widgetCommunityOptions,
            communityPubkeys,
            originalRelay: getWidgetOriginalRelayHints(widget)[0] || publishRelays[0],
          })
        : undefined

      await waitForPublishThunks([...deleteThunks, ownWidgetRepublish, targetingThunk])
      clearCommunityWidgetSlotCache()
      pushToast({theme: "success", message: "Widget community targets updated."})
    } catch (e: any) {
      pushToast({theme: "error", message: e?.message || "Failed to update widget targets."})
    }
  }

  $effect(() => {
    if (
      requestedCommunityPubkey &&
      communityDiscoveryOptions.some(
        option => normalizePubkey(option.pubkey) === requestedCommunityPubkey,
      )
    ) {
      selectedCommunityPubkey = requestedCommunityPubkey
      return
    }

    if (
      selectedCommunityPubkey &&
      communityDiscoveryOptions.some(
        option => normalizePubkey(option.pubkey) === normalizePubkey(selectedCommunityPubkey),
      )
    ) {
      return
    }

    const activeCommunityPubkey = $activeCommunitySession?.communityPubkey || ""
    selectedCommunityPubkey = communityDiscoveryOptions.some(
      option => normalizePubkey(option.pubkey) === normalizePubkey(activeCommunityPubkey),
    )
      ? activeCommunityPubkey
      : ""
  })

  $effect(() => {
    const option = selectedCommunityOption
    const key = option
      ? `${option.pubkey}:${getWidgetCommunityOptionRelayHints(option).join(",")}`
      : ""

    if (!key) {
      communityWidgetLoadKey = ""
      communityDiscoveryState = "idle"
      communityDiscoveryMessage = communityDiscoveryOptions.length
        ? "Select a community to see its curated widgets."
        : "No member communities are available for this account."
      curatedWidgets = []
      trustedWidgetAuthorPubkeys = []
      return
    }

    if (key === communityWidgetLoadKey) return
    communityWidgetLoadKey = key

    void searchCommunityExtensions(option)
  })

  $effect(() => {
    if (
      !focusTrustedExtensions ||
      !requestedCommunityPubkey ||
      selectedCommunityPubkey !== requestedCommunityPubkey ||
      communityDiscoveryState !== "community"
    ) {
      return
    }

    const key = `${requestedCommunityPubkey}:${trustedCuratedWidgets.map(getWidgetLineId).join(",")}`
    if (key === focusedTrustedSectionKey) return
    focusedTrustedSectionKey = key

    void tick().then(() => {
      trustedSectionElement?.scrollIntoView({behavior: "smooth", block: "start"})
      highlightTrustedSection = true
      setTimeout(() => {
        highlightTrustedSection = false
      }, 2500)
    })
  })

  $effect(() => {
    if (widgetTargetRelays.length === 0 || widgetTargetFilters.length === 0) {
      widgetTargetLoadKey = ""
      return
    }

    const key = `${widgetTargetRelays.join(",")}:${widgetTargetFilters.map(filter => JSON.stringify(filter)).join("|")}`
    if (key === widgetTargetLoadKey) return
    widgetTargetLoadKey = key

    const controller = new AbortController()
    request({
      relays: widgetTargetRelays,
      filters: widgetTargetFilters as any,
      autoClose: true,
      signal: controller.signal,
    }).catch(() => undefined)

    return () => controller.abort()
  })

  $effect(() => {
    if (widgetTargetRelays.length === 0 || widgetTargetDeleteFilters.length === 0) {
      widgetTargetDeleteLoadKey = ""
      return
    }

    const key = `${widgetTargetRelays.join(",")}:${widgetTargetDeleteFilters.map(filter => JSON.stringify(filter)).join("|")}`
    if (key === widgetTargetDeleteLoadKey) return
    widgetTargetDeleteLoadKey = key

    const controller = new AbortController()
    request({
      relays: widgetTargetRelays,
      filters: widgetTargetDeleteFilters as any,
      autoClose: true,
      signal: controller.signal,
    }).catch(() => undefined)

    return () => controller.abort()
  })

  $effect(() => {
    const key = getWidgetUpdateCheckKey(widgetUpdateCheckWidgets)

    if (!key) {
      widgetUpdateLoadKey = ""
      widgetUpdates = {}
      checkingWidgetUpdates = {}
      return
    }

    if (key === widgetUpdateLoadKey) return
    widgetUpdateLoadKey = key

    void checkInstalledWidgetUpdates(widgetUpdateCheckWidgets)
  })

  const onInstallByUrl = async () => {
    if (!manifestUrl) return
    installing = true
    try {
      const manifest = await installExtension(manifestUrl)
      enableExtension(manifest.id)
      pushToast({theme: "success", message: `Installed and enabled ${manifest.name}`})
      manifestUrl = ""
    } catch (e: any) {
      pushToast({theme: "error", message: e?.message || "Install failed"})
    } finally {
      installing = false
    }
  }

  const onInstallWidget = async (widget: SmartWidgetEvent) => {
    try {
      const installedWidget = installWidgetFromEvent(widget as any, {
        relays: getWidgetInstallSourceRelays(widget),
      })
      await enableExtension(getWidgetLineId(installedWidget))
      clearCommunityWidgetSlotCache()
      pushToast({
        theme: "success",
        message: `Installed and enabled widget ${widget.content || widget.identifier}`,
      })
    } catch (e: any) {
      pushToast({theme: "error", message: e?.message || "Install failed"})
    }
  }

  const onInstallTrustedWidgets = async () => {
    if (trustedInstallInProgress || trustedWidgetsToInstall.length === 0) return

    const widgets = trustedWidgetsToInstall
    trustedInstallInProgress = true
    try {
      for (const widget of widgets) {
        const installedWidget = installWidgetFromEvent(widget as any, {
          relays: getWidgetInstallSourceRelays(widget),
        })
        await enableExtension(getWidgetLineId(installedWidget))
      }

      clearCommunityWidgetSlotCache()

      pushToast({
        theme: "success",
        message: `Installed and enabled ${widgets.length} trusted widget${widgets.length === 1 ? "" : "s"}`,
      })
    } catch (e: any) {
      pushToast({theme: "error", message: e?.message || "Failed to install trusted widgets."})
    } finally {
      trustedInstallInProgress = false
    }
  }

  const onInstallWidgetByNaddr = async () => {
    if (!widgetNaddr) return
    installingWidget = true
    try {
      const widget = await installWidgetByNaddr(widgetNaddr)
      enableExtension(getWidgetLineId(widget))
      clearCommunityWidgetSlotCache()
      pushToast({
        theme: "success",
        message: `Installed and enabled widget ${widget.content || widget.identifier}`,
      })
      widgetNaddr = ""
    } catch (e: any) {
      pushToast({theme: "error", message: e?.message || "Install failed"})
    } finally {
      installingWidget = false
    }
  }

  const onUninstall = async (id: string) => {
    try {
      await uninstallExtension(id)
      pushToast({theme: "info", message: "Uninstalled"})
    } catch (e: any) {
      pushToast({theme: "error", message: e?.message || "Uninstall failed"})
    }
  }
</script>

{#snippet communityWidgetCard(widget: SmartWidgetEvent, trusted: boolean)}
  {@const widgetId = getWidgetLineId(widget)}
  {@const installedWidget = installedWidgetIds.has(widgetId)}
  {@const isDefaultWidget = defaultIds.has(widgetId)}
  <div class="card2 flex flex-col gap-3 p-3 sm:flex-row sm:items-start sm:justify-between">
    <div class="flex min-w-0 flex-1 items-start gap-3">
      {#if widget.iconUrl || widget.imageUrl}
        <ExtensionIcon
          icon={widget.iconUrl || widget.imageUrl}
          size={40}
          class="h-10 w-10 shrink-0 rounded object-cover" />
      {:else}
        <div
          class="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-base-300 text-xs font-semibold uppercase">
          Ext
        </div>
      {/if}
      <div class="min-w-0 flex-1">
        <div class="break-words font-medium">{widget.content || widget.identifier}</div>
        {#if widget.pubkey}
          <div class="flex items-center gap-1.5 text-xs opacity-70">
            <span>by</span>
            <ProfileCircle pubkey={widget.pubkey} size={4} class="h-4 w-4" />
            <ProfileLink pubkey={widget.pubkey} class="hover:underline" />
          </div>
        {/if}
        <div class="flex flex-wrap gap-2 text-xs">
          <span class="opacity-70">Type: {widget.widgetType}</span>
          {#if trusted}
            <span class="badge badge-primary badge-sm">Trusted</span>
          {/if}
          {#if widget.slot?.type === "repo-tab"}
            <span class="badge badge-primary badge-sm">Repo Tab</span>
          {:else if widget.slot?.type === "community-home-before-quicklinks"}
            <span class="badge badge-secondary badge-sm">Home: above quicklinks</span>
          {:else if widget.slot?.type === "community-home-after-quicklinks"}
            <span class="badge badge-secondary badge-sm">Home: below quicklinks</span>
          {:else if widget.slot?.type === "chat-message-actions"}
            <span class="badge badge-secondary badge-sm">Chat message actions</span>
          {:else if widget.slot?.type === "global-menu"}
            <span class="badge badge-secondary badge-sm">Global menu</span>
          {/if}
          {#if isDefaultWidget}
            <span class="badge badge-primary badge-sm">Community default</span>
          {/if}
        </div>
        <div class="truncate text-xs opacity-50" title={widget.appUrl || widget.imageUrl}>
          {widget.appUrl || widget.imageUrl}
        </div>
      </div>
    </div>
    <div class="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0 sm:justify-end">
      {#if installedWidget}
        <label class="flex shrink-0 items-center gap-2 whitespace-nowrap text-sm">
          <input
            type="checkbox"
            class="toggle toggle-primary toggle-sm"
            checked={enabledIds.includes(widgetId)}
            onchange={e => toggle(widgetId, (e.currentTarget as HTMLInputElement).checked)} />
          <span class="opacity-70">Enabled</span>
        </label>
      {:else}
        <Button class="btn btn-primary btn-sm" onclick={() => onInstallWidget(widget)}>
          Install
        </Button>
      {/if}
    </div>
  </div>
{/snippet}

<div class="content column !max-w-5xl gap-4">
  <div class="card2 bg-alt col-8 shadow-xl">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <strong class="text-lg">Installed</strong>
        <p class="text-sm opacity-70">
          Installed extensions can be enabled, disabled, or uninstalled. Built-in defaults can be
          disabled but not uninstalled.
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        {#if widgetUpdateCheckingCount > 0}
          <span class="badge badge-ghost badge-sm">
            Checking {widgetUpdateCheckingCount} widget update{widgetUpdateCheckingCount === 1
              ? ""
              : "s"}
          </span>
        {/if}
        {#if widgetUpdateCount > 0}
          <span class="badge-update badge badge-sm">
            {widgetUpdateCount} widget update{widgetUpdateCount === 1 ? "" : "s"} available
          </span>
        {/if}
        {#if defaultWidgets.length > 0}
          <span class="badge badge-primary badge-sm"
            >{defaultWidgets.length} community default</span>
        {/if}
      </div>
    </div>
    {#if installed.length > 0}
      <div class="flex flex-col gap-3">
        {#each installed as item (item.id)}
          {@const widgetDisplay = settings.widgetDisplay || {}}
          {@const displayLocation = widgetDisplay[item.id]?.location || "modal"}
          {@const installedManifestUrl = settings.manifestUrls?.[item.id]}
          <ExtensionCard
            manifest={item.manifest}
            type={item.type}
            enabled={enabledIds.includes(item.id)}
            isDefault={item.isDefault}
            ontoggle={({enabled}) => toggle(item.id, enabled)}
            onuninstall={item.isDefault ? undefined : () => onUninstall(item.id)}
            {displayLocation}
            onDisplayLocationChange={loc => setWidgetDisplayConfig(item.id, {location: loc})}
            manifestUrl={installedManifestUrl}
            widgetUpdate={item.type === "widget" ? widgetUpdates[item.id] : undefined}
            widgetUpdateChecking={item.type === "widget"
              ? Boolean(checkingWidgetUpdates[item.id])
              : false}
            widgetUpdateRefreshing={item.type === "widget"
              ? Boolean(refreshingWidgetUpdates[item.id])
              : false}
            onWidgetUpdate={item.type === "widget" ? () => onUpdateWidget(item.id) : undefined}
            communityOptions={item.type === "widget" ? widgetCommunityOptions : []}
            targetedCommunityPubkeys={item.type === "widget"
              ? getWidgetTargetedCommunityPubkeys(item.manifest as SmartWidgetEvent)
              : []}
            onTargetedCommunitiesChange={item.type === "widget"
              ? pubkeys =>
                  onWidgetTargetedCommunitiesChange(item.manifest as SmartWidgetEvent, pubkeys)
              : undefined} />
        {/each}
      </div>
    {:else}
      <p class="opacity-70">No extensions installed.</p>
    {/if}
  </div>

  <div id="community-extensions" class="card2 bg-alt col-8 scroll-mt-20 shadow-xl">
    <div class="flex flex-col gap-1">
      <strong class="text-lg">Community widgets</strong>
      <p class="text-sm opacity-70">
        Browse Smart Widgets curated into communities where you are a member. Installation is always
        opt-in.
      </p>
    </div>
    <div class="flex flex-wrap items-end gap-3">
      <label class="form-control min-w-0 flex-1 sm:min-w-64">
        <span class="label-text">Community</span>
        <select
          class="select select-bordered w-full"
          bind:value={selectedCommunityPubkey}
          disabled={communityDiscoveryOptions.length === 0 || communityDiscoveryLoading}>
          <option value="">Select a community</option>
          {#each communityDiscoveryOptions as option (option.pubkey)}
            <option value={option.pubkey}>{option.label || option.pubkey}</option>
          {/each}
        </select>
      </label>
      <Button
        class="btn btn-primary btn-sm"
        disabled={!selectedCommunityOption || communityDiscoveryLoading}
        onclick={() => searchCommunityExtensions()}>
        {communityDiscoveryLoading ? "Searching..." : "Refresh widgets"}
      </Button>
    </div>
    <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
      <p
        class:opacity-70={communityDiscoveryState !== "invalid" &&
          communityDiscoveryState !== "not-community"}
        class:text-error={communityDiscoveryState === "invalid" ||
          communityDiscoveryState === "not-community"}>
        {communityDiscoveryMessage}
      </p>
    </div>

    {#if trustedCuratedWidgets.length > 0}
      <section
        id="trusted-community-extensions"
        bind:this={trustedSectionElement}
        class="mt-3 scroll-mt-24 rounded-box border border-primary/40 bg-primary/5 p-3 transition-shadow"
        class:ring-2={highlightTrustedSection}
        class:ring-primary={highlightTrustedSection}>
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <strong>Trusted extensions</strong>
            <p class="text-sm opacity-70">
              Published by this community's owner or widget-section moderators. Install only the
              widgets you want to use.
            </p>
          </div>
          <Button
            class="btn btn-primary btn-sm"
            disabled={trustedWidgetsToInstall.length === 0 || trustedInstallInProgress}
            onclick={onInstallTrustedWidgets}>
            {#if trustedInstallInProgress}
              Installing...
            {:else if trustedWidgetsToInstall.length === 0}
              All trusted installed
            {:else}
              Install all trusted
            {/if}
          </Button>
        </div>
        <div class="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
          {#each trustedCuratedWidgets as widget (getWidgetLineId(widget))}
            {@render communityWidgetCard(widget, true)}
          {/each}
        </div>
      </section>
    {/if}

    {#if otherCuratedWidgets.length > 0}
      <section class="mt-3">
        <div class="mb-2">
          <strong>Other curated widgets</strong>
          <p class="text-sm opacity-70">
            Curated by community widget writers. These are never installed automatically.
          </p>
        </div>
        <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
          {#each otherCuratedWidgets as widget (getWidgetLineId(widget))}
            {@render communityWidgetCard(widget, false)}
          {/each}
        </div>
      </section>
    {/if}
  </div>

  <Collapse class="card2 bg-alt col-8 shadow-xl">
    {#snippet title()}
      <strong class="text-lg">Advanced</strong>
    {/snippet}
    {#snippet description()}
      <p class="text-sm opacity-70">
        Manual install options for direct manifests and Smart Widget naddr values.
      </p>
    {/snippet}

    <div class="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <div class="card2 bg-base-100 shadow-sm">
        <strong class="text-lg">Install by URL</strong>
        <FieldInline>
          {#snippet label()}
            <p class="flex items-center gap-3">
              <Icon icon={BoxMinimalistic} />
              Manifest URL
            </p>
          {/snippet}
          {#snippet input()}
            <label class="input input-bordered flex w-full items-center gap-2">
              <Icon icon={LinkRound} />
              <input
                class="grow"
                placeholder="https://.../manifest.json"
                bind:value={manifestUrl} />
            </label>
          {/snippet}
          {#snippet info()}
            <p>Paste a NIP-89 manifest URL to install an extension.</p>
          {/snippet}
        </FieldInline>
        <div class="mt-3 flex justify-end">
          <Button
            class="btn btn-primary btn-sm"
            disabled={!manifestUrl || installing}
            onclick={onInstallByUrl}>
            {installing ? "Installing..." : "Install"}
          </Button>
        </div>
      </div>

      <div class="card2 bg-base-100 shadow-sm">
        <strong class="text-lg">Install Smart Widget (naddr)</strong>
        <FieldInline>
          {#snippet label()}
            <p class="flex items-center gap-3">
              <Icon icon={LinkRound} />
              Widget naddr
            </p>
          {/snippet}
          {#snippet input()}
            <label class="input input-bordered flex w-full items-center gap-2">
              <Icon icon={LinkRound} />
              <input class="grow" placeholder="naddr1..." bind:value={widgetNaddr} />
            </label>
          {/snippet}
          {#snippet info()}
            <p>Paste a Smart Widget naddr to install.</p>
          {/snippet}
        </FieldInline>
        <div class="mt-3 flex justify-end">
          <Button
            class="btn btn-primary btn-sm"
            disabled={!widgetNaddr || installingWidget}
            onclick={onInstallWidgetByNaddr}>
            {installingWidget ? "Installing..." : "Install Widget"}
          </Button>
        </div>
      </div>
    </div>
  </Collapse>
</div>
