<script lang="ts">
  import {onMount, onDestroy} from "svelte"
  import {extensionSettings} from "@app/extensions/settings"
  import ExtensionCard from "@app/components/ExtensionCard.svelte"
  import {
    enableExtension,
    disableExtension,
    installExtension,
    uninstallExtension,
    installExtensionFromManifest,
  } from "@app/core/commands"
  import {pushToast} from "@app/util/toast"
  import type {ExtensionManifest} from "@app/extensions/types"
  import {load, request} from "@welshman/net"
  import {INDEXER_RELAYS} from "@app/core/state"
  import FieldInline from "@lib/components/FieldInline.svelte"
  import Button from "@lib/components/Button.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import BoxMinimalistic from "@assets/icons/box-minimalistic.svg?dataurl"
  import LinkRound from "@assets/icons/link-round.svg?dataurl"
  // Installed/Enabled (from settings)
  let installed = $state<ExtensionManifest[]>([])
  let enabledIds = $state<string[]>([])

  // Discovery state
  const discoveredMap = new Map<string, ExtensionManifest>()
  let discovered = $state<ExtensionManifest[]>([])
  let loadingDiscovery = $state(false)

  // Install by URL
  let manifestUrl = $state("")
  let installing = $state(false)

  // Curated recommended
  const recommended: {name: string; url: string; description?: string}[] = [
    {name: "Huddle", url: "/extensions/huddle.json", description: "Audio/room collaboration"},
    {name: "Hello World", url: "/extensions/example.json", description: "Minimal sample"},
  ]

  let unsub: (() => void) | null = null
  let controller: AbortController | null = null

  onMount(async () => {
    unsub = extensionSettings.subscribe(s => {
      installed = Object.values(s.installed || {}) as ExtensionManifest[]
      enabledIds = s.enabled || []
    })

    // Live discovery (initial load + subscription)
    loadingDiscovery = true
    controller = new AbortController()
    try {
      const filters = [{kinds: [31990], limit: 200}]
      // Initial load
      await load({relays: INDEXER_RELAYS, filters})
      // Live updates
      request({
        relays: INDEXER_RELAYS,
        filters: [{kinds: [31990]}],
        signal: controller.signal,
        onEvent: e => {
          try {
            const m = JSON.parse(e.content)
            if (m && m.id && m.name && m.entrypoint) {
              discoveredMap.set(m.id, m as ExtensionManifest)
              discovered = Array.from(discoveredMap.values())
            }
          } catch {
            // ignore
          }
        },
      })
    } catch (e) {
      pushToast({theme: "error", message: "Failed to discover extensions"})
    } finally {
      loadingDiscovery = false
    }
  })

  onDestroy(() => {
    unsub?.()
    controller?.abort()
  })

  const toggle = (id: string, value: boolean) => {
    if (value) enableExtension(id)
    else disableExtension(id)
  }

  const onInstallByUrl = async () => {
    if (!manifestUrl) return
    installing = true
    try {
      const manifest = await installExtension(manifestUrl)
      enableExtension(manifest.id)
      pushToast({theme: "success", message: `Installed and enabled ${manifest.name}`})
      manifestUrl = ""
    } catch (e: any) {
      pushToast({theme: "error", message: e?.message || "Install failed"})
    } finally {
      installing = false
    }
  }

  const onInstallManifest = (m: ExtensionManifest) => {
    try {
      installExtensionFromManifest(m)
      enableExtension(m.id)
      pushToast({theme: "success", message: `Installed and enabled ${m.name}`})
    } catch (e: any) {
      pushToast({theme: "error", message: e?.message || "Install failed"})
    }
  }

  const onUninstall = (id: string) => {
    uninstallExtension(id)
    pushToast({theme: "info", message: "Uninstalled"})
  }
</script>

<div class="content column gap-4">
  <!-- Install by URL -->
  <div class="card2 bg-alt col-4 shadow-xl">
    <strong class="text-lg">Install by URL</strong>
    <FieldInline>
      {#snippet label()}
        <p class="flex items-center gap-3">
          <Icon icon={BoxMinimalistic} />
          Manifest URL
        </p>
      {/snippet}
      {#snippet input()}
        <label class="input input-bordered flex w-full items-center gap-2">
          <Icon icon={LinkRound} />
          <input class="grow" placeholder="https://.../manifest.json" bind:value={manifestUrl} />
        </label>
      {/snippet}
      {#snippet info()}
        <p>Paste a NIP-89 manifest URL to install an extension.</p>
      {/snippet}
    </FieldInline>
    <div class="mt-3 flex justify-end">
      <Button
        class="btn btn-primary btn-sm"
        disabled={!manifestUrl || installing}
        onclick={onInstallByUrl}>
        {installing ? "Installing..." : "Install"}
      </Button>
    </div>
  </div>

  <!-- Recommended -->
  <div class="card2 bg-alt col-4 shadow-xl">
    <strong class="text-lg">Recommended</strong>
    <div class="mt-2 flex flex-col gap-2">
      {#each recommended as r}
        <div class="row-2 justify-between">
          <div>
            <div class="font-medium">{r.name}</div>
            {#if r.description}<div class="text-xs opacity-70">{r.description}</div>{/if}
            <div class="text-xs opacity-50">{r.url}</div>
          </div>
          <Button
            class="btn btn-primary btn-sm"
            onclick={() => {
              manifestUrl = r.url
              onInstallByUrl()
            }}>Install</Button>
        </div>
      {/each}
    </div>
  </div>

  <!-- Discovered via NIP-89 -->
  <div class="card2 bg-alt col-8 shadow-xl">
    <strong class="text-lg">Discovered Extensions</strong>
    {#if loadingDiscovery}
      <p class="opacity-70">Discovering...</p>
    {:else if discovered.length === 0}
      <p class="opacity-70">No extensions discovered.</p>
    {:else}
      <div class="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
        {#each discovered as m (m.id)}
          <div class="card2 row-2 items-center justify-between p-3">
            <div>
              <div class="font-medium">{m.name}</div>
              {#if m.description}<div class="text-xs opacity-70">{m.description}</div>{/if}
              <div class="text-xs opacity-50">{m.entrypoint}</div>
            </div>
            <div class="row-2 items-center gap-3">
              {#if installed.some((i: ExtensionManifest) => i.id === m.id)}
                <label class="row-2 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    class="toggle toggle-primary"
                    checked={enabledIds.includes(m.id)}
                    onchange={e =>
                      (e.currentTarget as HTMLInputElement).checked
                        ? enableExtension(m.id)
                        : disableExtension(m.id)} />
                  <span class="opacity-70">Enabled</span>
                </label>
              {:else}
                <Button class="btn btn-primary btn-sm" onclick={() => onInstallManifest(m)}
                  >Install</Button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Installed List -->
  <div class="card2 bg-alt col-8 shadow-xl">
    <strong class="text-lg">Installed</strong>
    {#if installed.length > 0}
      <div class="flex flex-col gap-3">
        {#each installed as manifest (manifest.id)}
          <div class="row-2 items-start justify-between">
            <ExtensionCard
              {manifest}
              enabled={enabledIds.includes(manifest.id)}
              on:toggle={({detail}) => toggle(manifest.id, detail.enabled)} />
            <Button
              class="btn btn-outline btn-error btn-sm"
              onclick={() => onUninstall(manifest.id)}>Uninstall</Button>
          </div>
        {/each}
      </div>
    {:else}
      <p class="opacity-70">No extensions installed.</p>
    {/if}
  </div>
</div>
