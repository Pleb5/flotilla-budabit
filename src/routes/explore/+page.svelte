<script lang="ts">
  import {onMount, tick} from "svelte"
  import {goto} from "$app/navigation"
  import {loadUserRelayList, pubkey, userRelayList} from "@welshman/app"
  import {getRelaysFromList, type TrustedEvent} from "@welshman/util"
  import AddCircle from "@assets/icons/add-circle.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import LogIn from "@app/components/LogIn.svelte"
  import {pushToast} from "@app/util/toast"
  import {pushModal} from "@app/util/modal"
  import {
    normalizeRelays,
    parseCommunityDefinition,
    parseCommunityNaddr,
    type CommunityDefinition,
    type CommunityPointer,
  } from "@app/core/community"
  import {
    DEFAULT_COMMUNITY_POINTER,
    activeExactCommunityDefinition,
    activeExactCommunityPointer,
    activeExactCommunityRelays,
    activePreferredCommunities,
    communityAdminDefinitionEvents,
    communityMemberDefinitionEvents,
    communityModeratorDefinitionEvents,
    communityPreferencesLoading,
    communityStarsLoading,
    hydrateCommunityPreferences,
    hydratePreferredCommunityList,
    loadCommunityDefinitionWithOutboxFallback,
    setActiveExactCommunityDefinition,
    setActiveExactCommunityPointer,
  } from "@app/core/community-state"
  import {
    getCommunitySearchAutoSubmitDelay,
    searchCommunities,
  } from "@app/core/community-discovery-search"
  import CommunityPreviewCard from "@app/components/community/CommunityPreviewCard.svelte"
  import CommunitySelectorCard from "@app/components/community/CommunitySelectorCard.svelte"
  import {makeExactCommunityPath} from "@app/util/routes"

  type SelectorCommunity = {
    community: CommunityPointer
    definition?: CommunityDefinition
    relayHints: string[]
    publishRelayHints: string[]
    isCurrent: boolean
    isAdmin: boolean
    isModerator: boolean
    isMember: boolean
  }

  let communitySearchInput = $state("")
  let communityInput = $state("")
  let previewDefinition = $state<CommunityDefinition>()
  let defaultDefinition = $state<CommunityDefinition>()
  let previewLookupState = $state<"idle" | "loading" | "found" | "not-found" | "unavailable">(
    "idle",
  )
  let defaultLookupState = $state<"idle" | "loading" | "found" | "not-found" | "unavailable">(
    "idle",
  )
  let enteringCommunityKey = $state("")
  let enteringSelectorCommunities = $state<SelectorCommunity[]>([])
  let preferredHydrationKey = ""
  let preferredHydrationLoadingKey = $state("")
  let preferredFullHydrationKey = ""
  let preferredFullHydrationTimer: ReturnType<typeof setTimeout> | undefined
  let exploreBackgroundHydrationReady = $state(false)
  let searchRequestId = 0
  let activeSearchInput = ""
  let automaticallySubmittedInput = ""

  const login = () => pushModal(LogIn)
  const createCommunity = () => ($pubkey ? goto("/explore/create-community") : login())
  const loadUserRelayListWithTimeout = async () => {
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        loadUserRelayList(),
        new Promise<void>(resolve => {
          timeout = setTimeout(resolve, 3_000)
        }),
      ])
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }
  const waitForPostPaintHydration = async () => {
    await tick()
    if (typeof requestAnimationFrame !== "function") return
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  }
  const parseDefinitions = (events: TrustedEvent[]) =>
    events.flatMap(event => {
      const definition = parseCommunityDefinition(event)
      return definition ? [definition] : []
    })

  const communityDefinitions = $derived.by(() => {
    const definitions = parseDefinitions([
      ...$communityAdminDefinitionEvents,
      ...$communityMemberDefinitionEvents,
      ...$communityModeratorDefinitionEvents,
    ])
    if ($activeExactCommunityDefinition) definitions.push($activeExactCommunityDefinition)
    return Array.from(new Map(definitions.map(item => [item.pointer.address, item])).values())
  })
  const definitionByAddress = $derived(
    new Map(communityDefinitions.map(item => [item.pointer.address, item])),
  )
  const preferredByAddress = $derived(
    new Map($activePreferredCommunities.map(item => [item.pointer.address, item])),
  )
  const currentRelayHints = $derived(normalizeRelays($activeExactCommunityRelays))
  const userRelayHints = $derived(normalizeRelays(getRelaysFromList($userRelayList)))
  const preferredHydrationRelayHints = $derived(
    normalizeRelays([...currentRelayHints, ...userRelayHints]),
  )

  const loadDefinition = async (community: CommunityPointer) =>
    definitionByAddress.get(community.address) ||
    (await loadCommunityDefinitionWithOutboxFallback(community, {
      relayHints: community.relayHints,
    }))

  const enterCommunity = async (community: CommunityPointer) => {
    if (enteringCommunityKey) return
    enteringSelectorCommunities = [...selectorCommunities]
    enteringCommunityKey = community.address
    try {
      const definition = await loadDefinition(community)
      if (!definition) throw new Error("Community definition unavailable")
      setActiveExactCommunityPointer(definition.pointer)
      setActiveExactCommunityDefinition(definition)
      await goto(makeExactCommunityPath(definition.pointer))
      communitySearchInput = ""
      communityInput = ""
    } catch {
      pushToast({theme: "error", message: "Community unavailable. Try again."})
      if (enteringCommunityKey === community.address) {
        enteringCommunityKey = ""
        enteringSelectorCommunities = []
      }
    }
  }

  const submitCommunityInput = async (value = communitySearchInput) => {
    const input = value.trim()
    if (!input || (previewLookupState === "loading" && activeSearchInput === input)) return
    communityInput = input
    automaticallySubmittedInput = input
    activeSearchInput = input
    previewLookupState = "loading"
    previewDefinition = undefined
    const requestId = ++searchRequestId
    try {
      const batch = await searchCommunities(input, {
        bootstrapRelays: normalizeRelays([
          ...preferredHydrationRelayHints,
          ...(DEFAULT_COMMUNITY_POINTER?.relayHints || []),
        ]),
        preferredAddresses: $activePreferredCommunities.map(item => item.pointer.address),
      })
      if (requestId !== searchRequestId) return
      previewDefinition = batch.results[0]?.definition
      previewLookupState = previewDefinition ? "found" : "not-found"
    } catch {
      if (requestId === searchRequestId) previewLookupState = "unavailable"
    } finally {
      if (requestId === searchRequestId) activeSearchInput = ""
    }
  }

  const searchCommunityInputProfiles = (term: string) => {
    const query = term.trim().toLowerCase()
    if (!query || parseCommunityNaddr(query)) return []
    return communityDefinitions
      .filter(
        item =>
          item.metadata.name.toLowerCase().includes(query) ||
          item.metadata.description?.toLowerCase().includes(query),
      )
      .slice(0, 8)
      .map(item => item.pointer.naddr)
  }
  const selectCommunityInputProfile = (value: string) => {
    communitySearchInput = value
    communityInput = value
    void submitCommunityInput(value)
  }
  const previewCommunity = $derived(
    previewDefinition?.pointer || parseCommunityNaddr(communityInput),
  )
  const previewRelayHints = $derived(
    normalizeRelays(previewDefinition?.relays || previewCommunity?.relayHints || []),
  )
  const previewPublishRelayHints = $derived(normalizeRelays(previewDefinition?.relays || []))
  const previewOpening = $derived(
    Boolean(previewCommunity && enteringCommunityKey === previewCommunity.address),
  )
  const previewHasCommunityDefinition = $derived(Boolean(previewDefinition))
  const previewLoading = $derived(previewLookupState === "loading")
  const previewCommunityNotFound = $derived(previewLookupState === "not-found")
  const previewCommunityUnavailable = $derived(previewLookupState === "unavailable")
  const previewLabel = $derived(communityInput ? "Preview community" : "Find community")
  const previewEmptyInfo = $derived(
    communityInput ? "No exact community selected." : "Search for a community to preview it.",
  )
  const openPreviewCommunity = () => {
    if (previewCommunity) void enterCommunity(previewCommunity)
  }
  const defaultCommunity = $derived(defaultDefinition?.pointer || DEFAULT_COMMUNITY_POINTER)
  const defaultRelayHints = $derived(
    normalizeRelays(defaultDefinition?.relays || DEFAULT_COMMUNITY_POINTER?.relayHints || []),
  )
  const defaultPublishRelayHints = $derived(normalizeRelays(defaultDefinition?.relays || []))
  const defaultOpening = $derived(
    Boolean(defaultCommunity && enteringCommunityKey === defaultCommunity.address),
  )
  const defaultHasCommunityDefinition = $derived(Boolean(defaultDefinition))
  const defaultLoading = $derived(defaultLookupState === "loading")
  const defaultCommunityNotFound = $derived(defaultLookupState === "not-found")
  const defaultCommunityUnavailable = $derived(defaultLookupState === "unavailable")
  const preferredCommunitiesLoading = $derived(
    Boolean(preferredHydrationLoadingKey) || $communityStarsLoading || $communityPreferencesLoading,
  )
  const selectorCommunities = $derived.by((): SelectorCommunity[] => {
    const current = $activeExactCommunityPointer
    const pointers = [
      ...(current ? [current] : []),
      ...$activePreferredCommunities
        .map(item => item.pointer)
        .filter(item => item.address !== current?.address),
    ]
    return pointers.map(community => {
      const preferred = preferredByAddress.get(community.address)
      const definition = definitionByAddress.get(community.address)
      return {
        community,
        definition,
        relayHints: normalizeRelays([
          ...community.relayHints,
          ...(definition?.relays || []),
          ...(community.address === current?.address ? currentRelayHints : []),
        ]),
        publishRelayHints: normalizeRelays(definition?.relays || []),
        isCurrent: community.address === current?.address,
        isAdmin: Boolean(preferred?.isAdmin),
        isModerator: Boolean(preferred?.isModerator),
        isMember: Boolean(preferred?.isMember),
      }
    })
  })
  const displayedSelectorCommunities = $derived(
    enteringCommunityKey ? enteringSelectorCommunities : selectorCommunities,
  )
  const showPreferredCommunities = $derived(
    displayedSelectorCommunities.length > 0 || preferredCommunitiesLoading,
  )

  onMount(() => {
    let cancelled = false
    void waitForPostPaintHydration().then(async () => {
      if (cancelled) return
      exploreBackgroundHydrationReady = true
      if ($pubkey) await loadUserRelayListWithTimeout().catch(() => undefined)
    })
    return () => {
      cancelled = true
      exploreBackgroundHydrationReady = false
      if (preferredFullHydrationTimer) clearTimeout(preferredFullHydrationTimer)
    }
  })

  $effect(() => {
    const input = communitySearchInput.trim()
    const delay = getCommunitySearchAutoSubmitDelay(input)

    if (!delay) {
      automaticallySubmittedInput = ""
      return
    }
    if (automaticallySubmittedInput === input) return

    const timer = setTimeout(() => {
      if (communitySearchInput.trim() !== input) return
      automaticallySubmittedInput = input
      void submitCommunityInput(input)
    }, delay)

    return () => clearTimeout(timer)
  })

  $effect(() => {
    const user = $pubkey || ""
    const relays = preferredHydrationRelayHints
    const key = user && exploreBackgroundHydrationReady ? `${user}:${relays.join(",")}` : ""
    if (!key || preferredHydrationKey === key || preferredHydrationLoadingKey === key) return
    preferredHydrationLoadingKey = key
    hydratePreferredCommunityList({relayHints: relays})
      .catch(() => undefined)
      .finally(() => {
        if (preferredHydrationLoadingKey !== key) return
        preferredHydrationKey = key
        preferredHydrationLoadingKey = ""
        if (preferredFullHydrationKey === key) return
        preferredFullHydrationKey = key
        preferredFullHydrationTimer = setTimeout(() => {
          preferredFullHydrationTimer = undefined
          if (preferredHydrationKey === key) {
            void hydrateCommunityPreferences({relayHints: relays}).catch(() => undefined)
          }
        }, 1_500)
      })
  })

  $effect(() => {
    const community = DEFAULT_COMMUNITY_POINTER
    if (
      !community ||
      !exploreBackgroundHydrationReady ||
      defaultDefinition ||
      defaultLookupState !== "idle"
    ) {
      return
    }
    defaultLookupState = "loading"
    loadDefinition(community)
      .then(definition => {
        defaultDefinition = definition
        defaultLookupState = definition ? "found" : "not-found"
      })
      .catch(() => (defaultLookupState = "unavailable"))
  })

  $effect(() => {
    const onRelayResume = () => {
      preferredHydrationKey = ""
      preferredFullHydrationKey = ""
      defaultLookupState = "idle"
      defaultDefinition = undefined
    }
    window.addEventListener("budabit:relay-resume", onRelayResume)
    return () => window.removeEventListener("budabit:relay-resume", onRelayResume)
  })
