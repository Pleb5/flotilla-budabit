<script lang="ts">
  import ExtensionPermissions from "./ExtensionPermissions.svelte"
  import ExtensionIcon from "./ExtensionIcon.svelte"
  import ProfileCircle from "./ProfileCircle.svelte"
  import ProfileLink from "./ProfileLink.svelte"
  import WidgetFrame from "@app/components/WidgetFrame.svelte"
  import type {SmartWidgetEvent} from "@app/extensions/types"
  import type {CommunityWidgetPreviewContextOption} from "@app/extensions/recommendation-context"
  import type {WidgetUpdate} from "@app/extensions/widget-updates"
  import type {WidgetCommunityOption} from "@app/extensions/widget-targeting"
  import {isSecureEmbeddableUrl} from "@app/extensions/url-policy"
  import {RefreshCw} from "@lucide/svelte"

  type Props = {
    widget: SmartWidgetEvent
    enabled?: boolean
    ontoggle?: (detail: {enabled: boolean}) => void
    onuninstall?: () => void
    isDefault?: boolean
    communityOptions?: WidgetCommunityOption[]
    targetedCommunityPubkeys?: string[]
    previewCommunityOptions?: CommunityWidgetPreviewContextOption[]
    onTargetedCommunitiesChange?: (pubkeys: string[]) => Promise<void> | void
    widgetUpdate?: WidgetUpdate
    widgetUpdateChecking?: boolean
    widgetUpdateRefreshing?: boolean
    onWidgetUpdate?: () => Promise<void> | void
  }

  const {
    widget,
    enabled = false,
    ontoggle,
    onuninstall,
    isDefault = false,
    communityOptions = [],
    targetedCommunityPubkeys = [],
    previewCommunityOptions = [],
    onTargetedCommunitiesChange,
    widgetUpdate,
    widgetUpdateChecking = false,
    widgetUpdateRefreshing = false,
    onWidgetUpdate,
  }: Props = $props()

  const onToggle = (value: boolean) => ontoggle?.({enabled: value})

  const widgetAppUrls = $derived(
    (widget?.appUrls?.length ? widget.appUrls : widget?.appUrl ? [widget.appUrl] : []).filter(url =>
      isSecureEmbeddableUrl(url),
    ),
  )

  let showWidgetModal = $state(false)
  let showCommunityTargets = $state(false)
  let selectedCommunityPubkeys = $state<string[]>([])
  let selectedPreviewCommunityId = $state("")
  let savingCommunityTargets = $state(false)

  const openWidget = () => {
    showWidgetModal = true
  }

  const closeWidget = () => {
    showWidgetModal = false
  }

  const getCommunityLabel = (pubkey: string) =>
    communityOptions.find(option => option.pubkey === pubkey)?.label || pubkey

  const selectedPreviewCommunityOption = $derived.by(() =>
    previewCommunityOptions.find(option => option.id === selectedPreviewCommunityId) ||
    previewCommunityOptions[0]
  )

  const previewWidgetContext = $derived.by<Record<string, unknown>>(() => {
    const option = selectedPreviewCommunityOption
    if (!option?.runtimeContext.communityContext) return {}

    return {
      communityContext: option.runtimeContext.communityContext,
      communityRuntimeContext: option.runtimeContext,
    }
  })

  const toggleCommunityTarget = (pubkey: string, checked: boolean) => {
    selectedCommunityPubkeys = checked
      ? Array.from(new Set([...selectedCommunityPubkeys, pubkey]))
      : selectedCommunityPubkeys.filter(value => value !== pubkey)
  }

  const cancelCommunityTargetEdit = () => {
    selectedCommunityPubkeys = [...targetedCommunityPubkeys]
    showCommunityTargets = false
  }

  const saveCommunityTargets = async () => {
    if (!onTargetedCommunitiesChange || savingCommunityTargets) return

    savingCommunityTargets = true
    try {
      await onTargetedCommunitiesChange(selectedCommunityPubkeys)
      showCommunityTargets = false
    } finally {
      savingCommunityTargets = false
    }
  }

  $effect(() => {
    if (!showCommunityTargets) selectedCommunityPubkeys = [...targetedCommunityPubkeys]
  })

  $effect(() => {
    const ids = previewCommunityOptions.map(option => option.id)

    if (ids.length === 0) {
      selectedPreviewCommunityId = ""
      return
    }

    if (!ids.includes(selectedPreviewCommunityId)) selectedPreviewCommunityId = ids[0]
  })

  const displayName = $derived(widget?.content || widget?.identifier || "Smart Widget")
  const version = $derived(widget?.version)
  const iconUrl = $derived(widget?.iconUrl || widget?.imageUrl)
  const description = $derived(widget?.widgetType ? `Smart Widget • ${widget.widgetType}` : undefined)
  const permissions = $derived(widget?.permissions)

  const slotLabel = $derived.by(() => {
    if (!widget?.slot) return ""
    if (widget.slot.type === "repo-tab") return "Repo Tab"
    if (widget.slot.type === "community-home-before-quicklinks") return "Home: above quicklinks"
    if (widget.slot.type === "community-home-after-quicklinks") return "Home: below quicklinks"
    if (widget.slot.type === "chat-message-actions") return "Chat message actions"
    if (widget.slot.type === "global-menu") return "Global menu"
    return ""
  })

  const widgetUpdateVersion = $derived(widgetUpdate?.diff.version?.to)
  const widgetUpdateSummary = $derived.by(() => {
    if (!widgetUpdate) return []

    const diff = widgetUpdate.diff
    const summary: string[] = []

    if (diff.version?.from || diff.version?.to) {
      summary.push(`Version ${diff.version.from || "current"} -> ${diff.version.to || "latest"}`)
    }
    if (diff.appUrlChanged) summary.push("App URL changed")
    if (diff.widgetTypeChanged) summary.push("Widget type changed")
    if (diff.slotChanged) summary.push("Slot changed")
    if (diff.permissionsAdded.length) summary.push(`Adds ${diff.permissionsAdded.join(", ")}`)
    if (diff.permissionsRemoved.length) {
      summary.push(`Removes ${diff.permissionsRemoved.join(", ")}`)
    }
    if (summary.length === 0) summary.push("New widget publication")

    return summary
  })

