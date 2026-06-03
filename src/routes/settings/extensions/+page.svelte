<script lang="ts">
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
  import {INDEXER_RELAYS, SMART_WIDGET_RELAYS} from "@app/core/state"
  import {loadCommunityCuratedWidgets} from "@app/extensions/community-curation"
  import {makeCommunityInputValue} from "@app/util/community-stars"
  import {pushToast} from "@app/util/toast"
  import type {ExtensionManifest, SmartWidgetEvent} from "@app/extensions/types"
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

  type CommunityDiscoveryState = "idle" | "loading" | "invalid" | "not-community" | "community"

  const settings = $derived($effectiveExtensionSettings)
  const defaultWidgets = $derived($defaultExtensionWidgets)
  const defaultIds = $derived(new Set(defaultWidgets.map(widget => widget.identifier)))
  const installedNip89 = $derived<ExtensionManifest[]>(
    Object.values(settings.installed?.nip89 || {}),
  )
  const installedWidgets = $derived<SmartWidgetEvent[]>(
    Object.values(settings.installed?.widget || {}),
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

    for (const widget of installedWidgets) {
      byId.set(widget.identifier, {
        type: "widget",
        id: widget.identifier,
        manifest: widget,
        isDefault: defaultIds.has(widget.identifier),
      })
    }

    return Array.from(byId.values())
  })
  const enabledIds = $derived<string[]>(settings.enabled || [])

  let communityDiscoveryState = $state<CommunityDiscoveryState>("idle")
  let communityDiscoveryMessage = $state("Select a community to see its curated widgets.")
  let curatedWidgets = $state<SmartWidgetEvent[]>([])
  let communityDiscoveryRequestId = 0
  let selectedCommunityPubkey = $state("")
  let communityWidgetLoadKey = ""
  let widgetTargetLoadKey = ""
  let widgetTargetDeleteLoadKey = ""

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
        relays: ref.relayHints.length ? ref.relayHints : ref.definition.relays,
      })),
  )
  const selectedCommunityOption = $derived(
    widgetCommunityOptions.find(option => option.pubkey === selectedCommunityPubkey),
  )

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

  const searchCommunityExtensions = async (option = selectedCommunityOption) => {
    if (!option) return

    communityDiscoveryState = "loading"
    communityDiscoveryMessage = "Looking for community-curated widgets..."
    curatedWidgets = []

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
    const publishRelays = normalizeRelays([
      ...baseRelays,
      ...targetEvents.flatMap(getWidgetTargetEventRelayHints),
      ...getWidgetTargetPublishRelays({
        communityOptions: widgetCommunityOptions,
        communityPubkeys: [...previousCommunityPubkeys, ...communityPubkeys],
      }),
    ])

    try {
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
      pushToast({theme: "success", message: "Widget community targets updated."})
    } catch (e: any) {
      pushToast({theme: "error", message: e?.message || "Failed to update widget targets."})
    }
  }

  $effect(() => {
    if (
      selectedCommunityPubkey &&
      widgetCommunityOptions.some(option => option.pubkey === selectedCommunityPubkey)
    ) {
      return
    }

    const activeCommunityPubkey = $activeCommunitySession?.communityPubkey || ""
    selectedCommunityPubkey = widgetCommunityOptions.some(
      option => option.pubkey === activeCommunityPubkey,
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
      communityDiscoveryMessage = widgetCommunityOptions.length
        ? "Select a community to see its curated widgets."
        : "No widget-capable community grants are available for this account."
      curatedWidgets = []
      return
    }

    if (key === communityWidgetLoadKey) return
    communityWidgetLoadKey = key

    void searchCommunityExtensions(option)
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

  const onInstallWidget = (widget: SmartWidgetEvent) => {
    try {
      installWidgetFromEvent(widget as any)
      enableExtension(widget.identifier)
      pushToast({
        theme: "success",
        message: `Installed and enabled widget ${widget.content || widget.identifier}`,
      })
    } catch (e: any) {
      pushToast({theme: "error", message: e?.message || "Install failed"})
    }
  }

  const onInstallWidgetByNaddr = async () => {
    if (!widgetNaddr) return
    installingWidget = true
    try {
      const widget = await installWidgetByNaddr(widgetNaddr)
      enableExtension(widget.identifier)
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

<div class="content column gap-4">
  <div class="card2 bg-alt col-8 shadow-xl">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <strong class="text-lg">Installed</strong>
        <p class="text-sm opacity-70">
          Default community extensions are installed and enabled automatically. You can disable
          them, but they cannot be uninstalled.
        </p>
      </div>
      {#if defaultWidgets.length > 0}
        <span class="badge badge-primary badge-sm">{defaultWidgets.length} community default</span>
      {/if}
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

  <div class="card2 bg-alt col-8 shadow-xl">
    <div class="flex flex-col gap-1">
      <strong class="text-lg">Community widgets</strong>
      <p class="text-sm opacity-70">
        Browse Smart Widgets curated into communities where you have widget publishing access.
      </p>
    </div>
    <div class="flex flex-wrap items-end gap-3">
      <label class="form-control min-w-64 flex-1">
        <span class="label-text">Community</span>
        <select
          class="select select-bordered w-full"
          bind:value={selectedCommunityPubkey}
          disabled={widgetCommunityOptions.length === 0 || communityDiscoveryLoading}>
          <option value="">Select a community</option>
          {#each widgetCommunityOptions as option (option.pubkey)}
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

    {#if curatedWidgets.length > 0}
      <div class="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
        {#each curatedWidgets as widget (widget.identifier)}
          {@const installedWidget = installedWidgets.some(
            (item: SmartWidgetEvent) => item.identifier === widget.identifier,
          )}
          {@const isDefaultWidget = defaultIds.has(widget.identifier)}
          <div class="card2 flex items-start justify-between gap-2 p-3">
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
                  {#if widget.slot?.type === "repo-tab"}
                    <span class="badge badge-primary badge-sm">Repo Tab</span>
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
            <div class="flex shrink-0 items-center gap-3">
              {#if installedWidget}
                <label class="row-2 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    class="toggle toggle-primary toggle-sm"
                    checked={enabledIds.includes(widget.identifier)}
                    onchange={e =>
                      toggle(widget.identifier, (e.currentTarget as HTMLInputElement).checked)} />
                  <span class="opacity-70">Enabled</span>
                </label>
              {:else}
                <Button class="btn btn-primary btn-sm" onclick={() => onInstallWidget(widget)}>
                  Install
                </Button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
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
