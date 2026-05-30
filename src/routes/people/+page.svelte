<script lang="ts">
  import {untrack} from "svelte"
  import {getFollows, profileSearch, profilesByPubkey, pubkey as sessionPubkey} from "@welshman/app"
  import type {TrustedEvent} from "@welshman/util"
  import {isMobile} from "@lib/html"
  import Magnifier from "@assets/icons/magnifier.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Page from "@lib/components/Page.svelte"
  import ContentSearch from "@lib/components/ContentSearch.svelte"
  import PeopleItem from "@app/components/PeopleItem.svelte"
  import type {TrustAssessment} from "@app/core/trust-assessment"
  import {
    communityAdminDefinitionEvents,
    communityMemberDefinitionEvents,
    communityMemberProfileListEvents,
    communityMemberReportStates,
    communityModeratorDefinitionEvents,
    communityModeratorProfileListEvents,
  } from "@app/core/community-state"
  import {buildCommunityTrustAssessments} from "@app/core/community-trust"
  import {
    buildPeopleSearchCandidates,
    getCommunityPeoplePubkeys,
    mergePeopleSearchResults,
    PEOPLE_SEARCH_DEBOUNCE_MS,
    PEOPLE_SEARCH_PAGE_SIZE,
    PEOPLE_SEARCH_QUICK_SCAN_LIMIT,
    PEOPLE_SEARCH_SCAN_CHUNK_SIZE,
    searchPeopleCandidates,
    type PeopleSearchProfile,
    type PeopleSearchResult,
  } from "@app/util/people-search"

  let term = $state("")
  let searchTerm = $state("")
  let visibleLimit = $state(PEOPLE_SEARCH_PAGE_SIZE)
  let searchCursor = $state(0)
  let searchedCandidateCount = $state(0)
  let totalCandidateCount = $state(0)
  let peopleSearchLoading = $state(false)
  let peopleSearchExhausted = $state(true)
  let peopleSearchResults = $state<PeopleSearchResult[]>([])
  let activeSearchSession: {
    query: string
    candidates: ReturnType<typeof buildPeopleSearchCandidates>
    getProfile: (pubkey: string) => PeopleSearchProfile | null | undefined
    getCommunityAssessments: (pubkeys: string[]) => Map<string, TrustAssessment>
  } | null = null

  const normalizedSearchTerm = $derived(searchTerm.trim())
  const profileMatches = $derived.by(() =>
    normalizedSearchTerm ? ($profileSearch.searchValues(normalizedSearchTerm) as string[]) : [],
  )
  const directFollowPubkeys = $derived($sessionPubkey ? getFollows($sessionPubkey) : [])
  const communityDefinitionEvents = $derived([
    ...$communityAdminDefinitionEvents,
    ...$communityMemberDefinitionEvents,
    ...$communityModeratorDefinitionEvents,
  ] as TrustedEvent[])
  const communityProfileListEvents = $derived([
    ...$communityMemberProfileListEvents,
    ...$communityModeratorProfileListEvents,
  ] as TrustedEvent[])
  const communityPubkeys = $derived(
    getCommunityPeoplePubkeys({
      definitionEvents: communityDefinitionEvents,
      profileListEvents: communityProfileListEvents,
    }),
  )
  const peopleSearchCandidates = $derived(
    normalizedSearchTerm
      ? buildPeopleSearchCandidates({
          query: normalizedSearchTerm,
          communityPubkeys,
          directFollowPubkeys,
          profileMatches,
        })
      : [],
  )
  const peopleResults = $derived(peopleSearchResults.slice(0, visibleLimit))
  const hasMorePeopleResults = $derived(
    Boolean(
      normalizedSearchTerm &&
      (peopleSearchResults.length > peopleResults.length || !peopleSearchExhausted),
    ),
  )
  const peopleSearchStatus = $derived(
    normalizedSearchTerm && totalCandidateCount > 0
      ? `Searched ${Math.min(searchedCandidateCount, totalCandidateCount)}/${totalCandidateCount} candidates${peopleSearchExhausted ? "." : "; more available."}`
      : "",
  )

  const yieldToUi = () => new Promise(resolve => setTimeout(resolve, 0))

  const scanPeopleSearch = async (
    targetLimit: number,
    maxCandidatesToScan = PEOPLE_SEARCH_QUICK_SCAN_LIMIT,
  ) => {
    const session = activeSearchSession
    if (!session || peopleSearchLoading || peopleSearchExhausted) return

    peopleSearchLoading = true
    let scannedThisRun = 0

    try {
      while (
        activeSearchSession === session &&
        peopleSearchResults.length < targetLimit &&
        !peopleSearchExhausted &&
        scannedThisRun < maxCandidatesToScan
      ) {
        const remainingScanBudget = maxCandidatesToScan - scannedThisRun
        const batch = searchPeopleCandidates({
          query: session.query,
          candidates: session.candidates,
          cursor: searchCursor,
          scanLimit: Math.min(PEOPLE_SEARCH_SCAN_CHUNK_SIZE, remainingScanBudget),
          getProfile: session.getProfile,
          getCommunityAssessments: session.getCommunityAssessments,
        })

        if (activeSearchSession !== session) return

        searchCursor = batch.cursor
        searchedCandidateCount = batch.cursor
        totalCandidateCount = batch.totalCandidates
        peopleSearchExhausted = !batch.hasMore
        peopleSearchResults = mergePeopleSearchResults(peopleSearchResults, batch.results)
        scannedThisRun += batch.searchedCandidates

        if (peopleSearchResults.length >= targetLimit || !batch.hasMore) break

        await yieldToUi()
      }
    } finally {
      if (activeSearchSession === session) {
        peopleSearchLoading = false
      }
    }
  }

  const loadMorePeopleResults = () => {
    const nextLimit = visibleLimit + PEOPLE_SEARCH_PAGE_SIZE
    visibleLimit = nextLimit
    void scanPeopleSearch(nextLimit, PEOPLE_SEARCH_QUICK_SCAN_LIMIT)
  }

  $effect(() => {
    const value = term
    if (!value.trim()) {
      searchTerm = ""
      return
    }

    const timeout = setTimeout(() => {
      searchTerm = value
    }, PEOPLE_SEARCH_DEBOUNCE_MS)

    return () => clearTimeout(timeout)
  })

  $effect(() => {
    const query = normalizedSearchTerm
    const candidates = peopleSearchCandidates
    const viewerPubkey = $sessionPubkey || undefined
    const definitionEvents = communityDefinitionEvents
    const profileListEvents = communityProfileListEvents
    const reportStates = $communityMemberReportStates
    const profiles = $profilesByPubkey
    const communityAssessmentCache = new Map<string, TrustAssessment>()

    visibleLimit = PEOPLE_SEARCH_PAGE_SIZE
    searchCursor = 0
    searchedCandidateCount = 0
    totalCandidateCount = candidates.length
    peopleSearchLoading = false
    peopleSearchExhausted = !query || candidates.length === 0
    peopleSearchResults = []

    if (!query) {
      activeSearchSession = null
      return
    }

    const getCommunityAssessments = (pubkeys: string[]) => {
      const missingPubkeys = pubkeys.filter(pubkey => !communityAssessmentCache.has(pubkey))

      if (missingPubkeys.length > 0) {
        const assessments = buildCommunityTrustAssessments({
          candidatePubkeys: missingPubkeys,
          viewerPubkey,
          context: {scope: "global_discovery"},
          definitionEvents,
          profileListEvents,
          reportStates,
        })

        for (const [pubkey, assessment] of assessments) {
          communityAssessmentCache.set(pubkey, assessment)
        }
      }

      return new Map(
        pubkeys.flatMap(pubkey => {
          const assessment = communityAssessmentCache.get(pubkey)
          return assessment ? ([[pubkey, assessment]] as Array<[string, TrustAssessment]>) : []
        }),
      )
    }

    activeSearchSession = {
      query,
      candidates,
      getProfile: pubkey => profiles.get(pubkey),
      getCommunityAssessments,
    }

    untrack(() => void scanPeopleSearch(PEOPLE_SEARCH_PAGE_SIZE))
  })
