<script lang="ts">
  import ExtensionPermissions from "./ExtensionPermissions.svelte"
  import ExtensionIcon from "./ExtensionIcon.svelte"
  import ProfileCircle from "./ProfileCircle.svelte"
  import ProfileLink from "./ProfileLink.svelte"
  import type {ExtensionManifest, SmartWidgetEvent, WidgetDisplayLocation} from "@app/extensions/types"
  import {checkForExtensionUpdate, refreshExtension} from "@app/core/commands"
  import {pushToast} from "@app/util/toast"
  import {RefreshCw} from "@lucide/svelte"

  type Props = {
    manifest: ExtensionManifest | SmartWidgetEvent
    enabled?: boolean
    type?: "nip89" | "widget"
    ontoggle?: (detail: {enabled: boolean}) => void
    onuninstall?: () => void
    displayLocation?: WidgetDisplayLocation
    onDisplayLocationChange?: (location: WidgetDisplayLocation) => void
    manifestUrl?: string // URL to check for updates (NIP-89 extensions only)
  }

  const {manifest, enabled = false, type = "nip89", ontoggle, onuninstall, displayLocation = "modal", onDisplayLocationChange, manifestUrl}: Props = $props()

  const onToggle = (value: boolean) => ontoggle?.({enabled: value})

  const isWidget = type === "widget"
  const widget = isWidget ? (manifest as SmartWidgetEvent) : null
  const extension = !isWidget ? (manifest as ExtensionManifest) : null

  let showWidgetModal = $state(false)

  const openWidget = () => {
    showWidgetModal = true
  }

  const closeWidget = () => {
    showWidgetModal = false
  }
  const displayName = isWidget
    ? widget?.content || widget?.identifier || "Smart Widget"
    : extension?.name
  const version = isWidget ? undefined : extension?.version
  const iconUrl = isWidget ? widget?.iconUrl || widget?.imageUrl : extension?.icon
  const description = isWidget
    ? widget?.widgetType
      ? `Smart Widget • ${widget.widgetType}`
      : undefined
    : extension?.description
  const permissions = isWidget ? widget?.permissions : extension?.permissions

  // Update checking state
  let checkingUpdate = $state(false)
  let updateAvailable = $state<ExtensionManifest | null>(null)
  let refreshing = $state(false)

  async function checkUpdate() {
    if (!manifestUrl || !extension?.id || isWidget) return
    
    checkingUpdate = true
    try {
      const newManifest = await checkForExtensionUpdate(extension.id, manifestUrl)
      updateAvailable = newManifest
    } catch (e) {
      console.error('Failed to check for update:', e)
    } finally {
      checkingUpdate = false
    }
  }

  async function handleRefresh() {
    if (!updateAvailable || !extension?.id) return
    
    refreshing = true
    try {
      await refreshExtension(extension.id, updateAvailable)
      pushToast({theme: "success", message: `Updated ${extension.name} to v${updateAvailable.version}`})
      updateAvailable = null
    } catch (e: any) {
      pushToast({theme: "error", message: e?.message || "Failed to refresh extension"})
    } finally {
      refreshing = false
    }
  }
</script>

<div class="flex w-full flex-col gap-2 rounded border border-base-300 bg-base-100 p-4 shadow-sm">
  <div class="flex w-full items-center justify-between">
    <div class="flex min-w-0 items-center gap-2">
      {#if iconUrl}
        <ExtensionIcon icon={iconUrl} size={24} class="h-6 w-6 rounded" />
      {/if}
      <h3 class="font-semibold">{displayName}</h3>
      {#if version}
        <span class="text-xs opacity-70">v{version}</span>
      {/if}
      {#if updateAvailable}
        <span class="badge badge-warning badge-sm">Update Available: v{updateAvailable.version}</span>
      {/if}
      <span class="badge badge-sm">{isWidget ? "Smart Widget" : "Extension"}</span>
    </div>
    <div class="ml-auto flex items-center gap-3">
      {#if !isWidget && manifestUrl}
        {#if updateAvailable}
          <button 
            class="btn btn-warning btn-xs" 
            onclick={handleRefresh}
            disabled={refreshing}>
            {refreshing ? "Updating..." : "Update Now"}
          </button>
        {:else}
          <button 
            class="btn btn-ghost btn-xs" 
            onclick={checkUpdate}
            disabled={checkingUpdate}
            title="Check for updates">
            <RefreshCw size={14} class={checkingUpdate ? "animate-spin" : ""} />
          </button>
        {/if}
      {/if}
      <label class="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          class="toggle toggle-primary toggle-sm"
          checked={enabled}
          onchange={e => onToggle((e.currentTarget as HTMLInputElement).checked)} />
        <span class="opacity-70">Enabled</span>
      </label>
      {#if onuninstall}
        <button class="btn btn-outline btn-error btn-xs" onclick={onuninstall}>
          Uninstall
        </button>
      {/if}
    </div>
  </div>

  {#if isWidget && widget?.pubkey}
    <div class="flex items-center gap-2 text-xs opacity-70">
      <span>by</span>
      <ProfileCircle pubkey={widget.pubkey} size={5} class="h-5 w-5" />
      <ProfileLink pubkey={widget.pubkey} class="hover:underline" />
    </div>
  {:else if !isWidget && extension?.author}
    <p class="text-xs opacity-70">by {extension.author}</p>
  {/if}
  {#if description}
    <p class="mt-1 text-sm">{description}</p>
  {/if}

  {#if isWidget && widget}
    <div class="text-xs opacity-70">
      {#if widget.appUrl}
        <div class="truncate" title={widget.appUrl}>App: {widget.appUrl}</div>
      {/if}
    </div>
    {#if widget.appUrl || widget.buttons?.length || onDisplayLocationChange}
      <div class="mt-2 flex flex-wrap items-center gap-2">
        {#if widget.appUrl}
          <button
            class="btn btn-primary btn-sm"
            onclick={openWidget}>
            Open App
          </button>
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
        {#if onDisplayLocationChange}
          <select
            class="select select-bordered select-sm"
            value={displayLocation}
            onchange={(e) => onDisplayLocationChange?.((e.currentTarget as HTMLSelectElement).value as WidgetDisplayLocation)}>
            <option value="" disabled>Display location...</option>
            <option value="modal">Modal (popup)</option>
            <option value="menu-route">Sidebar (own page)</option>
            <option value="top-menu">Top menu (button)</option>
          </select>
        {/if}
      </div>
    {/if}
  {/if}

  {#if permissions && permissions.length > 0}
    <ExtensionPermissions {permissions} />
  {/if}
</div>

{#if showWidgetModal && widget?.appUrl}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    role="dialog"
    aria-modal="true"
    aria-label="Widget modal"
    tabindex="-1"
    onclick={closeWidget}
    onkeydown={(e) => e.key === "Escape" && closeWidget()}>
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
          </div>
        </div>
        <button class="btn btn-ghost btn-sm" onclick={closeWidget}>✕</button>
      </div>
      <div class="relative flex-1">
        <iframe
          src={widget.appUrl}
          title={widget.content || widget.identifier}
          class="absolute inset-0 h-full w-full border-0"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        ></iframe>
      </div>
    </div>
  </div>
{/if}
