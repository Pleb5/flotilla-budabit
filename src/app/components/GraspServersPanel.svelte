<script lang="ts">
  import Button from "@lib/components/Button.svelte"
  import InlinePopover from "@lib/components/InlinePopover.svelte"
  import {graspServersStore, normalizeGraspServerUrl} from "@nostr-git/ui"
  import {CirclePlus, Trash} from "@lucide/svelte"
  import {pubkey, relaySearch} from "@welshman/app"
  import {displayRelayUrl, isShareableRelayUrl, normalizeRelayUrl} from "@welshman/util"
  import {createUserGraspListEvent, normalizeUserGraspServerUrls} from "@nostr-git/core/events"
  import {postGraspServersList} from "@app/core/git-commands"
  import {
    getGraspServerRecommendationSourceLabel,
    graspServerRecommendationState,
    graspServerRecommendations,
    type GraspServerRecommendation,
    type GraspServerRecommendationEvidence,
    type GraspServerRecommendationSourceKind,
  } from "@app/core/grasp"
  import ProfileCircle from "@app/components/ProfileCircle.svelte"
  import ProfileDetail from "@app/components/ProfileDetail.svelte"
  import ProfileName from "@app/components/ProfileName.svelte"
  import {pushModal} from "@app/util/modal"

  type RecommendationEvidenceGroupKind = "own" | "community" | "moderator" | "member" | "follow"

  type RecommendationEvidenceGroup = {
    kind: RecommendationEvidenceGroupKind
    label: string
    evidence: GraspServerRecommendationEvidence[]
  }

  let newUrl = $state("")
  let isSaving = $state(false)
  let showRelayAutocomplete = $state(false)
  let openRecommendationEvidenceKey = $state("")

  const communityEvidenceSources = new Set<GraspServerRecommendationSourceKind>([
    "community_grasp",
    "starred_community_grasp",
    "default_community_fallback",
  ])

  const activeRelayUrls = $derived.by(() =>
    ($graspServersStore || []).map(normalizeGraspServerUrl).filter(Boolean),
  )

  const recommendedRelays = $derived(($graspServerRecommendations || []).filter(item => item.url))

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

  const openProfile = (profilePubkey: string) => {
    if (!profilePubkey) return

    openRecommendationEvidenceKey = ""
    pushModal(ProfileDetail, {pubkey: profilePubkey})
  }

  function countLabel(count: number, singular: string, plural = `${singular}s`) {
    return `${count} ${count === 1 ? singular : plural}`
  }

  const uniqueBy = <T,>(items: T[], getKey: (item: T) => string) => {
    const byKey = new Map<string, T>()

    for (const item of items) {
      const key = getKey(item)
      if (key && !byKey.has(key)) byKey.set(key, item)
    }

    return Array.from(byKey.values())
  }

  const getRecommendationEvidenceKey = (evidence: GraspServerRecommendationEvidence) =>
    `${evidence.source}:${evidence.pubkey || ""}:${evidence.communityPubkey || ""}`

  function getRecommendationEvidenceGroups(
    recommendation: GraspServerRecommendation,
  ): RecommendationEvidenceGroup[] {
    const groups: RecommendationEvidenceGroup[] = []
    const ownEvidence = recommendation.evidence.filter(item => item.source === "own_grasp")
    const communityEvidence = uniqueBy(
      recommendation.evidence.filter(item => communityEvidenceSources.has(item.source)),
      item => item.communityPubkey || item.pubkey || item.source,
    )
    const moderatorEvidence = uniqueBy(
      recommendation.evidence.filter(item => item.source === "moderator_grasp"),
      item => `${item.pubkey || ""}:${item.communityPubkey || ""}`,
    )
    const memberEvidence = uniqueBy(
      recommendation.evidence.filter(item => item.source === "member_grasp"),
      item => `${item.pubkey || ""}:${item.communityPubkey || ""}`,
    )
    const followEvidence = uniqueBy(
      recommendation.evidence.filter(item => item.source === "follow_grasp"),
      item => item.pubkey || "",
    )

    if (ownEvidence.length > 0) {
      groups.push({kind: "own", label: "Your GRASP list", evidence: ownEvidence})
    }
    if (communityEvidence.length > 0) {
      groups.push({
        kind: "community",
        label: countLabel(communityEvidence.length, "Community", "Communities"),
        evidence: communityEvidence,
      })
    }
    if (moderatorEvidence.length > 0) {
      groups.push({
        kind: "moderator",
        label: countLabel(moderatorEvidence.length, "Moderator"),
        evidence: moderatorEvidence,
      })
    }
    if (memberEvidence.length > 0) {
      groups.push({
        kind: "member",
        label: countLabel(memberEvidence.length, "Member"),
        evidence: memberEvidence,
      })
    }
    if (followEvidence.length > 0) {
      groups.push({
        kind: "follow",
        label: countLabel(followEvidence.length, "Follow"),
        evidence: followEvidence,
      })
    }

    return groups
  }

  const getRecommendationEvidenceProfilePubkey = (evidence: GraspServerRecommendationEvidence) =>
    communityEvidenceSources.has(evidence.source)
      ? evidence.communityPubkey || evidence.pubkey || ""
      : evidence.pubkey || evidence.communityPubkey || ""

  const getRecommendationEvidenceCommunityPubkey = (evidence: GraspServerRecommendationEvidence) => {
    const profilePubkey = getRecommendationEvidenceProfilePubkey(evidence)

    return evidence.communityPubkey && evidence.communityPubkey !== profilePubkey
      ? evidence.communityPubkey
      : ""
  }

  function getRecommendationEvidenceRoleLabel(evidence: GraspServerRecommendationEvidence) {
    if (evidence.source === "own_grasp") return "From your GRASP server list"
    if (evidence.source === "follow_grasp") return "You follow this person"
    if (evidence.source === "default_community_fallback") return "Default community fallback"

    return getGraspServerRecommendationSourceLabel(evidence.source)
  }

  const getRecommendationGroupPopoverKey = (
    recommendation: GraspServerRecommendation,
    group: RecommendationEvidenceGroup,
  ) => `${recommendation.url}:${group.kind}`

  const isRecommendationConfigured = (recommendation: GraspServerRecommendation) =>
    activeRelayUrls.includes(normalizeGraspServerUrl(recommendation.url))

  const displayGraspRelayUrl = (url: string) => displayRelayUrl(normalizeGraspServerUrl(url) || url)
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
      <div class="mb-3 flex items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="text-xs font-semibold uppercase tracking-wide opacity-60">Recommended GRASP relays</p>
        </div>
        {#if $graspServerRecommendationState.status === "loading"}
          <span class="loading loading-spinner loading-xs shrink-0 opacity-60"></span>
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
            {@const evidenceGroups = getRecommendationEvidenceGroups(recommendation)}
            {@const configured = isRecommendationConfigured(recommendation)}
            <div class="rounded-box border border-base-300 bg-base-100/60 p-3">
              <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div class="min-w-0">
                  <div class="flex min-w-0 flex-wrap items-center gap-2">
                    <p class="ellipsize font-medium" title={recommendation.url}>
                      {displayGraspRelayUrl(recommendation.url)}
                    </p>
                    {#if configured}
                      <span class="badge badge-success badge-sm">Configured</span>
                    {/if}
                  </div>
                  <p class="mt-1 text-xs opacity-70">Community and GRASP-list signals</p>
                </div>

                {#if configured}
                  <span class="badge badge-success shrink-0 self-start">Already added</span>
                {:else}
                  <Button
                    class="btn btn-outline btn-sm shrink-0"
                    onclick={() => void addRecommendedUrl(recommendation.url)}
                    disabled={isSaving}>
                    <CirclePlus class="h-4 w-4" />
                    Add
                  </Button>
                {/if}
              </div>

              <div class="mt-3 flex flex-wrap gap-1.5">
                {#each evidenceGroups as group (group.kind)}
                  {@const popoverKey = getRecommendationGroupPopoverKey(recommendation, group)}
                  <div class="relative">
                    <button
                      type="button"
                      class="badge cursor-pointer border border-base-content/15 bg-base-200 font-medium text-base-content/80 hover:bg-base-300"
                      class:bg-base-300={openRecommendationEvidenceKey === popoverKey}
                      aria-expanded={openRecommendationEvidenceKey === popoverKey}
                      onclick={() =>
                        (openRecommendationEvidenceKey =
                          openRecommendationEvidenceKey === popoverKey ? "" : popoverKey)}>
                      {group.label}
                    </button>

                    {#if openRecommendationEvidenceKey === popoverKey}
                      <InlinePopover
                        align="left"
                        widthClass="w-80 sm:w-96"
                        onClose={() => (openRecommendationEvidenceKey = "")}>
                        <div class="flex min-w-0 flex-col gap-3 text-sm">
                          <div>
                            <p class="text-xs font-semibold uppercase tracking-wide opacity-60">
                              {group.label}
                            </p>
                            <p class="mt-1 break-all font-mono text-[11px] opacity-60">
                              {displayGraspRelayUrl(recommendation.url)}
                            </p>
                          </div>

                          <div class="flex flex-col gap-2">
                            {#each group.evidence as source (getRecommendationEvidenceKey(source))}
                              {@const profilePubkey = getRecommendationEvidenceProfilePubkey(source)}
                              {@const communityPubkey = getRecommendationEvidenceCommunityPubkey(source)}
                              {@const roleLabel = getRecommendationEvidenceRoleLabel(source)}
                              {@const sourceLabel = getGraspServerRecommendationSourceLabel(source.source)}
                              <div class="rounded-box bg-base-200/60 p-3">
                                <div class="flex min-w-0 items-center gap-2">
                                  {#if profilePubkey}
                                    <button
                                      type="button"
                                      class="shrink-0"
                                      aria-label="Open profile"
                                      onclick={() => openProfile(profilePubkey)}>
                                      <ProfileCircle pubkey={profilePubkey} size={7} />
                                    </button>
                                  {/if}
                                  <div class="min-w-0 flex-1">
                                    {#if profilePubkey}
                                      <button
                                        type="button"
                                        class="max-w-full truncate text-sm font-medium hover:underline"
                                        onclick={() => openProfile(profilePubkey)}>
                                        <ProfileName pubkey={profilePubkey} />
                                      </button>
                                    {:else}
                                      <p class="truncate text-sm font-medium">{sourceLabel}</p>
                                    {/if}
                                    <div class="text-xs opacity-70">{roleLabel}</div>
                                    {#if communityPubkey}
                                      <button
                                        type="button"
                                        class="max-w-full truncate text-left text-[11px] opacity-60 hover:underline"
                                        onclick={() => openProfile(communityPubkey)}>
                                        in <ProfileName pubkey={communityPubkey} />
                                      </button>
                                    {/if}
                                  </div>
                                </div>
                              </div>
                            {/each}
                          </div>
                        </div>
                      </InlinePopover>
                    {/if}
                  </div>
                {/each}
              </div>
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
