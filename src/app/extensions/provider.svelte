<style>
  .extension-container {
    display: none;
  }
</style>

<script lang="ts">
  import {onDestroy, onMount, untrack} from "svelte"
  import {get} from "svelte/store"
  import {extensionRegistry} from "./registry"
  import {effectiveExtensionSettings, extensionSettings, isExtensionEnabled} from "./settings"

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

  // --- Manifest polling ---
  // Re-fetch each installed NIP-89 manifest URL every 30 s and detect any content
  // change (version bump or any other field).  When a change is found:
  //   1. Update the stored manifest so the derived `extension` in the page component
  //      changes, which via `manifestSignature` in Effect 1 triggers an iframe reload.
  //   2. Reload the background registry runtime if the extension is currently loaded.
  const MANIFEST_POLL_MS = 30_000

  const pollManifests = async () => {
    const s = get(extensionSettings)
    const nip89 = s.installed?.nip89 || {}
    const manifestUrls = s.manifestUrls || {}

    for (const [id, installed] of Object.entries(nip89)) {
      const url = manifestUrls[id]
      if (!url) continue

      try {
        const sep = url.includes("?") ? "&" : "?"
        const res = await fetch(`${url}${sep}_t=${Date.now()}`, {
          cache: "no-store",
          headers: {"Cache-Control": "no-cache, no-store, must-revalidate"},
        })
        if (!res.ok) continue

        const fresh = await res.json()

        // Deep-compare: any field change triggers an update
        if (JSON.stringify(installed) === JSON.stringify(fresh)) continue

        console.log(`[manifest-poll] ${id} manifest changed — updating`)

        // Update the stored manifest (triggers reactive update via effectiveExtensionSettings)
        extensionSettings.update(s => ({
          ...s,
          installed: {
            ...s.installed,
            nip89: {...(s.installed?.nip89 || {}), [id]: fresh},
          },
        }))

        // Reload background runtime if currently active
        if (extensionRegistry.get(id)) {
          await extensionRegistry.unloadExtension(id)
          if (isExtensionEnabled(id)) {
            await extensionRegistry.loadIframeExtension(fresh)
          }
        }
      } catch {
        // Extension server may be temporarily unavailable — silently skip
      }
    }
  }

  let _pollTimer: ReturnType<typeof setInterval> | undefined

  onMount(() => {
    void pollManifests() // immediate check on mount
    _pollTimer = setInterval(() => void pollManifests(), MANIFEST_POLL_MS)
  })

  onDestroy(() => {
    if (_pollTimer !== undefined) clearInterval(_pollTimer)
    loadedIds.forEach(id => {
      extensionRegistry.unloadExtension(id)
    })
  })
</script>

<!-- Hidden container for extension iframes -->
<div id="flotilla-extension-container" class="extension-container"></div>
