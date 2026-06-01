<script lang="ts">
  import {profileSearch} from "@welshman/app"
  import {
    defaultExtensionWidgets,
    effectiveExtensionSettings,
    setWidgetDisplayConfig,
  } from "@app/extensions/settings"
  import ExtensionCard from "@app/components/ExtensionCard.svelte"
  import CommunityPreviewCard from "@app/components/community/CommunityPreviewCard.svelte"
  import {
    enableExtension,
    disableExtension,
    installExtension,
    uninstallExtension,
    installWidgetFromEvent,
    installWidgetByNaddr,
  } from "@app/core/commands"
  import {DEFAULT_COMMUNITY_INPUT} from "@app/core/community-state"
  import {parseCommunityInput} from "@app/core/community"
  import {loadCommunityCuratedWidgets} from "@app/extensions/community-curation"
  import {makeCommunityInputValue} from "@app/util/community-stars"
  import {pushToast} from "@app/util/toast"
  import type {ExtensionManifest, SmartWidgetEvent} from "@app/extensions/types"
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

  let communityInput = $state(DEFAULT_COMMUNITY_INPUT || "")
  let communityDiscoveryState = $state<CommunityDiscoveryState>("idle")
  let communityDiscoveryMessage = $state("Search a community to see its curated extensions.")
  let curatedWidgets = $state<SmartWidgetEvent[]>([])
  let curatedCommunityPubkey = $state("")
  let curatedCommunityRelayHints = $state<string[]>([])
  let communityDiscoveryRequestId = 0

  let manifestUrl = $state("")
  let installing = $state(false)
  let widgetNaddr = $state("")
  let installingWidget = $state(false)

  const hasCommunityInput = $derived(Boolean(communityInput.trim()))
  const previewInput = $derived(parseCommunityInput(communityInput))
  const previewPubkey = $derived(
    previewInput?.pubkey || (hasCommunityInput ? "" : curatedCommunityPubkey),
  )
  const previewRelayHints = $derived(
    previewInput?.relays?.length ? previewInput.relays : curatedCommunityRelayHints,
  )
  const communityDiscoveryLoading = $derived(communityDiscoveryState === "loading")
  const communityDiscoveryNotCommunity = $derived(communityDiscoveryState === "not-community")

  const searchCommunityInputProfiles = (term: string) => {
    const query = term.trim()
    if (!query) return []

    return ($profileSearch.searchValues(query) as string[]).slice(0, 8)
  }

  const selectCommunityInputProfile = (selectedPubkey: string) => {
    communityInput = makeCommunityInputValue({pubkey: selectedPubkey}) || selectedPubkey
  }

  const toggle = (id: string, value: boolean) => {
    if (value) enableExtension(id)
    else disableExtension(id)
  }

  const searchCommunityExtensions = async () => {
    if (!communityInput.trim()) return

    communityDiscoveryState = "loading"
    communityDiscoveryMessage = "Looking for community-curated extensions..."
    curatedWidgets = []

    const requestId = ++communityDiscoveryRequestId

    try {
      const result = await loadCommunityCuratedWidgets(communityInput)
      if (requestId !== communityDiscoveryRequestId) return

      curatedCommunityPubkey = result.communityPubkey || previewInput?.pubkey || ""
      curatedCommunityRelayHints = result.relayHints

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
        ? `${result.widgets.length} curated extension${result.widgets.length === 1 ? "" : "s"} found.`
        : "No curated extension found."
    } catch (e: any) {
      if (requestId !== communityDiscoveryRequestId) return
      communityDiscoveryState = "not-community"
      communityDiscoveryMessage = e?.message || "Not a community profile."
    }
  }

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
            manifestUrl={installedManifestUrl} />
        {/each}
      </div>
    {:else}
      <p class="opacity-70">No extensions installed.</p>
    {/if}
  </div>

  <div class="card2 bg-alt col-8 shadow-xl">
    <div class="flex flex-col gap-1">
      <strong class="text-lg">Discover extensions</strong>
      <p class="text-sm opacity-70">
        Search for a community profile. If it has a kind 10222 community definition, Budabit shows
        the extensions curated by that community.
      </p>
    </div>
    <CommunityPreviewCard
      pubkey={previewPubkey}
      relayHints={previewRelayHints}
      label="Community extension source"
      emptyInfo="Search a community to discover extensions."
      onOpen={searchCommunityExtensions}
      bind:inputValue={communityInput}
      showInput
      inputLabel="Search or paste a community"
      inputInfo="Community-curated discovery only shows extensions targeted by a valid community profile."
      inputPlaceholder="Search profiles, npub1..., hex, or ncommunity://..."
      showActions={false}
      loading={communityDiscoveryLoading}
      notFound={communityDiscoveryNotCommunity}
      inputSearch={searchCommunityInputProfiles}
      onInputSelect={selectCommunityInputProfile}
      onSubmit={searchCommunityExtensions} />
    <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
      <p
        class:opacity-70={communityDiscoveryState !== "invalid" &&
          communityDiscoveryState !== "not-community"}
        class:text-error={communityDiscoveryState === "invalid" ||
          communityDiscoveryState === "not-community"}>
        {communityDiscoveryMessage}
      </p>
      <Button
        class="btn btn-primary btn-sm"
        disabled={!communityInput.trim() || communityDiscoveryLoading}
        onclick={searchCommunityExtensions}>
        {communityDiscoveryLoading ? "Searching..." : "Search extensions"}
      </Button>
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
