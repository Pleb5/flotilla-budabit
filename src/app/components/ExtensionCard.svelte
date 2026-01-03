<script lang="ts">
  import {createEventDispatcher} from "svelte"
  import ExtensionPermissions from "./ExtensionPermissions.svelte"
  import type {ExtensionManifest, SmartWidgetEvent} from "@app/extensions/types"

  type Props = {
    manifest: ExtensionManifest | SmartWidgetEvent
    enabled?: boolean
    type?: "nip89" | "widget"
  }

  const {manifest, enabled = false, type = "nip89"}: Props = $props()
  const dispatch = createEventDispatcher<{toggle: {enabled: boolean}}>()

  const onToggle = (value: boolean) => dispatch("toggle", {enabled: value})

  const isWidget = type === "widget"
  const widget = isWidget ? (manifest as SmartWidgetEvent) : null
  const extension = !isWidget ? (manifest as ExtensionManifest) : null
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
</script>

<div class="flex w-full flex-col gap-2 rounded border border-base-300 bg-base-100 p-4 shadow-sm">
  <div class="flex w-full items-center justify-between">
    <div class="flex min-w-0 items-center gap-2">
      {#if iconUrl}
        <img src={iconUrl} alt="icon" class="h-6 w-6 rounded" />
      {/if}
      <h3 class="font-semibold">{displayName}</h3>
      {#if version}
        <span class="text-xs opacity-70">v{version}</span>
      {/if}
      <span class="badge badge-sm">{isWidget ? "Smart Widget" : "Extension"}</span>
    </div>
    <label class="row-2 ml-auto items-center gap-2 text-sm">
      <input
        type="checkbox"
        class="toggle toggle-primary"
        checked={enabled}
        onchange={e => onToggle((e.currentTarget as HTMLInputElement).checked)} />
      <span class="opacity-70">Enabled</span>
    </label>
  </div>

  {#if !isWidget && extension?.author}
    <p class="text-xs opacity-70">by {extension.author}</p>
  {/if}
  {#if description}
    <p class="mt-1 text-sm">{description}</p>
  {/if}

  {#if isWidget && widget}
    <div class="text-xs opacity-70">
      {#if widget.appUrl}
        <div>App: {widget.appUrl}</div>
      {/if}
      {#if widget.buttons?.length}
        <div>Primary: {widget.buttons[0].label} ({widget.buttons[0].type})</div>
      {/if}
    </div>
  {/if}

  {#if permissions && permissions.length > 0}
    <ExtensionPermissions {permissions} />
  {/if}
</div>