</script>

<div
  class="flex w-full min-w-0 flex-col gap-2 overflow-hidden rounded border border-base-300 bg-base-100 p-4 shadow-sm">
  <div class="flex w-full flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
    <div class="flex min-w-0 flex-1 items-start gap-3">
      {#if iconUrl}
        <ExtensionIcon icon={iconUrl} size={24} class="h-6 w-6 shrink-0 rounded" />
      {/if}
      <div class="min-w-0 flex-1">
        <div class="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <h3 class="min-w-0 break-words font-semibold leading-tight">{displayName}</h3>
          {#if version}
            <span class="shrink-0 text-xs opacity-70">v{version}</span>
          {/if}
        </div>
        <div class="mt-1 flex min-w-0 flex-wrap gap-1.5">
          {#if widgetUpdate}
            <span class="badge-update badge badge-sm min-w-0 max-w-full">
              Widget update{#if widgetUpdateVersion}
                v{widgetUpdateVersion}{/if}
            </span>
          {/if}
          <span class="badge badge-sm min-w-0 max-w-full">
            Smart Widget
          </span>
          {#if slotLabel}
            <span class="badge badge-secondary badge-sm min-w-0 max-w-full">{slotLabel}</span>
          {/if}
          {#if targetedCommunityPubkeys.length > 0}
            <span class="badge badge-secondary badge-sm min-w-0 max-w-full">
              {targetedCommunityPubkeys.length} communit{targetedCommunityPubkeys.length === 1
                ? "y"
                : "ies"}
            </span>
          {/if}
          {#if isDefault}
            <span class="badge badge-primary badge-sm min-w-0 max-w-full">Community default</span>
          {/if}
        </div>
      </div>
    </div>
    <div
      class="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:max-w-[45%] sm:shrink-0 sm:justify-end lg:max-w-none">
      {#if widgetUpdate}
        <button
          class="btn btn-warning btn-xs shrink-0"
          onclick={() => onWidgetUpdate?.()}
          disabled={widgetUpdateRefreshing || !onWidgetUpdate}>
          {widgetUpdateRefreshing ? "Updating..." : "Update widget"}
        </button>
      {:else if widgetUpdateChecking}
        <button class="btn btn-ghost btn-xs shrink-0" disabled title="Checking for widget updates">
          <RefreshCw size={14} class="animate-spin" />
        </button>
      {/if}
      <label class="flex shrink-0 items-center gap-2 whitespace-nowrap text-sm">
        <input
          type="checkbox"
          class="toggle toggle-primary toggle-sm"
          checked={enabled}
          onchange={e => onToggle((e.currentTarget as HTMLInputElement).checked)} />
        <span class="opacity-70">Enabled</span>
      </label>
      {#if onuninstall}
        <button class="btn btn-outline btn-error btn-xs shrink-0" onclick={onuninstall}>
          Uninstall
        </button>
      {/if}
    </div>
  </div>

  {#if widget?.pubkey}
    <div class="flex items-center gap-2 text-xs opacity-70">
      <span>by</span>
      <ProfileCircle pubkey={widget.pubkey} size={5} class="h-5 w-5" />
      <ProfileLink pubkey={widget.pubkey} class="hover:underline" />
    </div>
  {/if}
  {#if description}
    <p class="mt-1 text-sm">{description}</p>
  {/if}

  {#if widget}
    <div class="text-xs opacity-70">
      {#if widget.appUrl}
        <div class="truncate" title={widget.appUrl}>App: {widget.appUrl}</div>
      {/if}
      {#if widget.appUrls && widget.appUrls.length > 1}
        <div>
          {widget.appUrls.length - 1} fallback app URL{widget.appUrls.length === 2 ? "" : "s"}
        </div>
      {/if}
    </div>
    {#if widget.appUrl || widget.appUrls?.length || widget.buttons?.length}
      <div class="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        {#if widgetAppUrls.length > 0 && previewCommunityOptions.length > 1}
          <label class="form-control min-w-0 flex-1 sm:max-w-72">
            <span class="label-text text-xs">Preview community</span>
            <select class="select select-bordered select-sm" bind:value={selectedPreviewCommunityId}>
              {#each previewCommunityOptions as option (option.id)}
                <option value={option.id}>{option.label || option.communityPubkey}</option>
              {/each}
            </select>
          </label>
        {/if}
        {#if widgetAppUrls.length > 0}
          <button class="btn btn-primary btn-sm sm:w-auto" onclick={openWidget}>Preview app</button>
        {:else if widget.appUrl}
          <span class="text-xs opacity-70">Insecure app URL blocked</span>
        {/if}
        {#each widget.buttons || [] as btn}
          {#if btn.type !== "app"}
            <a
              href={btn.url}
              target="_blank"
              rel="noopener noreferrer"
              class="btn btn-outline btn-sm">
              {btn.label}
            </a>
          {/if}
        {/each}
      </div>
    {/if}
    {#if widgetUpdate}
      <div class="mt-2 rounded-box border border-warning/40 bg-warning/10 p-3 text-xs">
        <div class="font-medium">Update available</div>
        {#if widgetUpdateSummary.length > 0}
          <div class="mt-1 flex min-w-0 flex-wrap gap-1.5">
            {#each widgetUpdateSummary as item (item)}
              <span class="badge badge-warning badge-sm min-w-0 max-w-full">{item}</span>
            {/each}
          </div>
        {:else}
          <p class="mt-1 opacity-70">A newer event was published for this widget.</p>
        {/if}
        {#if widgetUpdate.diff.changelog}
          <p class="mt-2 whitespace-pre-wrap opacity-80">{widgetUpdate.diff.changelog}</p>
        {/if}
      </div>
    {/if}
  {/if}

  {#if (widget && communityOptions.length > 0 && onTargetedCommunitiesChange) || (permissions && permissions.length > 0)}
    <details class="mt-2 rounded-box border border-base-300 bg-base-200/20 p-3 text-sm">
      <summary class="cursor-pointer select-none font-medium">Details</summary>
      <div class="mt-3 flex flex-col gap-3">
        {#if widget && communityOptions.length > 0 && onTargetedCommunitiesChange}
          <div class="rounded-box border border-base-300 bg-base-200/30 p-3 text-sm">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div>
                <strong>Community targets</strong>
                <p class="text-xs opacity-70">Curate this widget into eligible communities.</p>
              </div>
              <button
                type="button"
                class="btn btn-outline btn-xs"
                onclick={() => (showCommunityTargets = !showCommunityTargets)}>
                {showCommunityTargets ? "Close" : "Edit targets"}
              </button>
            </div>
            {#if targetedCommunityPubkeys.length > 0}
              <div class="mt-2 flex flex-wrap gap-1">
                {#each targetedCommunityPubkeys as communityPubkey (communityPubkey)}
                  <span class="badge badge-sm">{getCommunityLabel(communityPubkey)}</span>
                {/each}
              </div>
            {:else}
              <p class="mt-2 text-xs opacity-70">No community targets selected.</p>
            {/if}
            {#if showCommunityTargets}
              <div class="mt-3 flex flex-col gap-2">
                {#each communityOptions as option (option.pubkey)}
                  <label class="flex items-center gap-3 rounded-md border border-base-300 p-2">
                    <input
                      type="checkbox"
                      checked={selectedCommunityPubkeys.includes(option.pubkey)}
                      onchange={event =>
                        toggleCommunityTarget(option.pubkey, event.currentTarget.checked)} />
                    <span class="min-w-0 flex-1 truncate">{option.label || option.pubkey}</span>
                  </label>
                {/each}
                <div class="flex justify-end gap-2">
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs"
                    onclick={cancelCommunityTargetEdit}
                    disabled={savingCommunityTargets}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    class="btn btn-primary btn-xs"
                    onclick={saveCommunityTargets}
                    disabled={savingCommunityTargets}>
                    {savingCommunityTargets ? "Saving..." : "Save targets"}
                  </button>
                </div>
              </div>
            {/if}
          </div>
        {/if}

        {#if permissions && permissions.length > 0}
          <ExtensionPermissions {permissions} />
        {/if}
      </div>
    </details>
  {/if}
</div>

{#if showWidgetModal && (widget?.appUrl || widget?.appUrls?.length)}
  <div
    class="z-50 fixed inset-0 flex items-center justify-center bg-black/50"
    role="dialog"
    aria-modal="true"
    aria-label="Widget modal"
    tabindex="-1"
    onclick={closeWidget}
    onkeydown={e => e.key === "Escape" && closeWidget()}>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="flex h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-xl bg-base-100 shadow-2xl"
      onclick={e => e.stopPropagation()}
      onkeydown={e => e.stopPropagation()}>
      <div class="flex items-center justify-between border-b border-base-300 px-4 py-3">
        <div class="flex items-center gap-3">
          {#if widget.iconUrl || widget.imageUrl}
            <img
              src={widget.iconUrl || widget.imageUrl}
              alt="icon"
              class="h-8 w-8 rounded object-cover" />
          {/if}
          <div>
            <h2 class="font-semibold">{widget.content || widget.identifier}</h2>
            <p class="text-xs opacity-70">Smart Widget • {widget.widgetType}</p>
            {#if selectedPreviewCommunityOption}
              <p class="text-xs opacity-70">
                Previewing in {selectedPreviewCommunityOption.label || selectedPreviewCommunityOption.communityPubkey}
              </p>
            {/if}
          </div>
        </div>
        <button class="btn btn-ghost btn-sm" onclick={closeWidget}>✕</button>
      </div>
      <div class="relative min-h-0 flex-1 overflow-auto bg-base-300 p-4">
        <WidgetFrame widget={widget} context={previewWidgetContext} class="h-full" minHeight={0} />
      </div>
    </div>
  </div>
{/if}
