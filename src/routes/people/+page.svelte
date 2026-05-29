<script lang="ts">
  import {onMount} from "svelte"
  import {getFollows, profileSearch, profilesByPubkey, pubkey as sessionPubkey} from "@welshman/app"
  import type {TrustedEvent} from "@welshman/util"
  import {createScroller, isMobile} from "@lib/html"
  import Magnifier from "@assets/icons/magnifier.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Page from "@lib/components/Page.svelte"
  import ContentSearch from "@lib/components/ContentSearch.svelte"
  import PeopleItem from "@app/components/PeopleItem.svelte"
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
    buildPeopleSearchResults,
    getCommunityPeoplePubkeys,
    type PeopleSearchResult,
  } from "@app/util/people-search"

  let term = $state("")
  let searchTerm = $state("")
  let lastSearchTerm = $state("")
  let limit = $state(10)
  let element: Element | undefined = $state()

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
  const peopleCandidatePubkeys = $derived(
    normalizedSearchTerm
      ? Array.from(new Set([...communityPubkeys, ...directFollowPubkeys, ...profileMatches]))
      : [],
  )
  const communityAssessments = $derived(
    normalizedSearchTerm
      ? buildCommunityTrustAssessments({
          candidatePubkeys: peopleCandidatePubkeys,
          viewerPubkey: $sessionPubkey || undefined,
          context: {scope: "global_discovery"},
          definitionEvents: communityDefinitionEvents,
          profileListEvents: communityProfileListEvents,
          reportStates: $communityMemberReportStates,
        })
      : new Map(),
  )
  const peopleResults = $derived.by(() =>
    normalizedSearchTerm
      ? buildPeopleSearchResults({
          query: normalizedSearchTerm,
          communityPubkeys,
          directFollowPubkeys,
          profileMatches,
          communityAssessments,
          getProfile: pubkey => $profilesByPubkey.get(pubkey),
          limit,
        })
      : ([] as PeopleSearchResult[]),
  )

  $effect(() => {
    const value = term
    const timeout = setTimeout(() => {
      searchTerm = value
    }, 200)

    return () => clearTimeout(timeout)
  })

  $effect(() => {
    if (searchTerm === lastSearchTerm) return
    lastSearchTerm = searchTerm
    limit = 10
  })

  onMount(() => {
    const scroller = createScroller({
      element: element!,
      onScroll: () => {
        limit += 10
      },
    })

    return () => scroller.stop()
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
      <div class="col-2 h-full" bind:this={element}>
        {#if normalizedSearchTerm}
          {#each peopleResults as result (result.pubkey)}
            <PeopleItem pubkey={result.pubkey} />
          {:else}
            <div class="col-2 m-auto max-w-md items-center py-20 text-center opacity-70">
              <Icon icon={Magnifier} size={8} />
              <p>No people found.</p>
            </div>
          {/each}
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
