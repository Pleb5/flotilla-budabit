<script lang="ts">
  import {goto} from "$app/navigation"
  import {pubkey} from "@welshman/app"
  import AddCircle from "@assets/icons/add-circle.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import CardButton from "@lib/components/CardButton.svelte"
  import {APP_NAME} from "@app/core/state"
  import {pushToast} from "@app/util/toast"
  import {normalizeRelays, parseCommunityInput} from "@app/core/community"
  import {
    activeCommunityStars,
    activeCommunityDefinition,
    activeCommunitySession,
    communityStarsLoading,
    getCommunityBootstrapRelays,
    hydrateCommunityStars,
    loadCommunityEvents,
    makeCommunityDefinitionFilter,
    selectLatestCommunityDefinition,
    setActiveCommunityInput,
  } from "@app/core/community-state"
  import CommunityPreviewCard from "@app/components/community/CommunityPreviewCard.svelte"
  import CommunitySelectorCard from "@app/components/community/CommunitySelectorCard.svelte"
  import {makeCommunityPath} from "@app/util/routes"
  import {makeCommunityInputValue} from "@app/util/community-stars"

  type SelectorCommunity = {
    pubkey: string
    relayHints: string[]
    isCurrent: boolean
  }

  let communityInput = $state("")
  let previewRequestId = 0
  let previewRequestKey = ""
  let selectorRelayHints = $state<Record<string, string[]>>({})
  const selectorRelayLoadAttempts = new Map<string, number>()
  const SELECTOR_RELAY_RETRY_MS = 30_000

  const createCommunity = () => goto("/explore/create-community")

  const enterCommunity = (input: string) => {
    const session = setActiveCommunityInput(input)

    if (!session) {
      pushToast({
        theme: "error",
        message: "Enter a valid community npub, hex pubkey, or ncommunity.",
      })
      return
    }

    communityInput = ""
    goto(makeCommunityPath(session.communityPubkey))
  }

  const submitCommunityInput = () => {
    if (!communityInput.trim()) return
    enterCommunity(communityInput)
  }

  const openSelectorCommunity = (item: SelectorCommunity) => {
    const input = makeCommunityInputValue({pubkey: item.pubkey, relayHints: item.relayHints})
    enterCommunity(input || item.pubkey)
  }

  const openPreviewCommunity = () => {
    const parsed = parseCommunityInput(communityInput)
    const pubkey = parsed?.pubkey || ""
    const relayHints = previewRelayHints

    if (!pubkey) return

    enterCommunity(makeCommunityInputValue({pubkey, relayHints}) || pubkey)
  }

  const loadCommunityDefinitionRelays = async (communityPubkey: string, relayHints: string[]) => {
    const discoveryRelays = getCommunityBootstrapRelays(relayHints)
    const definitionEvents = await loadCommunityEvents(discoveryRelays, [
      makeCommunityDefinitionFilter(communityPubkey),
    ])
    const definition = selectLatestCommunityDefinition(definitionEvents, communityPubkey)

    return definition?.relays || []
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
  const activeStars = $derived($activeCommunityStars)
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
    const current = session
      ? [
          {
            pubkey: session.communityPubkey,
            relayHints: currentRelayHints,
            isCurrent: true,
          },
        ]
      : []
    const starred = activeStars
      .filter(star => star.communityPubkey !== session?.communityPubkey)
      .map(star => ({
        pubkey: star.communityPubkey,
        relayHints: normalizeRelays([
          ...star.relayHints,
          ...(selectorRelayHints[star.communityPubkey] || []),
        ]),
        isCurrent: false,
      }))

    return [...current, ...starred]
  })
  const previewRelayHints = $derived.by(() => {
    if (!previewPubkey) return []

    return normalizeRelays([
      ...(previewInput?.relays || []),
      ...(previewPubkey === $activeCommunitySession?.communityPubkey ? currentRelayHints : []),
      ...(selectorRelayHints[previewPubkey] || []),
    ])
  })
  const previewLabel = $derived(hasCommunityInput ? "Preview community" : "Find community")
  const previewEmptyInfo = $derived(
    hasCommunityInput
      ? "Enter a valid npub, hex pubkey, or ncommunity."
      : "Paste a community to preview it.",
  )

  $effect(() => {
    if (!$pubkey) return

    hydrateCommunityStars({relayHints: currentRelayHints}).catch(() => {})
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
    const parsed = previewInput
    const pubkey = previewPubkey

    if (!pubkey) return

    const relayHints = parsed?.relays || $activeCommunitySession?.communityRelayHints || []
    const activeDefinitionRelays =
      !parsed || parsed.pubkey === $activeCommunitySession?.communityPubkey
        ? $activeCommunityDefinition?.relays || []
        : []
    const requestKey = [pubkey, ...relayHints, ...activeDefinitionRelays].join("|")

    if (previewRequestKey === requestKey) return
    previewRequestKey = requestKey

    const requestId = ++previewRequestId

    loadCommunityDefinitionRelays(pubkey, [...relayHints, ...activeDefinitionRelays])
      .then(relays => {
        if (requestId !== previewRequestId || relays.length === 0) return
        selectorRelayHints = {...selectorRelayHints, [pubkey]: relays}
      })
      .catch(() => {})
  })
</script>

<div class="hero min-h-screen overflow-auto pb-8">
  <div class="hero-content">
    <div class="column content gap-4">
      <h1 class="text-center text-5xl">Explore</h1>
      <h1 class="mb-4 text-center text-5xl font-bold uppercase">{$APP_NAME}</h1>
      <div class="col-3">
        <CommunityPreviewCard
          pubkey={previewPubkey}
          relayHints={previewRelayHints}
          label={previewLabel}
          emptyInfo={previewEmptyInfo}
          onOpen={openPreviewCommunity}
          bind:inputValue={communityInput}
          showInput
          onSubmit={submitCommunityInput} />

        {#if selectorCommunities.length > 0 || $communityStarsLoading}
          <div class="card2 bg-alt col-4 p-4 shadow-md">
            <div class="flex flex-col gap-2">
              <div class="flex items-center justify-between gap-2">
                <p class="text-xs font-semibold uppercase tracking-wide opacity-60">Communities</p>
                {#if $communityStarsLoading}
                  <span class="loading loading-spinner loading-xs opacity-60"></span>
                {/if}
              </div>
              {#each selectorCommunities as item (item.pubkey)}
                <CommunitySelectorCard
                  pubkey={item.pubkey}
                  relayHints={item.relayHints}
                  isCurrent={item.isCurrent}
                  onOpen={() => openSelectorCommunity(item)} />
              {/each}
            </div>
          </div>
        {/if}
        <Button onclick={createCommunity}>
          <CardButton class="btn-neutral">
            {#snippet icon()}
              <Icon icon={AddCircle} size={7} />
            {/snippet}
            {#snippet title()}
              <div>Create BudaBit Community</div>
            {/snippet}
            {#snippet info()}
              <div>Publish the community definition, writer lists, and initial admin badges.</div>
            {/snippet}
          </CardButton>
        </Button>
      </div>
    </div>
  </div>
</div>
