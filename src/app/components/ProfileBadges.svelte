<script lang="ts">
  import {onMount} from "svelte"
  import {load, request} from "@welshman/net"
  import {Router} from "@welshman/router"
  import type {Filter, TrustedEvent} from "@welshman/util"
  import {deriveArray, deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {formatTimestampRelative} from "@welshman/lib"
  import {NOTE, COMMENT} from "@welshman/util"
  import {repository, loadRelayList} from "@welshman/app"
  import Button from "@lib/components/Button.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import InlinePopover from "@lib/components/InlinePopover.svelte"
  import MedalStar from "@assets/icons/medal-star.svg?dataurl"
  import ProfileName from "@app/components/ProfileName.svelte"
  import {MESSAGE_KINDS} from "@app/core/state"
  import {
    activeCommunityDefinition,
    activeCommunityProfileListEvents,
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
          profileListEvents: $activeCommunityProfileListEvents,
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
      profileListEvents: $activeCommunityProfileListEvents,
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
          profileListEvents: $activeCommunityProfileListEvents,
          badgeAwardEvents: $badgeAwardEvents,
          badgeAwardDeleteEvents: $badgeAwardDeleteEvents,
          profileBadgeEvents: $profileBadgeEvents,
          profilePubkey: pubkey,
          reportState: $activeCommunityReportState,
        })
      : [],
  )

  let openBadgeId = $state<string | null>(null)

  const viewEvent = () => goToEvent($events[0]!)

  const toggleBadge = (badgeId: string) => {
    openBadgeId = openBadgeId === badgeId ? null : badgeId
  }

  const viewBadgeEvent = (event: TrustedEvent) => {
    openBadgeId = null
    goToEvent(event)
  }

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

<div class="flex flex-wrap items-center gap-2">
  {#each acceptedBadges as badge (badge.award.event.id)}
    {@const badgeImage = getCommunityBadgeImageUrl(badge.definition, 32)}
    <div class="relative max-w-full">
      <Button
        onclick={() => toggleBadge(badge.award.event.id)}
        class="badge badge-primary h-auto max-w-full gap-1 py-1"
        title={badge.definition.description || badge.definition.name}>
        {#if badgeImage}
          <img alt="" src={badgeImage} class="h-4 w-4 rounded-full object-cover" />
        {:else}
          <Icon icon={MedalStar} size={4} />
        {/if}
        <span class="max-w-36 truncate">{badge.definition.name}</span>
      </Button>

      {#if openBadgeId === badge.award.event.id}
        <InlinePopover onClose={() => (openBadgeId = null)} align="left" widthClass="w-80">
          <div class="flex flex-col gap-3 text-sm">
            <div>
              <div class="font-semibold">{badge.definition.name}</div>
              {#if badge.definition.description}
                <div class="mt-1 text-xs opacity-70">{badge.definition.description}</div>
              {/if}
            </div>

            <div class="rounded-box bg-base-200/60 p-3">
              <div class="text-xs uppercase tracking-wide opacity-60">Awarded by</div>
              <div class="mt-1 text-sm font-medium">
                <ProfileName pubkey={badge.award.event.pubkey} />
              </div>
              <div class="mt-1 text-xs opacity-70">
                {formatTimestampRelative(badge.award.event.created_at)}
              </div>
            </div>

            <div class="rounded-box bg-base-200/60 p-3">
              <div class="text-xs uppercase tracking-wide opacity-60">Definition</div>
              <div class="mt-1 break-all text-xs opacity-75">{badge.definition.address}</div>
              {#if badge.definition.communityPubkey}
                <div class="mt-2 text-xs opacity-70">
                  Community <ProfileName pubkey={badge.definition.communityPubkey} />
                </div>
              {/if}
            </div>

            <div class="rounded-box bg-base-200/60 p-3">
              <div class="text-xs uppercase tracking-wide opacity-60">Accepted by profile</div>
              <div class="mt-1 break-all text-xs opacity-75">
                Award event {badge.profilePair.awardId}
              </div>
              {#if badge.profilePair.awardRelay || badge.profilePair.definitionRelay}
                <div class="mt-1 break-all text-xs opacity-60">
                  {badge.profilePair.awardRelay || badge.profilePair.definitionRelay}
                </div>
              {/if}
            </div>

            <div class="flex flex-wrap gap-2">
              <Button
                onclick={() => viewBadgeEvent(badge.award.event)}
                class="btn btn-neutral btn-xs">
                View award
              </Button>
              <Button
                onclick={() => viewBadgeEvent(badge.definition.event)}
                class="btn btn-neutral btn-xs">
                View definition
              </Button>
            </div>
          </div>
        </InlinePopover>
      {/if}
    </div>
  {/each}
  {#if $events.length > 0}
    <Button onclick={viewEvent} class="badge badge-neutral">
      Last active {formatTimestampRelative($events[0].created_at)}
    </Button>
  {/if}
</div>
