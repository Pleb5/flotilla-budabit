<script lang="ts">
  import {onDestroy} from "svelte"
  import {extensionRegistry} from "./registry"
  import {extensionSettings} from "./settings"
  import type {LoadedExtension} from "./types"

  // Get store from registry
  const registryStore = extensionRegistry.asStore()

  // Track enabled IDs from settings store
  const settings = $derived($extensionSettings)
  const enabledIds = $derived(new Set(settings.enabled || []))

  // Track loaded extension IDs
  let loadedIds = $state<Set<string>>(new Set())

  // Load/unload extensions when registry or enabled state changes
  const extensions = $derived($registryStore as LoadedExtension[])

  $effect(() => {
    const presentIds = new Set(extensions.map(ext => ext.id))

    // Load newly enabled extensions
    for (const ext of extensions) {
      if (!enabledIds.has(ext.id)) continue
      if (loadedIds.has(ext.id)) continue

      // Use async IIFE to handle loading
      ;(async () => {
        try {
          if (ext.type === "nip89") {
            await extensionRegistry.loadIframeExtension(ext.manifest)
          } else if (ext.type === "widget") {
            await extensionRegistry.loadWidget(ext.widget)
          }
          loadedIds = new Set([...loadedIds, ext.id])
        } catch (e) {
          console.error("Failed to load extension runtime:", e)
        }
      })()
    }

    // Drop ids that are no longer enabled or no longer registered
    loadedIds = new Set(
      [...loadedIds].filter(id => enabledIds.has(id) && presentIds.has(id)),
    )
  })

  onDestroy(() => {
    loadedIds.forEach(id => {
      extensionRegistry.unloadExtension(id)
    })
  })
</script>

<!-- Hidden container for extension iframes -->
<div id="flotilla-extension-container" class="extension-container"></div>

<style>
  .extension-container {
    display: none;
  }
</style>
