<script lang="ts">
  import {onMount} from "svelte"
  import {load, request} from "@welshman/net"
  import {Router} from "@welshman/router"
  import type {Filter} from "@welshman/util"
  import {deriveArray, deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {formatTimestampRelative} from "@welshman/lib"
  import {NOTE, COMMENT} from "@welshman/util"
  import {repository, loadRelayList} from "@welshman/app"
  import Button from "@lib/components/Button.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import MedalStar from "@assets/icons/medal-star.svg?dataurl"
  import {MESSAGE_KINDS} from "@app/core/state"
  import {
    activeCommunityDefinition,
    activeCommunityRelays,
    activeCommunityReportState,
    getCommunityBadgeReadRelays,
  } from "@app/core/community-state"
  import {
    getAcceptedCommunityBadges,
    getCommunityBadgeImageUrl,
    getCommunityBadgeCreatorPubkeys,
    makeCommunityBadgeAwardDeleteFilters,
    makeCommunityBadgeAwardFilters,
    makeCommunityBadgeDefinitionFilters,
    makeProfileBadgeFilters,
    parseCommunityBadgeDefinition,
    type CommunityBadgeDefinition,
  } from "@app/core/community-badges"
  import {goToEvent} from "@app/util/routes"

  type Props = {
    pubkey: string
    url?: string
  }

  const {pubkey}: Props = $props()
  const filters: Filter[] = [{authors: [pubkey], limit: 1}]
  const events = deriveArray(deriveEventsById({repository, filters}))
  const badgeRelays = $derived(
    getCommunityBadgeReadRelays({communityRelays: $activeCommunityRelays, pubkeys: [pubkey]}),
  )
  const badgeDefinitionFilters = $derived(
    $activeCommunityDefinition
      ? makeCommunityBadgeDefinitionFilters({
          definition: $activeCommunityDefinition,
          reportState: $activeCommunityReportState,
        })
      : [],
  )
  const badgeDefinitionEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: badgeDefinitionFilters})),
  )
  const badgeDefinitions = $derived.by((): CommunityBadgeDefinition[] => {
    const definition = $activeCommunityDefinition
    if (!definition) return []

    const creators = getCommunityBadgeCreatorPubkeys({
      definition,
      reportState: $activeCommunityReportState,
    })

    return $badgeDefinitionEvents
      .map(event => parseCommunityBadgeDefinition(event, definition.pubkey))
      .filter((badge): badge is CommunityBadgeDefinition => Boolean(badge))
      .filter(badge => creators.includes(badge.pubkey))
  })
  const badgeAwardFilters = $derived(
    makeCommunityBadgeAwardFilters({definitions: badgeDefinitions, recipientPubkey: pubkey}),
  )
  const badgeAwardEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: badgeAwardFilters})),
  )
  const badgeAwardDeleteFilters = $derived(makeCommunityBadgeAwardDeleteFilters($badgeAwardEvents))
  const badgeAwardDeleteEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: badgeAwardDeleteFilters})),
  )
  const profileBadgeFilters = $derived(makeProfileBadgeFilters(pubkey))
  const profileBadgeEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: profileBadgeFilters})),
  )
  const acceptedBadges = $derived.by(() =>
    $activeCommunityDefinition
      ? getAcceptedCommunityBadges({
          definition: $activeCommunityDefinition,
          badgeDefinitionEvents: $badgeDefinitionEvents,
          badgeAwardEvents: $badgeAwardEvents,
          badgeAwardDeleteEvents: $badgeAwardDeleteEvents,
          profileBadgeEvents: $profileBadgeEvents,
          profilePubkey: pubkey,
          reportState: $activeCommunityReportState,
        })
      : [],
  )

  const viewEvent = () => goToEvent($events[0]!)

  onMount(async () => {
    // Make sure we have their relay selections before we load their posts
    await loadRelayList(pubkey)

    // Load at least one note, regardless of time frame
    load({
      filters: [{authors: [pubkey], limit: 1, kinds: [NOTE, COMMENT, ...MESSAGE_KINDS]}],
      relays: Router.get().FromPubkeys([pubkey]).getUrls(),
    })
  })

  $effect(() => {
    if (badgeRelays.length === 0) return

    const filters = [
      ...badgeDefinitionFilters,
      ...badgeAwardFilters,
      ...badgeAwardDeleteFilters,
      ...profileBadgeFilters,
    ]
    if (filters.length === 0) return

    const controller = new AbortController()
    request({relays: badgeRelays, autoClose: true, filters, signal: controller.signal})

    return () => controller.abort()
  })
</script>

<div class="flex flex-wrap gap-2">
  {#each acceptedBadges as badge (badge.award.event.id)}
    {@const badgeImage = getCommunityBadgeImageUrl(badge.definition, 32)}
    <span
      class="badge badge-primary h-auto max-w-full gap-1 py-1"
      title={badge.definition.description || badge.definition.name}>
      {#if badgeImage}
        <img alt="" src={badgeImage} class="h-4 w-4 rounded-full object-cover" />
      {:else}
        <Icon icon={MedalStar} size={4} />
      {/if}
      <span class="max-w-36 truncate">{badge.definition.name}</span>
    </span>
  {/each}
  {#if $events.length > 0}
    <Button onclick={viewEvent} class="badge badge-neutral">
      Last active {formatTimestampRelative($events[0].created_at)}
    </Button>
  {/if}
</div>
