<script lang="ts">
  import {onDestroy, untrack} from "svelte"
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

    // Use untrack to read loadedIds without creating a dependency loop
    // This effect should only re-run when extensions or enabledIds change,
    // not when loadedIds changes (which we write to below)
    const currentLoadedIds = untrack(() => loadedIds)

    // Load newly enabled extensions
    for (const ext of extensions) {
      if (!enabledIds.has(ext.id)) continue
      if (currentLoadedIds.has(ext.id)) continue

      // Use async IIFE to handle loading
      ;(async () => {
        try {
          if (ext.type === "nip89") {
            await extensionRegistry.loadIframeExtension(ext.manifest)
          } else if (ext.type === "widget") {
            await extensionRegistry.loadWidget(ext.widget)
          }
          // Update loadedIds after successful load
          loadedIds = new Set([...untrack(() => loadedIds), ext.id])
        } catch (e) {
          console.error("Failed to load extension runtime:", e)
        }
      })()
    }

    // Drop ids that are no longer enabled or no longer registered
    const filteredIds = [...currentLoadedIds].filter(id => enabledIds.has(id) && presentIds.has(id))
    if (filteredIds.length !== currentLoadedIds.size) {
      loadedIds = new Set(filteredIds)
    }
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
