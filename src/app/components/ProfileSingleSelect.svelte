<script lang="ts">
  import {writable} from "svelte/store"
  import type {Writable} from "svelte/store"
  import type {Instance} from "tippy.js"
  import type {TrustedEvent} from "@welshman/util"
  import {getFollows, profileSearch, profilesByPubkey, pubkey as sessionPubkey} from "@welshman/app"
  import Suggestions from "@lib/components/Suggestions.svelte"
  import CloseCircle from "@assets/icons/close-circle.svg?dataurl"
  import Magnifier from "@assets/icons/magnifier.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Tippy from "@lib/components/Tippy.svelte"
  import Button from "@lib/components/Button.svelte"
  import ProfileSuggestion from "@app/editor/ProfileSuggestion.svelte"
  import ProfileName from "@app/components/ProfileName.svelte"
  import ProfileDetail from "@app/components/ProfileDetail.svelte"
  import {pushModal} from "@app/util/modal"
  import {normalizePubkey} from "@app/core/community"
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
  import {buildPeopleSearchResults, getCommunityPeoplePubkeys} from "@app/util/people-search"

  interface Props {
    value: string
    autofocus?: boolean
    term?: Writable<string>
    relays?: string[]
  }

  let {value = $bindable(), term = writable(""), autofocus = false, relays = []}: Props = $props()

  const search = (term: string) => {
    const query = term.trim()
    if (!query) return []

    const profileMatches = $profileSearch.searchValues(query) as string[]
    const recentConversationPubkeys = $chatSearch.searchOptions("").map(chat => chat.id)
    const directFollowPubkeys = $sessionPubkey ? getFollows($sessionPubkey) : []
    const communityDefinitionEvents = [
      ...$communityAdminDefinitionEvents,
      ...$communityMemberDefinitionEvents,
      ...$communityModeratorDefinitionEvents,
    ] as TrustedEvent[]
    const communityProfileListEvents = [
      ...$communityMemberProfileListEvents,
      ...$communityModeratorProfileListEvents,
    ] as TrustedEvent[]
    const communityPubkeys = getCommunityPeoplePubkeys({
      definitionEvents: communityDefinitionEvents,
      profileListEvents: communityProfileListEvents,
    })
    const candidatePubkeys = Array.from(
      new Set([
        ...recentConversationPubkeys,
        ...communityPubkeys,
        ...directFollowPubkeys,
        ...profileMatches,
      ]),
    )
    const communityAssessments = buildCommunityTrustAssessments({
      candidatePubkeys,
      viewerPubkey: $sessionPubkey || undefined,
      context: {scope: "global_discovery"},
      definitionEvents: communityDefinitionEvents,
      profileListEvents: communityProfileListEvents,
      reportStates: $communityMemberReportStates,
    })

    return buildPeopleSearchResults({
      query,
      recentConversationPubkeys,
      communityPubkeys,
      directFollowPubkeys,
      profileMatches,
      communityAssessments,
      getProfile: pubkey => $profilesByPubkey.get(pubkey),
      limit: 8,
    }).map(result => result.pubkey)
  }

  const selectPubkey = (pubkey: string) => {
    term.set("")
    popover?.hide()
    value = pubkey
  }

  const clearSelection = () => {
    value = ""
    term.set("")
  }

  const onKeyDown = (e: Event) => {
    if (instance.onKeyDown(e)) {
      e.preventDefault()
    }
  }

  const inputDisabled = $derived(Boolean(value))

  let input: Element | undefined = $state()
  let popover: Instance | undefined = $state()
  let instance: any = $state()

  $effect(() => {
    // @ts-ignore
    oninput?.($term)

    const typedPubkey = normalizePubkey($term)
    if (typedPubkey && !inputDisabled) {
      selectPubkey(typedPubkey)
      return
    }

    if ($term && !inputDisabled) {
      popover?.show()
    } else {
      popover?.hide()
    }
  })
</script>

<div class="flex flex-col gap-2">
  <div>
    {#if value}
      {@const onClick = () => pushModal(ProfileDetail, {pubkey: value, url: relays[0], relays})}
      <div class="flex-inline badge badge-neutral mr-1 gap-1">
        <Button class="flex items-center" onclick={clearSelection}>
          <Icon icon={CloseCircle} size={4} class="-ml-1 mt-px" />
        </Button>
        <Button onclick={onClick}>
          <ProfileName pubkey={value} {relays} />
        </Button>
      </div>
    {/if}
  </div>
  <label class="input input-bordered flex min-w-0 w-full items-center gap-2" bind:this={input}>
    <Icon icon={Magnifier} />
    <!-- svelte-ignore a11y_autofocus -->
    <input
      {autofocus}
      class="min-w-0 grow"
      type="text"
      placeholder={inputDisabled ? "Recipient selected" : "Search for profiles..."}
      bind:value={$term}
      disabled={inputDisabled}
      onkeydown={onKeyDown} />
  </label>
  <Tippy
    bind:popover
    bind:instance
    component={Suggestions}
    props={{
      term,
      search,
      select: selectPubkey,
      component: ProfileSuggestion,
      class: "rounded-box",
      style: `left: 4px; width: ${input?.clientWidth + 12}px`,
    }}
    params={{
      trigger: "manual",
      interactive: true,
      maxWidth: "none",
      getReferenceClientRect: () => input!.getBoundingClientRect(),
    }} />
</div>
