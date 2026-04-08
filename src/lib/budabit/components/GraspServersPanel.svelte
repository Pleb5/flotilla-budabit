<script lang="ts">
  import Button from "@lib/components/Button.svelte"
  import {
    DEFAULT_GRASP_SERVER_URL,
    getRecommendedGraspServerUrls,
    graspServersStore,
    normalizeGraspServerUrl,
  } from "@nostr-git/ui"
  import {CirclePlus, Trash} from "@lucide/svelte"
  import {pubkey, relaySearch} from "@welshman/app"
  import {isShareableRelayUrl, normalizeRelayUrl} from "@welshman/util"
  import {createGraspServersEvent} from "@nostr-git/core/events"
  import {postGraspServersList} from "@src/lib/budabit"

  let newUrl = $state("")
  let isSaving = $state(false)
  let showRelayAutocomplete = $state(false)

  const activeRelayUrls = $derived.by(() =>
    ($graspServersStore || []).map(normalizeGraspServerUrl).filter(Boolean),
  )

  const recommendedRelayUrls = $derived.by(() => {
    const selected = new Set(activeRelayUrls)

    return getRecommendedGraspServerUrls(activeRelayUrls).filter(url => !selected.has(url))
  })

  const normalizedNewRelayUrl = $derived.by(() => {
    try {
      return normalizeGraspServerUrl(normalizeRelayUrl(newUrl))
    } catch {
      return ""
    }
  })

  const relayAutocompleteOptions = $derived.by(() => {
    const query = newUrl.trim()
    if (!query) return []

    const selected = new Set(activeRelayUrls)
    const results = $relaySearch
      .searchValues(query)
      .map(normalizeGraspServerUrl)
      .filter(url => url && !selected.has(url))

    if (
      normalizedNewRelayUrl &&
      isShareableRelayUrl(normalizedNewRelayUrl) &&
      !selected.has(normalizedNewRelayUrl) &&
      !results.includes(normalizedNewRelayUrl)
    ) {
      return [normalizedNewRelayUrl, ...results]
    }

    return results
  })

  async function publishGraspServersList() {
    isSaving = true

    try {
      const graspServersList = createGraspServersEvent({
        pubkey: $pubkey!,
        urls: activeRelayUrls,
      })

      await postGraspServersList(graspServersList)
    } catch (error) {
      console.error("Failed to publish GRASP servers list:", error)
    } finally {
      isSaving = false
    }
  }

  async function addUrl() {
    const normalized = normalizeGraspServerUrl(newUrl)
    if (!normalized) return

    graspServersStore.push(normalized)
    newUrl = ""
    showRelayAutocomplete = false
    await publishGraspServersList()
  }

  async function addSuggestedUrl(url: string) {
    graspServersStore.push(url)
    newUrl = ""
    showRelayAutocomplete = false
    await publishGraspServersList()
  }

  async function addRecommendedUrl(url: string) {
    graspServersStore.push(url)
    await publishGraspServersList()
  }

  async function removeUrl(url: string) {
    graspServersStore.remove(url)
    await publishGraspServersList()
  }
</script>

<div class="w-full max-w-2xl p-4">
  <div class="mb-4 flex items-start justify-between gap-3">
    <div class="space-y-1">
      <h3 class="text-lg font-semibold">GRASP Servers</h3>
      <p class="text-sm opacity-75">
        New profiles start with {DEFAULT_GRASP_SERVER_URL}, but you can remove every relay and leave
        this empty if you want.
      </p>
    </div>
    {#if isSaving}
      <span class="pt-1 text-sm opacity-60">Saving...</span>
    {/if}
  </div>

  <div class="space-y-4">
    <div class="rounded-box bg-base-200/60 p-4">
      <div class="mb-3 flex items-center justify-between gap-2">
        <p class="text-sm font-medium">Active relays</p>
        <span class="text-xs opacity-60">Used for GRASP repo actions</span>
      </div>

      {#if activeRelayUrls.length === 0}
        <p class="text-sm opacity-70">No GRASP relays saved yet.</p>
      {:else}
        <div class="flex flex-wrap gap-2">
          {#each activeRelayUrls as url (url)}
            <div
              class="inline-flex items-center gap-2 rounded-full border border-info/30 bg-info/10 px-3 py-1 text-sm"
            >
              <span class="max-w-[20rem] truncate" title={url}>{url.replace(/^wss?:\/\//, "")}</span>
              <button
                type="button"
                class="text-error transition-opacity hover:opacity-80"
                onclick={() => void removeUrl(url)}
                disabled={isSaving}
                aria-label={`Remove ${url}`}>
                <Trash class="h-4 w-4" />
              </button>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <div class="rounded-box bg-base-200/40 p-4">
      <p class="mb-2 text-sm font-medium">Recommended relays</p>
      <p class="mb-3 text-xs opacity-70">Click once to add any recommended relay.</p>

      <div class="flex flex-wrap gap-2">
        {#if recommendedRelayUrls.length === 0}
          <p class="text-sm opacity-70">All recommended relays are already added.</p>
        {:else}
          {#each recommendedRelayUrls as url (url)}
            <button
              type="button"
              class="rounded-full border border-dashed border-base-content/30 px-3 py-1 text-sm transition hover:border-info hover:text-info"
              onclick={() => void addRecommendedUrl(url)}
              disabled={isSaving}>
              + {url.replace(/^wss?:\/\//, "")}
            </button>
          {/each}
        {/if}
      </div>
    </div>

    <div class="rounded-box bg-base-200/40 p-4">
      <p class="mb-3 text-sm font-medium">Add custom relay</p>

      <div class="flex items-center gap-2">
        <label class="w-24 text-sm opacity-80" aria-label="Add URL" for="url">Add URL</label>
        <div class="relative flex-1">
          <input
            id="url"
            bind:value={newUrl}
            placeholder="wss://relay.example.com"
            class="input input-bordered w-full"
            onfocus={() => (showRelayAutocomplete = relayAutocompleteOptions.length > 0)}
            oninput={() => (showRelayAutocomplete = relayAutocompleteOptions.length > 0)}
            onblur={() => {
              setTimeout(() => {
                showRelayAutocomplete = false
              }, 200)
            }}
            onkeydown={e => {
              if (e.key === "Enter") {
                e.preventDefault()
                addUrl()
              }
            }}
            disabled={isSaving} />

          {#if showRelayAutocomplete && relayAutocompleteOptions.length > 0}
            <div class="absolute z-10 mt-1 w-full overflow-y-auto rounded-box border border-base-300 bg-base-100 shadow-xl">
              {#each relayAutocompleteOptions as relayUrl (relayUrl)}
                <button
                  type="button"
                  class="block w-full px-3 py-2 text-left text-sm hover:bg-base-200"
                  onmousedown={event => event.preventDefault()}
                  onclick={() => void addSuggestedUrl(relayUrl)}>
                  {relayUrl}
                </button>
              {/each}
            </div>
          {/if}
        </div>
        <Button class="btn btn-primary btn-sm" onclick={addUrl} disabled={isSaving || !newUrl.trim()}>
          <CirclePlus />Add
        </Button>
      </div>
    </div>
  </div>
</div>