</script>

<Page class="cw-full">
  <ContentSearch>
    {#snippet input()}
      <label class="row-2 input input-bordered">
        <Icon icon={Magnifier} />
        <!-- svelte-ignore a11y_autofocus -->
        <input
          autofocus={!isMobile}
          bind:value={term}
          class="grow"
          type="text"
          placeholder="Search for people..." />
      </label>
    {/snippet}
    {#snippet content()}
      <div class="col-2 h-full">
        {#if normalizedSearchTerm}
          {#if peopleResults.length > 0}
            {#each peopleResults as result (result.pubkey)}
              <PeopleItem pubkey={result.pubkey} />
            {/each}
          {:else if peopleSearchLoading}
            <div class="col-2 m-auto max-w-md items-center py-20 text-center opacity-70">
              <Icon icon={Magnifier} size={8} />
              <p>Searching people...</p>
            </div>
          {:else if peopleSearchExhausted}
            <div class="col-2 m-auto max-w-md items-center py-20 text-center opacity-70">
              <Icon icon={Magnifier} size={8} />
              <p>No people found.</p>
            </div>
          {:else}
            <div class="col-2 m-auto max-w-md items-center py-20 text-center opacity-70">
              <Icon icon={Magnifier} size={8} />
              <p>No matches in the first candidates searched.</p>
              <p class="text-xs">Load more to continue searching.</p>
            </div>
          {/if}
          {#if hasMorePeopleResults}
            <div class="col-2 items-center py-4">
              <button
                type="button"
                class="btn btn-outline btn-sm"
                disabled={peopleSearchLoading}
                onclick={loadMorePeopleResults}>
                {peopleSearchLoading ? "Searching..." : "Load more results"}
              </button>
              {#if peopleSearchStatus}
                <p class="text-xs opacity-60">{peopleSearchStatus}</p>
              {/if}
            </div>
          {:else if peopleSearchStatus && peopleResults.length > 0}
            <p class="py-3 text-center text-xs opacity-60">{peopleSearchStatus}</p>
          {/if}
        {:else}
          <div class="col-2 m-auto max-w-md items-center py-20 text-center opacity-70">
            <Icon icon={Magnifier} size={8} />
            <p>Search for people by name, NIP-05, npub, or pubkey.</p>
          </div>
        {/if}
      </div>
    {/snippet}
  </ContentSearch>
</Page>
