<script lang="ts">
  import type {Snippet} from "svelte"
  import {getFollows, profileSearch, profilesByPubkey, pubkey} from "@welshman/app"
  import type {TrustedEvent} from "@welshman/util"
  import Spinner from "@lib/components/Spinner.svelte"
  import ChatItem from "@app/components/ChatItem.svelte"
  import PeopleSearchResultItem from "@app/components/PeopleSearchResultItem.svelte"
  import {chatSearch} from "@app/core/state"
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
    PEOPLE_SEARCH_DEBOUNCE_MS,
    PEOPLE_SEARCH_QUICK_SCAN_LIMIT,
    searchPeopleCandidates,
    type PeopleSearchResult,
  } from "@app/util/people-search"

  const PEOPLE_RESULT_LIMIT = 8

  type Props = {
    term: string
    chatItemClass?: string
    peopleItemClass?: string
    showEmpty?: boolean
    loadingPromise?: Promise<unknown>
    empty?: Snippet
  }

  const {
    term,
    chatItemClass = "",
    peopleItemClass = "",
    showEmpty = false,
    loadingPromise,
    empty,
  }: Props = $props()

  let debouncedTerm = $state("")

  $effect(() => {
    const value = term
    if (!value.trim()) {
      debouncedTerm = ""
      return
    }

    const timeout = setTimeout(() => {
      debouncedTerm = value
    }, PEOPLE_SEARCH_DEBOUNCE_MS)

    return () => clearTimeout(timeout)
  })

  const normalizedTerm = $derived(debouncedTerm.trim())
  const chats = $derived($chatSearch.searchOptions(debouncedTerm))
  const shownChatPubkeys = $derived(new Set(chats.map(chat => chat.id)))
  const recentConversationPubkeys = $derived($chatSearch.searchOptions("").map(chat => chat.id))
  const profileMatches = $derived.by(() =>
    normalizedTerm ? ($profileSearch.searchValues(normalizedTerm) as string[]) : [],
  )
  const directFollowPubkeys = $derived($pubkey ? getFollows($pubkey) : [])
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
    normalizedTerm
      ? buildPeopleSearchCandidates({
          query: normalizedTerm,
          recentConversationPubkeys,
          communityPubkeys,
          directFollowPubkeys,
          profileMatches,
        })
      : [],
  )
  const peopleResults = $derived.by(() =>
    normalizedTerm
      ? searchPeopleCandidates({
          query: normalizedTerm,
          candidates: peopleSearchCandidates,
          excludePubkeys: Array.from(shownChatPubkeys),
          getProfile: pubkey => $profilesByPubkey.get(pubkey),
          getCommunityAssessments: candidatePubkeys =>
            buildCommunityTrustAssessments({
              candidatePubkeys,
              viewerPubkey: $pubkey || undefined,
              context: {scope: "global_discovery"},
              definitionEvents: communityDefinitionEvents,
              profileListEvents: communityProfileListEvents,
              reportStates: $communityMemberReportStates,
            }),
          scanLimit: PEOPLE_SEARCH_QUICK_SCAN_LIMIT,
          resultLimit: PEOPLE_RESULT_LIMIT,
        }).results
      : ([] as PeopleSearchResult[]),
  )
</script>

{#if chats.length > 0}
  <div class="px-6 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide opacity-60">
    Recent conversations
  </div>
  {#each chats as { id, pubkeys, latestMessage } (id)}
    <ChatItem {id} {pubkeys} {latestMessage} class={chatItemClass} />
  {/each}
{/if}

{#if normalizedTerm && peopleResults.length > 0}
  <div class="px-6 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide opacity-60">People</div>
  {#each peopleResults as result (result.pubkey)}
    <PeopleSearchResultItem {result} class={peopleItemClass} />
  {/each}
{/if}

{#if loadingPromise}
  {#await loadingPromise}
    <div class="border-t border-solid border-base-100 px-6 py-4 text-xs">
      <Spinner loading>Loading recent conversations...</Spinner>
    </div>
  {/await}
{/if}

{#if showEmpty && chats.length === 0 && (!normalizedTerm || peopleResults.length === 0)}
  {@render empty?.()}
{/if}
