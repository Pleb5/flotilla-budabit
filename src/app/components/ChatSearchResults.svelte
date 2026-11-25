<script lang="ts">
  import type {Snippet} from "svelte"
  import {get} from "svelte/store"
  import {profilesByPubkey} from "@welshman/app"
  import Button from "@lib/components/Button.svelte"
  import LazyChatItem from "@app/components/LazyChatItem.svelte"
  import DmHistoryStatus from "@app/components/DmHistoryStatus.svelte"
  import {chatProfileRelays} from "@app/core/dm"
  import {hydratePubkeyProfiles} from "@app/core/community-state"
  import {dmHistoryState, retryDmHistory} from "@app/core/dm-sync"
  import {DM_INBOX, emptyDmHistory} from "@app/core/dm-history"
  import PeopleSearchResultItem from "@app/components/PeopleSearchResultItem.svelte"
  import {chatSearch} from "@app/core/state"
  import {peopleDiscoverySearch} from "@app/core/people-discovery-search"
  import {PEOPLE_SEARCH_DEBOUNCE_MS, PEOPLE_SEARCH_QUICK_SCAN_LIMIT} from "@app/util/people-search"

  const PEOPLE_RESULT_LIMIT = 8

  type Props = {
    term: string
    chatItemClass?: string
    peopleItemClass?: string
    showEmpty?: boolean
    empty?: Snippet
  }

  const {term, chatItemClass = "", peopleItemClass = "", showEmpty = false, empty}: Props = $props()

  let debouncedTerm = $state("")
  let shownCount = $state(30)
  const history = $derived($dmHistoryState.get(DM_INBOX) || emptyDmHistory)

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
  $effect(() => {
    void normalizedTerm
    shownCount = 30
  })
  const chats = $derived($chatSearch.searchOptions(debouncedTerm))
  const visibleChats = $derived(chats.slice(0, shownCount))
  const visibleChatPubkeys = $derived(
    Array.from(new Set(visibleChats.flatMap(chat => chat.pubkeys).filter(Boolean))),
  )
  const shownChatPubkeys = $derived(new Set(chats.map(chat => chat.id)))
  const recentConversationPubkeys = $derived($chatSearch.searchOptions("").map(chat => chat.id))
  const peopleResults = $derived.by(() =>
    normalizedTerm
      ? $peopleDiscoverySearch.searchResults(normalizedTerm, {
          recentConversationPubkeys,
          excludePubkeys: Array.from(shownChatPubkeys),
          scanLimit: PEOPLE_SEARCH_QUICK_SCAN_LIMIT,
          resultLimit: PEOPLE_RESULT_LIMIT,
        })
      : [],
  )

  $effect(() => {
    const relayHints = $chatProfileRelays
    const candidates = visibleChatPubkeys
    if (relayHints.length === 0 || candidates.length === 0) return

    const cached = get(profilesByPubkey)
    const missing = candidates.filter(pk => {
      const profile = cached.get(pk)
      return !(profile?.display_name || profile?.name || profile?.picture)
    })
    if (missing.length === 0) return

    const controller = new AbortController()
    void hydratePubkeyProfiles({
      pubkeys: missing,
      relayHints,
      signal: controller.signal,
    }).catch(() => undefined)

    return () => controller.abort()
  })
</script>

{#if chats.length > 0}
  <div class="px-6 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide opacity-60">
    Recent conversations
  </div>
  {#each visibleChats as chat (chat.id)}
    <LazyChatItem {chat} relays={$chatProfileRelays} class={chatItemClass} />
  {/each}
  {#if chats.length > shownCount}
    <Button class="btn btn-ghost btn-sm mx-4" onclick={() => (shownCount += 30)}>
      Show more conversations ({chats.length - shownCount})
    </Button>
  {/if}
{/if}

{#if normalizedTerm && peopleResults.length > 0}
  <div class="px-6 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide opacity-60">People</div>
  {#each peopleResults as result (result.pubkey)}
    <PeopleSearchResultItem {result} relays={$chatProfileRelays} class={peopleItemClass} />
  {/each}
{/if}

<DmHistoryStatus state={history} inbox retry={() => retryDmHistory()} />

{#if showEmpty && history.exhausted && chats.length === 0 && (!normalizedTerm || peopleResults.length === 0)}
  {@render empty?.()}
{/if}
