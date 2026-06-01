<script lang="ts">
  import {goto} from "$app/navigation"
  import {getFollows, profileSearch, profilesByPubkey, pubkey} from "@welshman/app"
  import type {TrustedEvent} from "@welshman/util"
  import AddCircle from "@assets/icons/add-circle.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import LogIn from "@app/components/LogIn.svelte"
  import {pushToast} from "@app/util/toast"
  import {pushModal} from "@app/util/modal"
  import {normalizeRelays, parseCommunityInput} from "@app/core/community"
  import {
    DEFAULT_COMMUNITY_INPUT,
    activeCommunityDefinition,
    activeCommunitySession,
    activePreferredCommunities,
    communityAdminDefinitionEvents,
    communityMemberDefinitionEvents,
    communityMemberProfileListEvents,
    communityMemberReportStates,
    communityModeratorDefinitionEvents,
    communityModeratorProfileListEvents,
    communityPreferencesLoading,
    communityStarsLoading,
    getCommunityBootstrapRelays,
    getCommunityDefinitionRelayHints,
    hydratePreferredCommunities,
    loadCommunityEvents,
    makeCommunityDefinitionFilter,
    selectLatestCommunityDefinition,
    setActiveCommunityDefinition,
    setActiveCommunityInput,
  } from "@app/core/community-state"
  import CommunityPreviewCard from "@app/components/community/CommunityPreviewCard.svelte"
  import CommunitySelectorCard from "@app/components/community/CommunitySelectorCard.svelte"
  import {makeCommunityPath} from "@app/util/routes"
  import {makeCommunityInputValue} from "@app/util/community-stars"
  import {buildCommunityTrustAssessments} from "@app/core/community-trust"
  import {
    buildPeopleSearchCandidates,
    getCommunityPeoplePubkeys,
    PEOPLE_SEARCH_QUICK_SCAN_LIMIT,
    searchPeopleCandidates,
  } from "@app/util/people-search"

  const COMMUNITY_INPUT_SEARCH_LIMIT = 8

  type SelectorCommunity = {
    pubkey: string
    relayHints: string[]
    isCurrent: boolean
    isAdmin: boolean
    isModerator: boolean
  }

  let communityInput = $state("")
  let previewRequestId = 0
  let previewRequestKey = ""
  let previewLookupState = $state<"idle" | "loading" | "found" | "not-found">("idle")
  let defaultRequestId = 0
  let defaultRequestKey = ""
  let defaultLookupState = $state<"idle" | "loading" | "found" | "not-found">("idle")
  let loadedDefaultRelayHints = $state<string[]>([])
  let enteringCommunityKey = $state("")
  let selectorRelayHints = $state<Record<string, string[]>>({})
  let preferredHydrationKey = ""
  let preferredHydrationAttempts = 0
  const selectorRelayLoadAttempts = new Map<string, number>()
  const SELECTOR_RELAY_RETRY_MS = 30_000
  const PREFERRED_HYDRATION_MAX_ATTEMPTS = 2

  const createCommunity = () => {
    if ($pubkey) goto("/explore/create-community")
    else pushModal(LogIn)
  }

  const loadCommunityDefinition = async (communityPubkey: string, relayHints: string[]) => {
    const discoveryRelays = getCommunityBootstrapRelays(relayHints)
    const definitionEvents = await loadCommunityEvents(
      discoveryRelays,
      [makeCommunityDefinitionFilter(communityPubkey)],
      {authenticate: true},
    )

    return selectLatestCommunityDefinition(definitionEvents, communityPubkey)
  }

  const makeEnteringCommunityKey = (parsed: NonNullable<ReturnType<typeof parseCommunityInput>>) =>
    `${parsed.pubkey}:${parsed.relays.join(",")}`

  const getEnteringCommunityKey = (input: string) => {
    const parsed = parseCommunityInput(input)

    return parsed ? makeEnteringCommunityKey(parsed) : ""
  }

  const enterCommunity = async (input: string) => {
    const parsed = parseCommunityInput(input)

    if (!parsed) {
      pushToast({
        theme: "error",
        message: "Enter a valid community npub, hex pubkey, or ncommunity.",
      })
      return
    }

    if (enteringCommunityKey) return
    const requestKey = makeEnteringCommunityKey(parsed)
    enteringCommunityKey = requestKey

    try {
      const definition = await loadCommunityDefinition(parsed.pubkey, parsed.relays)

      if (!definition) {
        if (parsed.pubkey === previewPubkey) previewLookupState = "not-found"
        pushToast({theme: "error", message: "No community found"})
        return
      }

      const relayHints = getCommunityDefinitionRelayHints(definition, parsed.relays)
      const communityValue = makeCommunityInputValue({pubkey: parsed.pubkey, relayHints}) || input
      const session = setActiveCommunityInput(communityValue)

      if (!session) {
        pushToast({
          theme: "error",
          message: "Enter a valid community npub, hex pubkey, or ncommunity.",
        })
        return
      }

      setActiveCommunityDefinition(definition)
      selectorRelayHints = {...selectorRelayHints, [parsed.pubkey]: relayHints}
      await goto(makeCommunityPath(communityValue))
      communityInput = ""
    } catch (error) {
      if (parsed.pubkey === previewPubkey) previewLookupState = "not-found"
      pushToast({theme: "error", message: "No community found"})
    } finally {
      if (enteringCommunityKey === requestKey) enteringCommunityKey = ""
    }
  }

  const submitCommunityInput = () => {
    if (!communityInput.trim()) return
    enterCommunity(communityInput)
  }

  const openPreviewCommunity = () => {
    const parsed = parseCommunityInput(communityInput)
    const pubkey = parsed?.pubkey || ""
    const relayHints = previewRelayHints

    if (!pubkey) return

    enterCommunity(makeCommunityInputValue({pubkey, relayHints}) || pubkey)
  }

  const openDefaultCommunity = () => {
    if (!defaultOpenInput) return

    enterCommunity(defaultOpenInput)
  }

  const selectCommunityInputProfile = (selectedPubkey: string) => {
    const definition = selectLatestCommunityDefinition(communityDefinitionEvents, selectedPubkey)
    const relayHints = getCommunityDefinitionRelayHints(definition, [
      ...(selectorRelayHints[selectedPubkey] || []),
      ...(selectedPubkey === $activeCommunitySession?.communityPubkey ? currentRelayHints : []),
    ])

    communityInput = makeCommunityInputValue({pubkey: selectedPubkey, relayHints}) || selectedPubkey
  }

  const searchCommunityInputProfiles = (term: string) => {
    const query = term.trim()
    if (!query) return []

    const definitionEvents = communityDefinitionEvents
    const profileListEvents = communityProfileListEvents
    const candidates = buildPeopleSearchCandidates({
      query,
      communityPubkeys,
      directFollowPubkeys,
      knownPubkeys: selectorCommunities.map(community => community.pubkey),
      profileMatches: $profileSearch.searchValues(query) as string[],
    })

    return searchPeopleCandidates({
      query,
      candidates,
      getProfile: candidatePubkey => $profilesByPubkey.get(candidatePubkey),
      getCommunityAssessments: candidatePubkeys =>
        buildCommunityTrustAssessments({
          candidatePubkeys,
          viewerPubkey: $pubkey || undefined,
          context: {scope: "global_discovery"},
          definitionEvents,
          profileListEvents,
          reportStates: $communityMemberReportStates,
        }),
      scanLimit: PEOPLE_SEARCH_QUICK_SCAN_LIMIT,
      resultLimit: COMMUNITY_INPUT_SEARCH_LIMIT,
    }).results.map(result => result.pubkey)
  }

  const loadCommunityDefinitionRelays = async (communityPubkey: string, relayHints: string[]) => {
    const definition = await loadCommunityDefinition(communityPubkey, relayHints)

    if (!definition) return []

    return getCommunityDefinitionRelayHints(definition, relayHints)
  }

  const loadSelectorRelayHints = async (item: SelectorCommunity) => {
    const relays = await loadCommunityDefinitionRelays(item.pubkey, item.relayHints)
    if (relays.length > 0) {
      selectorRelayHints = {...selectorRelayHints, [item.pubkey]: relays}
    }

    return relays.length > 0
  }

  const hasCommunityInput = $derived(Boolean(communityInput.trim()))
  const previewInput = $derived(parseCommunityInput(communityInput))
  const previewPubkey = $derived(hasCommunityInput ? previewInput?.pubkey || "" : "")
  const preferredCommunities = $derived($activePreferredCommunities)
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
  const directFollowPubkeys = $derived($pubkey ? getFollows($pubkey) : [])
  const preferredCommunityByPubkey = $derived.by(
    () => new Map(preferredCommunities.map(community => [community.communityPubkey, community])),
  )
  const currentRelayHints = $derived.by(() => {
    const session = $activeCommunitySession
    if (!session) return []

    const definitionRelays =
      $activeCommunityDefinition?.pubkey === session.communityPubkey
        ? $activeCommunityDefinition.relays
        : []

    return normalizeRelays([
      ...session.communityRelayHints,
      ...(selectorRelayHints[session.communityPubkey] || []),
      ...definitionRelays,
    ])
  })
  const selectorCommunities = $derived.by((): SelectorCommunity[] => {
    const session = $activeCommunitySession
    const currentPreference = session
      ? preferredCommunityByPubkey.get(session.communityPubkey)
      : undefined
    const current = session
      ? [
          {
            pubkey: session.communityPubkey,
            relayHints: currentRelayHints,
            isCurrent: true,
            isAdmin: Boolean(currentPreference?.isAdmin),
            isModerator: Boolean(currentPreference?.isModerator),
          },
        ]
      : []
    const preferred = preferredCommunities
      .filter(community => community.communityPubkey !== session?.communityPubkey)
      .map(community => ({
        pubkey: community.communityPubkey,
        relayHints: normalizeRelays([
          ...community.relayHints,
          ...(selectorRelayHints[community.communityPubkey] || []),
        ]),
        isCurrent: false,
        isAdmin: community.isAdmin,
        isModerator: community.isModerator,
      }))

    return [...current, ...preferred]
  })
  const previewRelayHints = $derived.by(() => {
    if (!previewPubkey) return []

    return normalizeRelays([
      ...(previewInput?.relays || []),
      ...(previewPubkey === $activeCommunitySession?.communityPubkey ? currentRelayHints : []),
      ...(selectorRelayHints[previewPubkey] || []),
    ])
  })
  const previewOpenInput = $derived(
    previewPubkey
      ? makeCommunityInputValue({pubkey: previewPubkey, relayHints: previewRelayHints}) ||
          previewPubkey
      : "",
  )
  const previewOpening = $derived(
    Boolean(previewOpenInput && enteringCommunityKey === getEnteringCommunityKey(previewOpenInput)),
  )
  const previewHasCommunityDefinition = $derived(
    Boolean(
      previewPubkey &&
      ($activeCommunityDefinition?.pubkey === previewPubkey ||
        selectorRelayHints[previewPubkey]?.length),
    ),
  )
  const previewLoading = $derived(
    Boolean(previewPubkey && !previewHasCommunityDefinition && previewLookupState === "loading"),
  )
  const previewCommunityNotFound = $derived(
    Boolean(previewPubkey && !previewHasCommunityDefinition && previewLookupState === "not-found"),
  )
  const previewLabel = $derived(hasCommunityInput ? "Preview community" : "Find community")
  const previewEmptyInfo = $derived(
    hasCommunityInput
      ? "Enter a valid npub, hex pubkey, or ncommunity."
      : "Paste a community to preview it.",
  )
  const defaultCommunityInput = $derived(parseCommunityInput(DEFAULT_COMMUNITY_INPUT))
  const defaultCommunityPubkey = $derived(defaultCommunityInput?.pubkey || "")
  const defaultRelayHints = $derived.by(() => {
    if (!defaultCommunityPubkey) return []

    return normalizeRelays([
      ...(defaultCommunityInput?.relays || []),
      ...loadedDefaultRelayHints,
      ...(defaultCommunityPubkey === $activeCommunitySession?.communityPubkey
        ? currentRelayHints
        : []),
    ])
  })
  const defaultOpenInput = $derived(
    defaultCommunityPubkey
      ? makeCommunityInputValue({pubkey: defaultCommunityPubkey, relayHints: defaultRelayHints}) ||
          DEFAULT_COMMUNITY_INPUT ||
          defaultCommunityPubkey
      : "",
  )
  const defaultOpening = $derived(
    Boolean(defaultOpenInput && enteringCommunityKey === getEnteringCommunityKey(defaultOpenInput)),
  )
  const defaultHasCommunityDefinition = $derived(
    Boolean(
      defaultCommunityPubkey &&
      ($activeCommunityDefinition?.pubkey === defaultCommunityPubkey ||
        loadedDefaultRelayHints.length ||
        selectorRelayHints[defaultCommunityPubkey]?.length),
    ),
  )
  const defaultLoading = $derived(
    Boolean(
      defaultCommunityPubkey && !defaultHasCommunityDefinition && defaultLookupState === "loading",
    ),
  )
  const defaultCommunityNotFound = $derived(
    Boolean(
      defaultCommunityPubkey &&
      !defaultHasCommunityDefinition &&
      defaultLookupState === "not-found",
    ),
  )

  $effect(() => {
    const key = $pubkey ? `${$pubkey}:${currentRelayHints.join(",")}` : ""

    if (!$pubkey || !key) return

    if (preferredHydrationKey !== key) {
      preferredHydrationKey = key
      preferredHydrationAttempts = 0
    }

    if ($communityStarsLoading || $communityPreferencesLoading) return
    if (preferredCommunities.length > 0 && preferredHydrationAttempts > 0) return
    if (preferredHydrationAttempts >= PREFERRED_HYDRATION_MAX_ATTEMPTS) return

    preferredHydrationAttempts += 1
    hydratePreferredCommunities({
      relayHints: currentRelayHints,
      force: preferredHydrationAttempts > 1,
    }).catch(() => {})
  })

  $effect(() => {
    const items = selectorCommunities

    for (const item of items) {
      const key = `${item.pubkey}:${item.relayHints.join(",")}`
      const lastAttempt = selectorRelayLoadAttempts.get(key) || 0
      if (!item.pubkey || selectorRelayHints[item.pubkey]?.length) continue
      if (lastAttempt && Date.now() - lastAttempt < SELECTOR_RELAY_RETRY_MS) continue

      selectorRelayLoadAttempts.set(key, Date.now())
      loadSelectorRelayHints(item)
        .then(loaded => {
          if (!loaded) selectorRelayLoadAttempts.delete(key)
        })
        .catch(() => {
          selectorRelayLoadAttempts.delete(key)
        })
    }
  })

  $effect(() => {
    const parsed = defaultCommunityInput

    if (!parsed) {
      defaultRequestKey = ""
      defaultLookupState = "idle"
      loadedDefaultRelayHints = []
      return
    }

    const requestKey = [parsed.pubkey, ...parsed.relays].join("|")
    if (defaultRequestKey === requestKey) return

    defaultRequestKey = requestKey
    defaultLookupState = "loading"
    loadedDefaultRelayHints = []

    const requestId = ++defaultRequestId

    loadCommunityDefinitionRelays(parsed.pubkey, parsed.relays)
      .then(relays => {
        if (requestId !== defaultRequestId) return
        if (relays.length === 0) {
          defaultLookupState = "not-found"
          return
        }

        loadedDefaultRelayHints = relays
        selectorRelayHints = {...selectorRelayHints, [parsed.pubkey]: relays}
        defaultLookupState = "found"
      })
      .catch(() => {
        if (requestId === defaultRequestId) defaultLookupState = "not-found"
      })
  })

  $effect(() => {
    const parsed = previewInput
    const pubkey = previewPubkey

    if (!pubkey) {
      previewRequestKey = ""
      previewLookupState = "idle"
      return
    }

    const relayHints = parsed?.relays || $activeCommunitySession?.communityRelayHints || []
    const activeDefinitionRelays =
      !parsed || parsed.pubkey === $activeCommunitySession?.communityPubkey
        ? $activeCommunityDefinition?.relays || []
        : []
    const requestKey = [pubkey, ...relayHints, ...activeDefinitionRelays].join("|")

    if (previewRequestKey === requestKey) return
    previewRequestKey = requestKey
    previewLookupState = "loading"

    const requestId = ++previewRequestId

    loadCommunityDefinitionRelays(pubkey, [...relayHints, ...activeDefinitionRelays])
      .then(relays => {
        if (requestId !== previewRequestId) return
        if (relays.length === 0) {
          previewLookupState = "not-found"
          return
        }

        selectorRelayHints = {...selectorRelayHints, [pubkey]: relays}
        previewLookupState = "found"
      })
      .catch(() => {
        if (requestId === previewRequestId) previewLookupState = "not-found"
      })
  })
