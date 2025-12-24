<style>
  #flotilla-extension-container {
    display: none;
  }
</style>

<script lang="ts">
  import {onMount, onDestroy} from "svelte"
  import {extensionRegistry} from "./registry"
  import {extensionSettings} from "./settings"
  import type {LoadedExtension} from "./types"

  // Svelte 5 runes-based state variables
  let enabledIds = $state<Set<string>>(new Set())
  const loaded = $state<LoadedExtension[]>([])

  let unsubRegistry: (() => void) | null = null
  let unsubSettings: (() => void) | null = null

  onMount(() => {
    // Subscribe to extensionSettings to maintain enabled ID set
    unsubSettings = extensionSettings.subscribe(settings => {
      enabledIds = new Set(settings.enabled)
    })

    // Subscribe to registry; load only enabled extensions
    unsubRegistry = extensionRegistry.asStore().subscribe(async extensions => {
      for (const ext of extensions) {
        if (!enabledIds.has(ext.manifest.id)) continue
        if (loaded.find(l => l.manifest.id === ext.manifest.id)) continue
        try {
          await extensionRegistry.loadIframeExtension(ext.manifest)
        } catch (e) {
          console.error("Failed to load extension iframe:", e)
        }
      }
    })
  })

  onDestroy(() => {
    unsubRegistry?.()
    unsubSettings?.()
    for (const ext of loaded) {
      extensionRegistry.unloadExtension(ext.manifest.id)
    }
  })
</script>

<!-- Hidden container for extension iframes -->
<div id="flotilla-extension-container"></div>
