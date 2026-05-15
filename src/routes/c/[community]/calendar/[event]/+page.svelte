<script lang="ts">
  import {onDestroy} from "svelte"
  import {page} from "$app/stores"
  import {request} from "@welshman/net"
  import {pubkey, repository} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {sortBy} from "@welshman/lib"
  import {COMMENT, EVENT_TIME, getTagValue, type Filter} from "@welshman/util"
  import AltArrowLeft from "@assets/icons/alt-arrow-left.svg?dataurl"
  import Reply from "@assets/icons/reply-2.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import Content from "@app/components/Content.svelte"
  import NoteCard from "@app/components/NoteCard.svelte"
  import PublishGate from "@app/components/community/PublishGate.svelte"
  import CalendarEventActions from "@app/components/CalendarEventActions.svelte"
  import CalendarEventHeader from "@app/components/CalendarEventHeader.svelte"
  import CalendarEventMeta from "@app/components/CalendarEventMeta.svelte"
  import CalendarEventDate from "@app/components/CalendarEventDate.svelte"
  import {preventDefault} from "@lib/html"
  import {publishComment} from "@app/core/commands"
  import {
    activeCommunityDefinition,
    activeCommunityProfileListEvents,
    activeCommunityRelays,
  } from "@app/core/community-state"
  import {
    COMMUNITY_SECTION_CALENDAR,
    COMMUNITY_SECTION_GENERAL,
    normalizePubkey,
    parseTargetedPublication,
  } from "@app/core/community"
  import {makeCommunityTargetingFilter} from "@app/core/community-feeds"
  import {
    COMMUNITY_WRITE_TARGETS,
    canWriteCommunityTarget,
    getCommunitySectionWriterPubkeys,
  } from "@app/core/community-permissions"
  import {setChecked} from "@app/util/notifications"
  import {pushToast} from "@app/util/toast"
  import {makeCommunityPath, parseCommunityRouteParam} from "@app/util/routes"

  const parsedCommunity = $derived(parseCommunityRouteParam($page.params.community))
  const communityPubkey = $derived(parsedCommunity?.pubkey || "")
  const eventId = $derived($page.params.event || "")
  const calendarPath = $derived(communityPubkey ? makeCommunityPath(communityPubkey, "calendar") : "")
  const calendarAuthorPubkeys = $derived(
    $activeCommunityDefinition
      ? getCommunitySectionWriterPubkeys({
          definition: $activeCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          sectionName: COMMUNITY_SECTION_CALENDAR,
        })
      : [],
  )
  const interactionAuthorPubkeys = $derived(
    $activeCommunityDefinition
      ? getCommunitySectionWriterPubkeys({
          definition: $activeCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          sectionName: COMMUNITY_SECTION_GENERAL,
        })
      : [],
  )
  const eventFilters = $derived<Filter[]>(
    eventId && calendarAuthorPubkeys.length
      ? [{kinds: [EVENT_TIME], ids: [eventId], authors: calendarAuthorPubkeys}]
      : [],
  )
  const eventEvents = $derived(deriveEventsAsc(deriveEventsById({repository, filters: eventFilters})))
  const event = $derived($eventEvents[0])
  const eventAddress = $derived.by(() => {
    const identifier = event ? getTagValue("d", event.tags) : ""

    return event && identifier ? `${EVENT_TIME}:${event.pubkey}:${identifier}` : ""
  })
  const eventTargetingId = $derived(event ? getTagValue("h", event.tags) || "" : "")
  const targetingFilters = $derived<Filter[]>(
    communityPubkey && event
      ? [
          makeCommunityTargetingFilter(
            communityPubkey,
            [EVENT_TIME],
            eventTargetingId ? {"#d": [eventTargetingId]} : {},
          ),
        ]
      : [],
  )
  const targetingEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: targetingFilters})),
  )
  const isTargetedToCommunity = $derived.by(() => {
    if (!event) return false

    const allowedAuthors = new Set(calendarAuthorPubkeys.map(normalizePubkey).filter(Boolean))
    if (!allowedAuthors.has(normalizePubkey(event.pubkey))) return false

    return $targetingEvents.some(targetingEvent => {
      const targeting = parseTargetedPublication(targetingEvent)
      if (!targeting || targeting.kind !== EVENT_TIME) return false
      if (eventTargetingId && targeting.id === eventTargetingId) return true
      if (targeting.ref?.type === "e" && targeting.ref.value === event.id) return true
      if (targeting.ref?.type === "a" && targeting.ref.value === eventAddress) return true

      return false
    })
  })
  const approvedEvent = $derived(event && isTargetedToCommunity ? event : undefined)
  const replyFilters = $derived<Filter[]>(
    approvedEvent && interactionAuthorPubkeys.length
      ? [
          {
            kinds: [COMMENT],
            "#E": [approvedEvent.id],
            "#K": [String(EVENT_TIME)],
            "#h": [communityPubkey],
            authors: interactionAuthorPubkeys,
          },
        ]
      : [],
  )
  const replyEventsStore = $derived(deriveEventsAsc(deriveEventsById({repository, filters: replyFilters})))
  const replyEvents = $derived(sortBy(replyEvent => replyEvent.created_at, $replyEventsStore))

  const canReply = $derived(
    Boolean(
      approvedEvent &&
        $pubkey &&
        $activeCommunityDefinition &&
        canWriteCommunityTarget({
          definition: $activeCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          userPubkey: $pubkey,
          target: COMMUNITY_WRITE_TARGETS.comment,
        }),
    ),
  )
  const canReact = $derived(
    Boolean(
      approvedEvent &&
        $pubkey &&
        $activeCommunityDefinition &&
        canWriteCommunityTarget({
          definition: $activeCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          userPubkey: $pubkey,
          target: COMMUNITY_WRITE_TARGETS.reaction,
        }),
    ),
  )

  const sendReply = () => {
    const trimmed = reply.trim()
    if (!approvedEvent || !trimmed) return
    if (!canReply) {
      pushToast({theme: "error", message: "You do not have permission to comment."})
      return
    }
    if ($activeCommunityRelays.length === 0) {
      pushToast({theme: "error", message: "Community relays are not loaded yet."})
      return
    }

    publishComment({
      relays: $activeCommunityRelays,
      event: approvedEvent,
      content: trimmed,
      tags: [["h", communityPubkey]],
    })
    reply = ""
    showReply = false
  }

  let loadingEvent = $state(false)
  let eventRequestDone = $state(false)
  let loadingTargeting = $state(false)
  let targetRequestDone = $state(false)
  let reply = $state("")
  let showReply = $state(false)

  $effect(() => {
    if ($activeCommunityRelays.length === 0 || eventFilters.length === 0) return

    const controller = new AbortController()
    const timeout = setTimeout(() => {
      loadingEvent = false
      eventRequestDone = true
    }, 3000)

    loadingEvent = true
    eventRequestDone = false
    request({relays: $activeCommunityRelays, filters: eventFilters, signal: controller.signal})
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(timeout)
        if (controller.signal.aborted) return

        loadingEvent = false
        eventRequestDone = true
      })

    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  })

  $effect(() => {
    if ($activeCommunityRelays.length === 0 || targetingFilters.length === 0) return

    const controller = new AbortController()
    const timeout = setTimeout(() => {
      loadingTargeting = false
      targetRequestDone = true
    }, 3000)

    loadingTargeting = true
    targetRequestDone = false
    request({relays: $activeCommunityRelays, filters: targetingFilters, signal: controller.signal})
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(timeout)
        if (controller.signal.aborted) return

        loadingTargeting = false
        targetRequestDone = true
      })

    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  })

  $effect(() => {
    if ($activeCommunityRelays.length === 0 || replyFilters.length === 0) return

    const controller = new AbortController()
    request({relays: $activeCommunityRelays, filters: replyFilters, signal: controller.signal})

    return () => controller.abort()
  })

  onDestroy(() => {
    setChecked($page.url.pathname)
  })
