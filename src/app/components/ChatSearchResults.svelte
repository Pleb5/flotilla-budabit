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
    buildPeopleSearchResults,
    getCommunityPeoplePubkeys,
    type PeopleSearchResult,
  } from "@app/util/people-search"

  const SEARCH_DEBOUNCE_MS = 200

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
    const timeout = setTimeout(() => {
      debouncedTerm = value
    }, SEARCH_DEBOUNCE_MS)

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
  const peopleCandidatePubkeys = $derived(
    normalizedTerm
      ? Array.from(
          new Set([
            ...recentConversationPubkeys,
            ...communityPubkeys,
            ...directFollowPubkeys,
            ...profileMatches,
          ]),
        )
      : [],
  )
  const communityAssessments = $derived(
    normalizedTerm
      ? buildCommunityTrustAssessments({
          candidatePubkeys: peopleCandidatePubkeys,
          viewerPubkey: $pubkey || undefined,
          context: {scope: "global_discovery"},
          definitionEvents: communityDefinitionEvents,
          profileListEvents: communityProfileListEvents,
          reportStates: $communityMemberReportStates,
        })
      : new Map(),
  )
  const peopleResults = $derived.by(() =>
    normalizedTerm
      ? buildPeopleSearchResults({
          query: normalizedTerm,
          recentConversationPubkeys,
          communityPubkeys,
          directFollowPubkeys,
          profileMatches,
          excludePubkeys: Array.from(shownChatPubkeys),
          communityAssessments,
          getProfile: pubkey => $profilesByPubkey.get(pubkey),
          limit: 8,
        })
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