</script>

<div class="hero min-h-screen w-full min-w-0 overflow-y-auto overflow-x-hidden pb-20 sm:pb-12">
  <div class="hero-content w-full min-w-0 p-2 sm:p-4">
    <div
      class="mx-auto flex w-full max-w-6xl flex-col gap-4 px-2 py-4 sm:px-8 sm:py-8 md:px-12 md:py-12">
      <h1 class="mb-3 text-center text-3xl font-bold leading-tight sm:mb-4 sm:text-5xl">
        Explore Communities
      </h1>
      <div
        class="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(24rem,28rem)] lg:items-start">
        <div class="flex min-w-0 flex-col gap-4 lg:col-start-2 lg:row-start-1">
          <CommunityPreviewCard
            pubkey={previewPubkey}
            relayHints={previewRelayHints}
            shareRelayHints={selectorRelayHints[previewPubkey] || previewRelayHints}
            label={previewLabel}
            emptyInfo={previewEmptyInfo}
            onOpen={openPreviewCommunity}
            bind:inputValue={communityInput}
            showInput
            inputLabel="Search or paste a community"
            inputPlaceholder="Search profiles, npub1..., or ncommunity://..."
            showActions={previewHasCommunityDefinition}
            loading={previewLoading}
            opening={previewOpening}
            notFound={previewCommunityNotFound}
            inputSearch={searchCommunityInputProfiles}
            onInputSelect={selectCommunityInputProfile}
            onSubmit={submitCommunityInput} />

          {#if defaultCommunityPubkey}
            <CommunityPreviewCard
              pubkey={defaultCommunityPubkey}
              relayHints={defaultRelayHints}
              shareRelayHints={selectorRelayHints[defaultCommunityPubkey] || defaultRelayHints}
              label="Brand new? Start here:"
              emptyInfo="Start with the recommended community."
              onOpen={openDefaultCommunity}
              showActions={defaultHasCommunityDefinition}
              loading={defaultLoading}
              opening={defaultOpening}
              notFound={defaultCommunityNotFound} />
          {/if}

          <Button
            onclick={createCommunity}
            class="btn btn-neutral min-h-14 w-full items-center justify-start gap-4 rounded-box px-5 py-4 text-base sm:min-h-16 sm:px-6">
            <Icon icon={AddCircle} size={7} />
            <span class="min-w-0 truncate font-bold leading-none">Create Community</span>
          </Button>
        </div>

        {#if selectorCommunities.length > 0 || $communityStarsLoading || $communityPreferencesLoading}
          <div class="card2 card2-sm bg-alt col-3 min-w-0 shadow-md lg:col-start-1 lg:row-start-1">
            <div class="flex flex-col gap-2">
              <div class="flex items-center justify-between gap-2">
                <p class="text-xs font-semibold uppercase tracking-wide opacity-60">
                  Preferred Communities
                </p>
                {#if $communityStarsLoading || $communityPreferencesLoading}
                  <span class="loading loading-spinner loading-xs opacity-60"></span>
                {/if}
              </div>
              {#each selectorCommunities as item (item.pubkey)}
                {@const selectorInput =
                  makeCommunityInputValue({pubkey: item.pubkey, relayHints: item.relayHints}) ||
                  item.pubkey}
                <CommunitySelectorCard
                  pubkey={item.pubkey}
                  relayHints={item.relayHints}
                  shareRelayHints={selectorRelayHints[item.pubkey] || item.relayHints}
                  isCurrent={item.isCurrent}
                  isAdmin={item.isAdmin}
                  isModerator={item.isModerator}
                  loading={enteringCommunityKey === getEnteringCommunityKey(selectorInput)}
                  disabled={Boolean(enteringCommunityKey)}
                  onOpen={() => enterCommunity(selectorInput)} />
              {/each}
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>
