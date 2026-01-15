<script lang="ts">
  import {onMount, onDestroy} from "svelte"
  import {extensionRegistry} from "./registry"
  import {extensionSettings} from "./settings"
  import type {LoadedExtension} from "./types"

  let enabledIds = $state<Set<string>>(new Set())
  let loadedIds = $state<Set<string>>(new Set())

  let unsubRegistry: (() => void) | null = null
  let unsubSettings: (() => void) | null = null

  onMount(() => {
    // Track enabled IDs
    unsubSettings = extensionSettings.subscribe(settings => {
      enabledIds = new Set(settings.enabled || [])
    })

    // Load runtime for enabled extensions of any type
    unsubRegistry = extensionRegistry.asStore().subscribe(async extensions => {
      const presentIds = new Set((extensions as LoadedExtension[]).map(ext => ext.id))

      for (const ext of extensions as LoadedExtension[]) {
        if (!enabledIds.has(ext.id)) continue
        if (loadedIds.has(ext.id)) continue

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
      }

      // Drop ids that are no longer enabled or no longer registered
      loadedIds = new Set(
        [...loadedIds].filter(id => enabledIds.has(id) && presentIds.has(id)),
      )
    })
  })

  onDestroy(() => {
    unsubRegistry?.()
    unsubSettings?.()
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
