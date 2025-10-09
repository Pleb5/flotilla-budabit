<script lang="ts">
  import {createEventDispatcher} from "svelte"
  import ExtensionPermissions from "./ExtensionPermissions.svelte"
  import type {ExtensionManifest} from "@app/extensions/types"

  type Props = {
    manifest: ExtensionManifest
    enabled?: boolean
  }

  const {manifest, enabled = false}: Props = $props()
  const dispatch = createEventDispatcher<{toggle: {enabled: boolean}}>()

  const onToggle = (value: boolean) => dispatch("toggle", {enabled: value})
</script>

<div class="flex w-full flex-col gap-2 rounded border border-base-300 bg-base-100 p-4 shadow-sm">
  <div class="flex w-full items-center justify-between">
    <div class="flex min-w-0 items-center gap-2">
      {#if manifest.icon}
        <img src={manifest.icon} alt="icon" class="h-6 w-6 rounded" />
      {/if}
      <h3 class="font-semibold">{manifest.name}</h3>
      {#if manifest.version}
        <span class="text-xs opacity-70">v{manifest.version}</span>
      {/if}
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

  {#if manifest.author}
    <p class="text-xs opacity-70">by {manifest.author}</p>
  {/if}
  {#if manifest.description}
    <p class="mt-1 text-sm">{manifest.description}</p>
  {/if}

  {#if manifest.permissions && manifest.permissions.length > 0}
    <ExtensionPermissions permissions={manifest.permissions} />
  {/if}
</div>
