<style>
  .extension-container {
    display: none;
  }
</style>

<script lang="ts">
  import {onDestroy, untrack} from "svelte"
  import {extensionRegistry} from "./registry"
  import {effectiveExtensionSettings} from "./settings"

  // Track enabled IDs from settings store
  const settings = $derived($effectiveExtensionSettings)
  const enabledIds = $derived(new Set(settings.enabled || []))

  // Track loaded extension IDs
  let loadedIds = $state<Set<string>>(new Set())
  let loadingIds = $state<Set<string>>(new Set())

  $effect(() => {
    const installedIds = new Set([
      ...Object.keys(settings.installed?.nip89 || {}),
      ...Object.keys(settings.installed?.widget || {}),
    ])

    // Use untrack to read loadedIds without creating a dependency loop
    // This effect should only re-run when settings or enabledIds change,
    // not when loadedIds changes (which we write to below)
    const currentLoadedIds = untrack(() => loadedIds)
    const currentLoadingIds = untrack(() => loadingIds)

    // Load newly enabled extensions
    for (const id of enabledIds) {
      if (!installedIds.has(id)) continue
      if (currentLoadedIds.has(id)) continue
      if (currentLoadingIds.has(id)) continue

      const manifest = settings.installed?.nip89?.[id]
      const widget = settings.installed?.widget?.[id]

      // Use async IIFE to handle loading
      ;(async () => {
        loadingIds = new Set([...untrack(() => loadingIds), id])

        try {
          if (manifest) {
            await extensionRegistry.loadIframeExtension(manifest)
          } else if (widget) {
            await extensionRegistry.loadWidget(widget)
          }
          // Update loadedIds after successful load
          loadedIds = new Set([...untrack(() => loadedIds), id])
        } catch (e) {
          console.error("Failed to load extension runtime:", e)
        } finally {
          const nextLoadingIds = new Set(untrack(() => loadingIds))
          nextLoadingIds.delete(id)
          loadingIds = nextLoadingIds
        }
      })()
    }

    // Drop ids that are no longer enabled or no longer registered
    const filteredIds = [...currentLoadedIds].filter(
      id => enabledIds.has(id) && installedIds.has(id),
    )
    if (filteredIds.length !== currentLoadedIds.size) {
      loadedIds = new Set(filteredIds)
    }

    const filteredLoadingIds = [...currentLoadingIds].filter(
      id => enabledIds.has(id) && installedIds.has(id),
    )
    if (filteredLoadingIds.length !== currentLoadingIds.size) {
      loadingIds = new Set(filteredLoadingIds)
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
