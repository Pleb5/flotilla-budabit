<script lang="ts">
  import Button from "@lib/components/Button.svelte"
  import {graspServersStore, normalizeGraspServerUrl} from "@nostr-git/ui"
  import {CirclePlus, Trash} from "@lucide/svelte"
  import {pubkey, relaySearch} from "@welshman/app"
  import {isShareableRelayUrl, normalizeRelayUrl} from "@welshman/util"
  import {createUserGraspListEvent, normalizeUserGraspServerUrls} from "@nostr-git/core/events"
  import {postGraspServersList} from "@app/core/git-commands"
  import {
    getGraspServerRecommendationSourceLabel,
    graspServerRecommendationState,
    graspServerRecommendations,
    type GraspServerRecommendation,
  } from "@app/core/grasp"

  let newUrl = $state("")
  let isSaving = $state(false)
  let showRelayAutocomplete = $state(false)

  const activeRelayUrls = $derived.by(() =>
    ($graspServersStore || []).map(normalizeGraspServerUrl).filter(Boolean),
  )

  const recommendedRelays = $derived.by(() => {
    const selected = new Set(activeRelayUrls)

    return ($graspServerRecommendations || []).filter(recommendation => {
      const normalized = normalizeGraspServerUrl(recommendation.url)

      return normalized && !selected.has(normalized)
    })
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
      const graspServersList = {
        ...createUserGraspListEvent({services: normalizeUserGraspServerUrls(activeRelayUrls)}),
        pubkey: $pubkey!,
      }

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

  function formatCount(count: number, singular: string, plural = `${singular}s`) {
    return `${count} ${count === 1 ? singular : plural}`
  }

  function getRecommendationSourceSummary(recommendation: GraspServerRecommendation) {
    const labels = Array.from(
      new Set(recommendation.evidence.map(evidence => getGraspServerRecommendationSourceLabel(evidence.source))),
    )

    if (labels.length === 0) return "No evidence details"
    if (labels.length <= 2) return labels.join(", ")

    return `${labels.slice(0, 2).join(", ")} + ${labels.length - 2} more`
  }

  function getRecommendationEvidenceSummary(recommendation: GraspServerRecommendation) {
    const parts = [formatCount(recommendation.counts.sources, "source")]

    if (recommendation.counts.communities > 0) {
      parts.push(formatCount(recommendation.counts.communities, "community", "communities"))
    }

    if (recommendation.counts.pubkeys > 0) {
      parts.push(formatCount(recommendation.counts.pubkeys, "pubkey"))
    }

    if (recommendation.counts.fallbackSources > 0) {
      parts.push("default community fallback")
    }

    return parts.join(" | ")
  }
</script>

<div class="w-full max-w-2xl p-0 sm:p-4">
  <div class="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
    <div class="min-w-0 space-y-1">
      <h3 class="text-lg font-semibold">GRASP Servers</h3>
      <p class="text-sm opacity-75">
        Choose the GRASP relays you want to use for NIP-34 Git activity. You can remove every
        relay and leave this empty if you want.
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
        <div class="flex min-w-0 flex-wrap gap-2">
          {#each activeRelayUrls as url (url)}
            <div
              class="inline-flex max-w-full items-center gap-2 rounded-full border border-info/30 bg-info/10 px-3 py-1 text-sm">
              <span class="min-w-0 max-w-[16rem] truncate sm:max-w-[20rem]" title={url}
                >{url.replace(/^wss?:\/\//, "")}</span>
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
      <div class="mb-3 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <div>
          <p class="text-sm font-medium">Recommended relays</p>
          <p class="text-xs opacity-70">Click once to add any recommended relay.</p>
        </div>
        {#if $graspServerRecommendationState.status === "loading"}
          <span class="text-xs opacity-60">Loading community evidence...</span>
        {:else if $graspServerRecommendationState.status === "error"}
          <span class="text-xs text-warning">Recommendation sync failed</span>
        {/if}
      </div>

      <div class="space-y-2">
        {#if recommendedRelays.length === 0}
          <p class="text-sm opacity-70">
            {#if $graspServerRecommendations.length > 0}
              All recommended relays are already active.
            {:else if $graspServerRecommendationState.status === "loading"}
              Looking for recommendations from your communities and follows.
            {:else}
              No GRASP recommendations found yet.
            {/if}
          </p>
        {:else}
          {#each recommendedRelays as recommendation (recommendation.url)}
            <div
              class="flex flex-col gap-2 rounded-box border border-dashed border-base-content/25 bg-base-100/40 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div class="min-w-0 space-y-1">
                <p class="truncate text-sm font-medium" title={recommendation.url}>
                  {recommendation.url.replace(/^wss?:\/\//, "")}
                </p>
                <p class="text-xs opacity-70">
                  Evidence: {getRecommendationSourceSummary(recommendation)}
                </p>
                <p class="text-xs opacity-60">{getRecommendationEvidenceSummary(recommendation)}</p>
              </div>
              <button
                type="button"
                class="btn btn-outline btn-info btn-xs w-full justify-center sm:w-auto"
                onclick={() => void addRecommendedUrl(recommendation.url)}
                disabled={isSaving}>
                Add relay
              </button>
            </div>
          {/each}
        {/if}
      </div>
    </div>

    <div class="rounded-box bg-base-200/40 p-4">
      <p class="mb-3 text-sm font-medium">Add custom relay</p>

      <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label class="text-sm opacity-80 sm:w-24" aria-label="Add URL" for="url">Add URL</label>
        <div class="relative min-w-0 flex-1">
          <input
            id="url"
            bind:value={newUrl}
            placeholder="wss://relay.example.com"
            class="input input-bordered w-full min-w-0"
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
            <div
              class="z-10 absolute mt-1 w-full overflow-y-auto rounded-box border border-base-300 bg-base-100 shadow-xl">
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
        <Button
          class="btn btn-primary btn-sm w-full justify-center sm:w-auto"
          onclick={addUrl}
          disabled={isSaving || !newUrl.trim()}>
          <CirclePlus />Add
        </Button>
      </div>
    </div>
  </div>
</div>