</script>

<PageBar>
  {#snippet icon()}
    <div>
      <a href={calendarPath || "#"} class="btn btn-neutral btn-sm">
        <Icon icon={AltArrowLeft} />
      </a>
    </div>
  {/snippet}
  {#snippet title()}
    <strong>{approvedEvent ? getTagValue("title", approvedEvent.tags) || "Calendar event" : "Calendar event"}</strong>
  {/snippet}
</PageBar>

<PageContent class="flex flex-col gap-3 p-2 pt-4">
  {#if approvedEvent}
    <article class="card2 bg-alt col-3 z-feature">
      <div class="flex items-start gap-4">
        <CalendarEventDate event={approvedEvent} />
        <div class="flex min-w-0 flex-grow flex-col gap-1">
          <CalendarEventHeader event={approvedEvent} />
          <CalendarEventMeta event={approvedEvent} url={communityPubkey} />
          {#if approvedEvent.content}
            <div class="flex py-2 opacity-50">
              <div class="h-px flex-grow bg-base-content opacity-25"></div>
            </div>
            <Content event={approvedEvent} url={communityPubkey} showEntire />
          {/if}
        </div>
      </div>
      <div class="flex w-full flex-col justify-end sm:flex-row">
        <CalendarEventActions
          url={communityPubkey}
          relays={$activeCommunityRelays}
          scopeH={communityPubkey}
          allowedAuthors={interactionAuthorPubkeys}
          readOnly={!canReact}
          event={approvedEvent} />
      </div>
    </article>

    <div class="col-2">
      {#each replyEvents as replyEvent (replyEvent.id)}
        <NoteCard event={replyEvent} url={communityPubkey} class="card2 bg-alt z-feature w-full">
          <div class="col-3 ml-12">
            <Content showEntire event={replyEvent} url={communityPubkey} />
          </div>
        </NoteCard>
      {:else}
        <p class="py-8 text-center opacity-70">No comments yet.</p>
      {/each}
    </div>

    {#if showReply}
      <form class="card2 bg-alt col-3 p-4 shadow-md" onsubmit={preventDefault(sendReply)}>
        <strong>Comment</strong>
        <textarea bind:value={reply} class="textarea textarea-bordered" rows="4"></textarea>
        <div class="flex justify-end gap-2">
          <button class="btn btn-link" type="button" onclick={() => (showReply = false)}>Cancel</button>
          <PublishGate
            target={COMMUNITY_WRITE_TARGETS.comment}
            action="comment on events"
            submit
            disabled={!reply.trim()}>
            <Icon icon={Reply} />
            Comment
          </PublishGate>
        </div>
      </form>
    {:else}
      <div class="flex justify-end px-2 pb-2">
        {#if canReply}
          <button class="btn btn-primary" type="button" onclick={() => (showReply = true)}>
            <Icon icon={Reply} />
            Leave comment
          </button>
        {:else}
          <PublishGate
            target={COMMUNITY_WRITE_TARGETS.comment}
            action="comment on events"
            class="btn btn-primary">
            <Icon icon={Reply} />
            Leave comment
          </PublishGate>
        {/if}
      </div>
    {/if}
  {:else if !$activeCommunityDefinition || loadingEvent || (event && (loadingTargeting || !targetRequestDone)) || (!event && !eventRequestDone)}
    <p class="flex h-10 items-center justify-center py-20 text-center">
      <Spinner loading>Loading event...</Spinner>
    </p>
  {:else}
    <p class="py-8 text-center opacity-70">Event not found or not approved for this community.</p>
  {/if}
</PageContent>
