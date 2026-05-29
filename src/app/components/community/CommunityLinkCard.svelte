<script lang="ts">
  import {goto} from "$app/navigation"
  import {repository} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import HomeSmile from "@assets/icons/home-smile.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import {formatShortNpub} from "@app/util/pubkeys"
  import {
    getCommunityBootstrapRelays,
    hydratePubkeyProfiles,
    loadCommunityEvents,
    makeCommunityDefinitionFilter,
    selectLatestCommunityDefinition,
    setActiveCommunityInput,
  } from "@app/core/community-state"
  import {
    makeCommunityNcommunity,
    normalizeRelays,
    type CommunityDefinition,
    type ParsedCommunityInput,
  } from "@app/core/community"
  import {makeCommunityPath} from "@app/util/routes"
  import CommunityShareButton from "@app/components/community/CommunityShareButton.svelte"
  import {deriveBudabitProfile, deriveBudabitProfileDisplay} from "@app/core/profile-resolver"

  type Props = {
    value: ParsedCommunityInput
    compact?: boolean
  }

  const {value, compact = false}: Props = $props()

  const communityPubkey = $derived(value.pubkey)
  const relayHints = $derived(normalizeRelays(value.relays || []))
  const fallbackName = $derived(formatShortNpub(communityPubkey) || "Unknown community")

  let definition = $state<CommunityDefinition | undefined>()
  let loadingDefinition = $state(false)

  $effect(() => {
    const pubkey = communityPubkey
    if (!pubkey) {
      definition = undefined
      return
    }

    const events = deriveEventsAsc(
      deriveEventsById({repository, filters: [makeCommunityDefinitionFilter(pubkey)]}),
    )

    return events.subscribe(items => {
      definition = selectLatestCommunityDefinition(items, pubkey)
    })
  })

  $effect(() => {
    const pubkey = communityPubkey
    const relays = getCommunityBootstrapRelays(relayHints)
    if (!pubkey || relays.length === 0) return

    let cancelled = false
    loadingDefinition = true

    loadCommunityEvents(relays, [makeCommunityDefinitionFilter(pubkey)], {timeout: 3000})
      .catch(() => [])
      .finally(() => {
        if (!cancelled) loadingDefinition = false
      })

    return () => {
      cancelled = true
    }
  })

  const displayRelays = $derived(normalizeRelays([...relayHints, ...(definition?.relays || [])]))
  const profile = $derived(deriveBudabitProfile(communityPubkey, {communityRelays: displayRelays}))
  const profileDisplay = $derived(
    deriveBudabitProfileDisplay(communityPubkey, {communityRelays: displayRelays}),
  )
  const name = $derived($profileDisplay || fallbackName)
  const description = $derived(
    definition?.description || $profile?.about || displayRelays[0] || "Shared Budabit community",
  )
  const shareValue = $derived(
    makeCommunityNcommunity({pubkey: communityPubkey, relayHints: displayRelays}),
  )
  const href = $derived(makeCommunityPath(shareValue || communityPubkey))
  const preserveRelayHints = () => {
    if (shareValue) setActiveCommunityInput(shareValue)
  }

  let profileHydrationKey = ""

  $effect(() => {
    const key = communityPubkey ? `${communityPubkey}:${displayRelays.join(",")}` : ""
    if (!key || profileHydrationKey === key) return

    profileHydrationKey = key
    hydratePubkeyProfiles({pubkeys: [communityPubkey], relayHints: displayRelays}).catch(() => {})
  })

  const openCommunity = (event: MouseEvent) => {
    preserveRelayHints()

    if (event.defaultPrevented || event.button !== 0) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

    event.preventDefault()
    event.stopPropagation()
    goto(href)
  }
</script>

<div class="my-2 block w-full max-w-xl text-left">
  <div
    class="overflow-hidden rounded-xl border border-base-300 bg-base-100 shadow-sm transition-colors hover:border-primary/40">
    <div class="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
      <a
        {href}
        class="flex min-w-0 flex-1 items-center gap-3 no-underline"
        onclick={openCommunity}
        data-stop-tap>
        <div
          class="center !flex h-14 w-14 shrink-0 overflow-hidden rounded-2xl border border-base-300 bg-base-200 sm:h-16 sm:w-16">
          {#if $profile?.picture}
            <img alt="" src={$profile.picture} class="h-full w-full object-cover" />
          {:else}
            <Icon icon={HomeSmile} size={compact ? 6 : 7} />
          {/if}
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex min-w-0 items-center gap-2">
            <p class="truncate text-xs font-semibold uppercase tracking-wide opacity-60">
              Community
            </p>
            {#if loadingDefinition && !definition}
              <span class="loading loading-spinner loading-xs opacity-50"></span>
            {/if}
          </div>
          <h3 class="truncate text-base font-bold sm:text-lg">{name}</h3>
          {#if description}
            <p class="line-clamp-2 text-sm opacity-70">{description}</p>
          {/if}
        </div>
      </a>
      <div class="flex shrink-0 gap-2 self-end sm:self-center">
        <a
          {href}
          class="btn btn-primary btn-sm !border-primary !bg-primary !text-primary-content !no-underline hover:!border-primary/80 hover:!bg-primary/80 hover:!text-primary-content hover:!no-underline"
          onclick={openCommunity}
          data-stop-tap>
          Open
        </a>
        <CommunityShareButton
          {communityPubkey}
          relayHints={displayRelays}
          class="btn btn-square btn-sm" />
      </div>
    </div>
  </div>
</div>