</script>

<div class="hero min-h-screen w-full min-w-0 overflow-y-auto overflow-x-hidden pb-20 sm:pb-12">
  <div class="hero-content w-full min-w-0 p-2 sm:p-4">
    <div
      class="mx-auto flex w-full max-w-6xl flex-col gap-4 px-2 py-4 sm:px-8 sm:py-8 md:px-12 md:py-12">
      <h1 class="mb-3 text-center text-3xl font-bold leading-tight sm:mb-4 sm:text-5xl">
        Explore Communities
      </h1>
      {#if !$pubkey}
        <Button onclick={login} class="btn btn-primary self-center">Log in</Button>
      {/if}
      <div
        class="grid min-w-0 gap-4 lg:items-start {showPreferredCommunities
          ? 'lg:grid-cols-[minmax(0,1fr)_minmax(24rem,28rem)]'
          : 'lg:grid-cols-[minmax(24rem,28rem)] lg:justify-center'}">
        {#if showPreferredCommunities}
          <div class="card2 card2-sm bg-alt col-3 min-w-0 shadow-md lg:col-start-1 lg:row-start-1">
            <div class="flex flex-col gap-2">
              <div class="flex items-center justify-between gap-2">
                <p class="text-xs font-semibold uppercase tracking-wide opacity-60">
                  Preferred Communities
                </p>
                {#if preferredCommunitiesLoading}
                  <span class="loading loading-spinner loading-xs opacity-60"></span>
                {/if}
              </div>
              {#if preferredCommunitiesLoading && displayedSelectorCommunities.length === 0}
                <div class="rounded-box bg-base-100/60 px-3 py-2 text-sm opacity-70">
                  Loading your communities...
                </div>
              {/if}
              {#each displayedSelectorCommunities as item (item.community.address)}
                <CommunitySelectorCard
                  community={item.community}
                  definition={item.definition}
                  relayHints={item.relayHints}
                  shareRelayHints={item.relayHints}
                  publishRelayHints={item.publishRelayHints}
                  isCurrent={item.isCurrent}
                  isAdmin={item.isAdmin}
                  isModerator={item.isModerator}
                  isMember={item.isMember}
                  loading={enteringCommunityKey === item.community.address}
                  disabled={Boolean(enteringCommunityKey)}
                  onOpen={() => enterCommunity(item.community)} />
              {/each}
            </div>
          </div>
        {/if}

        <div
          class="flex min-w-0 flex-col gap-4 lg:row-start-1 {showPreferredCommunities
            ? 'lg:col-start-2'
            : ''}">
          <CommunityPreviewCard
            community={previewCommunity}
            definition={previewDefinition}
            relayHints={previewRelayHints}
            shareRelayHints={previewRelayHints}
            publishRelayHints={previewPublishRelayHints}
            label={previewLabel}
            emptyInfo={previewEmptyInfo}
            onOpen={openPreviewCommunity}
            bind:inputValue={communitySearchInput}
            showInput
            inputLabel="Search or paste a community"
            inputPlaceholder="Search names, naddr1..., npub1..., or NIP-05"
            showActions={previewHasCommunityDefinition}
            loading={previewLoading}
            opening={previewOpening}
            notFound={previewCommunityNotFound}
            unavailable={previewCommunityUnavailable}
            inputSearch={searchCommunityInputProfiles}
            inputSuggestionDefinitions={communityDefinitions}
            onInputSelect={selectCommunityInputProfile}
            onSubmit={submitCommunityInput} />

          {#if defaultCommunity}
            <CommunityPreviewCard
              community={defaultCommunity}
              definition={defaultDefinition}
              relayHints={defaultRelayHints}
              shareRelayHints={defaultRelayHints}
              publishRelayHints={defaultPublishRelayHints}
              label="Brand new? Start here:"
              emptyInfo="Start with the recommended community."
              onOpen={() => enterCommunity(defaultCommunity)}
              showActions={defaultHasCommunityDefinition}
              loading={defaultLoading}
              opening={defaultOpening}
              notFound={defaultCommunityNotFound}
              unavailable={defaultCommunityUnavailable} />
          {/if}

          <div class="flex min-w-0 flex-col gap-2 sm:flex-row">
            <Button
              onclick={createCommunity}
              class="btn btn-neutral min-h-10 min-w-0 flex-1 items-center justify-start gap-2 rounded-box px-3 py-2 text-sm sm:min-h-16 sm:gap-4 sm:px-6 sm:py-4 sm:text-base">
              <Icon icon={AddCircle} size={7} />
              <span class="min-w-0 truncate font-bold leading-none">Create Community</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
