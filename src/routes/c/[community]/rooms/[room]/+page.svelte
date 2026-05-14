<script lang="ts">
  import {readable, type Readable} from "svelte/store"
  import {onDestroy, onMount, tick} from "svelte"
  import {page} from "$app/stores"
  import {request} from "@welshman/net"
  import {pubkey, publishThunk, repository} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {ago, formatTimestampAsDate, int, MINUTE, now} from "@welshman/lib"
  import type {EventContent, TrustedEvent} from "@welshman/util"
  import {makeEvent, MESSAGE, THREAD} from "@welshman/util"
  import {fade, fly, slide} from "@lib/transition"
  import AltArrowDown from "@assets/icons/alt-arrow-down.svg?dataurl"
  import AltArrowLeft from "@assets/icons/alt-arrow-left.svg?dataurl"
  import Button from "@lib/components/Button.svelte"
  import Divider from "@lib/components/Divider.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import PublishGate from "@app/components/community/PublishGate.svelte"
  import RoomCompose from "@app/components/RoomCompose.svelte"
  import RoomComposeEdit from "@app/components/RoomComposeEdit.svelte"
  import RoomComposeParent from "@app/components/RoomComposeParent.svelte"
  import RoomImage from "@app/components/RoomImage.svelte"
  import RoomItem from "@app/components/RoomItem.svelte"
  import RoomName from "@app/components/RoomName.svelte"
  import ThunkToast from "@app/components/ThunkToast.svelte"
  import {
    activeCommunityDefinition,
    activeCommunityProfileListEvents,
    activeCommunityRelays,
  } from "@app/core/community-state"
  import {
    makeCommunityExclusiveFilter,
    makeCommunityRoomMessagesFilter,
  } from "@app/core/community-feeds"
  import {makeCommunityRoomMessage, readCommunityRoomMessages} from "@app/core/community-messages"
  import {readCommunityRoomRoot} from "@app/core/community-rooms"
  import {COMMUNITY_SECTION_GENERAL, COMMUNITY_SECTION_ROOMS} from "@app/core/community"
  import {
    COMMUNITY_WRITE_TARGETS,
    canWriteCommunityTarget,
    getCommunitySectionWriterPubkeys,
  } from "@app/core/community-permissions"
  import {makeFeed} from "@app/core/requests"
  import {userSettingsValues} from "@app/core/state"
  import {prependParent, publishSocialDelete} from "@app/core/commands"
  import {checked, setChecked} from "@app/util/notifications"
  import {popKey} from "@lib/implicit"
  import {pushToast} from "@app/util/toast"
  import {makeCommunityPath, parseCommunityRouteParam} from "@app/util/routes"
  import SlotRenderer from "@app/extensions/components/SlotRenderer.svelte"

  type RoomElement =
    | {type: "new-messages"; id: string}
    | {type: "date"; id: string; value: string; showPubkey: false}
    | {type: "note"; id: string; value: TrustedEvent; showPubkey: boolean}

  const parsedCommunity = $derived(parseCommunityRouteParam($page.params.community))
  const communityPubkey = $derived(parsedCommunity?.pubkey || "")
  const roomId = $derived($page.params.room || "")
  const mounted = now()
  const lastChecked = $checked[$page.url.pathname]

  const roomAuthorPubkeys = $derived(
    $activeCommunityDefinition
      ? getCommunitySectionWriterPubkeys({
          definition: $activeCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          sectionName: COMMUNITY_SECTION_ROOMS,
        })
      : [],
  )
  const messageAuthorPubkeys = $derived(
    $activeCommunityDefinition
      ? getCommunitySectionWriterPubkeys({
          definition: $activeCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          sectionName: COMMUNITY_SECTION_GENERAL,
        })
      : [],
  )
  const roomFilters = $derived(
    communityPubkey && roomId && roomAuthorPubkeys.length
      ? [
          makeCommunityExclusiveFilter(communityPubkey, [THREAD], {
            ids: [roomId],
            authors: roomAuthorPubkeys,
          }),
        ]
      : [],
  )
  const roomEvents = $derived(deriveEventsAsc(deriveEventsById({repository, filters: roomFilters})))
  const room = $derived(
    $roomEvents[0] ? readCommunityRoomRoot($roomEvents[0], communityPubkey) : undefined,
  )
  const messageFilters = $derived(
    communityPubkey && room && messageAuthorPubkeys.length
      ? [makeCommunityRoomMessagesFilter(communityPubkey, room.id, {authors: messageAuthorPubkeys})]
      : [],
  )
  const canSendMessage = $derived(
    Boolean(
      room &&
      $pubkey &&
      $activeCommunityDefinition &&
      canWriteCommunityTarget({
        definition: $activeCommunityDefinition,
        profileListEvents: $activeCommunityProfileListEvents,
        userPubkey: $pubkey,
        target: COMMUNITY_WRITE_TARGETS.roomMessage,
      }),
    ),
  )
  const canReact = $derived(
    Boolean(
      room &&
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
  const feedKey = $derived.by(() =>
    communityPubkey && room && messageAuthorPubkeys.length && $activeCommunityRelays.length
      ? [communityPubkey, room.id, ...$activeCommunityRelays, ...messageAuthorPubkeys].join("|")
      : "",
  )
  const composeUrl = $derived($activeCommunityRelays[0] || communityPubkey)

  const replyTo = (event: TrustedEvent) => {
    parent = event
    compose?.focus()
  }

  const clearParent = () => {
    parent = undefined
  }

  const clearShare = () => {
    share = undefined
  }

  const clearEventToEdit = () => {
    eventToEdit = undefined
  }

  const onSubmit = async ({content, tags}: EventContent) => {
    const trimmed = content.trim()
    if (!trimmed || !communityPubkey || !roomId) return
    if (!room) {
      pushToast({theme: "error", message: "Room metadata is not loaded yet."})
      return
    }
    if (!canSendMessage) {
      pushToast({theme: "error", message: "Request General access to message this room."})
      return
    }

    const relays = $activeCommunityRelays
    if (relays.length === 0) {
      pushToast({theme: "error", message: "Community relays are not loaded yet."})
      return
    }

    let template: EventContent & {created_at?: number} = makeCommunityRoomMessage({
      communityPubkey,
      room: {id: room.id, creatorPubkey: room.creatorPubkey},
      relay: relays[0],
      content: trimmed,
      tags,
      parent: parent ? {id: parent.id, pubkey: parent.pubkey, relay: relays[0]} : undefined,
    })

    if (eventToEdit) {
      template.created_at = eventToEdit.created_at
      publishSocialDelete({url: communityPubkey, relays, event: eventToEdit, protect: false})
    }

    if (share) {
      template = prependParent(share, template, {relays})
    }

    if (parent) {
      template = prependParent(parent, template, {relays})
    }

    const thunk = publishThunk({
      relays,
      event: makeEvent(MESSAGE, template),
      delay: $userSettingsValues.send_delay,
    })

    if ($userSettingsValues.send_delay) {
      pushToast({
        timeout: 30_000,
        children: {
          component: ThunkToast,
          props: {thunk},
        },
      })
    }

    clearParent()
    clearShare()
    clearEventToEdit()
    void tick().then(() => scrollToBottom())
  }

  const onScroll = () => {
    showScrollButton = Math.abs(element?.scrollTop || 0) > 1500

    if (!newMessages || newMessagesSeen) {
      showFixedNewMessages = false
    } else {
      const {y} = newMessages.getBoundingClientRect()

      if (y > 300) {
        newMessagesSeen = true
      } else {
        showFixedNewMessages = y < 0
      }
    }
  }

  const scrollToNewMessages = () =>
    newMessages?.scrollIntoView({behavior: "smooth", block: "center"})

  const scrollToBottom = () => element?.scrollTo({top: 0, behavior: "smooth"})

  const updateDynamicPadding = () => {
    if (dynamicPadding && chatCompose) {
      dynamicPadding.style.minHeight = `${chatCompose.offsetHeight}px`
    }
  }

  const resetFeed = () => {
    feedCleanup?.()
    feedCleanup = undefined
    events = readable([])
    loadingEvents = false
    exhaustedEvents = false
    feedInitialized = false
    lastFeedKey = ""
  }

  const startFeed = (key: string) => {
    if (!element || !key || messageFilters.length === 0 || $activeCommunityRelays.length === 0)
      return

    loadingEvents = true
    exhaustedEvents = false
    newMessagesSeen = false
    showFixedNewMessages = false
    lastFeedKey = key
    feedInitialized = true

    const feed = makeFeed({
      element,
      relays: $activeCommunityRelays,
      feedFilters: messageFilters,
      subscriptionFilters: messageFilters,
      onInitialLoad: () => {
        loadingEvents = false
      },
      onExhausted: () => {
        loadingEvents = false
        exhaustedEvents = true
      },
    })

    events = feed.events
    feedCleanup = feed.cleanup
  }

  const onEscape = () => {
    clearParent()
    clearShare()
    clearEventToEdit()
  }

  const canEditEvent = (event: TrustedEvent) =>
    canSendMessage && event.pubkey === $pubkey && event.created_at >= ago(5, MINUTE)

  const onEditEvent = (event: TrustedEvent) => {
    clearParent()
    clearShare()
    eventToEdit = event
  }

  const onEditPrevious = () => {
    const prev = $events.find(e => e.pubkey === $pubkey)

    if (prev && canEditEvent(prev)) {
      onEditEvent(prev)
    }
  }

  let loadingEvents = $state(false)
  let exhaustedEvents = $state(false)
  let share = $state(popKey<TrustedEvent | undefined>("share"))
  let parent: TrustedEvent | undefined = $state()
  let element: HTMLElement | undefined = $state()
  let newMessages: HTMLElement | undefined = $state()
  let chatCompose: HTMLElement | undefined = $state()
  let dynamicPadding: HTMLElement | undefined = $state()
  let newMessagesSeen = false
  let showFixedNewMessages = $state(false)
  let showScrollButton = $state(false)
  let events: Readable<TrustedEvent[]> = $state(readable([]))
  let compose: RoomCompose | undefined = $state()
  let eventToEdit: TrustedEvent | undefined = $state()
  let feedCleanup: (() => void) | undefined = $state()
  let feedInitialized = $state(false)
  let lastFeedKey = ""

  const messages = $derived(readCommunityRoomMessages($events, communityPubkey, roomId))
  const elements = $derived.by(() => {
    const nextElements: RoomElement[] = []
    const seen = new Set<string>()

    let previousDate
    let previousPubkey
    let previousCreatedAt = 0
    let hasSeenNewMessages = false

    const lastUserEvent = messages.find(e => e.event.pubkey === $pubkey)?.event
    const adjustedLastChecked =
      lastChecked && lastUserEvent ? Math.max(lastUserEvent.created_at, lastChecked) : lastChecked

    for (const item of messages.toReversed()) {
      const event = item.event
      if (seen.has(event.id)) continue

      const date = formatTimestampAsDate(event.created_at)

      if (
        !hasSeenNewMessages &&
        adjustedLastChecked &&
        event.pubkey !== $pubkey &&
        event.created_at > adjustedLastChecked &&
        event.created_at < mounted
      ) {
        nextElements.push({type: "new-messages", id: "new-messages"})
        hasSeenNewMessages = true
      }

      if (date !== previousDate) {
        nextElements.push({type: "date", value: date, id: date, showPubkey: false})
      }

      nextElements.push({
        id: event.id,
        type: "note",
        value: event,
        showPubkey:
          previousPubkey !== event.pubkey || event.created_at - previousCreatedAt > int(3, MINUTE),
      })

      previousDate = date
      previousPubkey = event.pubkey
      previousCreatedAt = event.created_at
      seen.add(event.id)
    }

    nextElements.reverse()
    setTimeout(onScroll, 100)

    return nextElements
  })

  $effect(() => {
    const relays = $activeCommunityRelays
    if (!communityPubkey || !roomId || relays.length === 0 || roomFilters.length === 0) return

    const controller = new AbortController()
    request({relays, filters: roomFilters, signal: controller.signal})

    return () => controller.abort()
  })

  $effect(() => {
    const key = feedKey

    if (!key || !element) {
      resetFeed()
      return
    }

    if (!feedInitialized || key !== lastFeedKey) {
      resetFeed()
      startFeed(key)
    }
  })

  onMount(() => {
    const observer = new ResizeObserver(updateDynamicPadding)

    if (chatCompose) observer.observe(chatCompose)
    if (dynamicPadding) observer.observe(dynamicPadding)
    updateDynamicPadding()

    return () => {
      if (chatCompose) observer.unobserve(chatCompose)
      if (dynamicPadding) observer.unobserve(dynamicPadding)
      observer.disconnect()
    }
  })

  onDestroy(() => {
    resetFeed()

    setTimeout(() => {
      setChecked($page.url.pathname)
    }, 800)
  })
</script>

<PageBar>
  {#snippet icon()}
    <div class="row-2">
      <a href={makeCommunityPath(communityPubkey, "rooms")} class="btn btn-neutral btn-sm">
        <Icon icon={AltArrowLeft} />
      </a>
      <div class="center hidden h-8 w-8 rounded-xl bg-base-200 sm:flex">
        <RoomImage {room} h={roomId} />
      </div>
    </div>
  {/snippet}
  {#snippet title()}
    <strong><RoomName {room} h={roomId} /></strong>
  {/snippet}
  {#snippet action()}
    <div class="row-2">
      <SlotRenderer slotId="room:header:actions" context={{url: communityPubkey, room}} />
    </div>
  {/snippet}
</PageBar>

<PageContent bind:element onscroll={onScroll} class="flex flex-col-reverse pt-4">
  <div bind:this={dynamicPadding}></div>
  {#each elements as item (item.id)}
    {#if item.type === "new-messages"}
      <div
        bind:this={newMessages}
        class="flex items-center py-2 text-xs transition-colors"
        class:opacity-0={showFixedNewMessages}>
        <div class="h-px flex-grow bg-primary"></div>
        <p class="rounded-full bg-primary px-2 py-1 text-primary-content">New Messages</p>
        <div class="h-px flex-grow bg-primary"></div>
      </div>
    {:else if item.type === "date"}
      <Divider>{item.value}</Divider>
    {:else}
      {@const event = $state.snapshot(item.value as TrustedEvent)}
      <div in:slide class:-mt-1={!item.showPubkey}>
        <RoomItem
          url={communityPubkey}
          profileRelays={$activeCommunityRelays}
          interactionRelays={$activeCommunityRelays}
          interactionAuthorPubkeys={messageAuthorPubkeys}
          scopeH={communityPubkey}
          protectInteractions={false}
          {event}
          readOnly={!canReact}
          {replyTo}
          showPubkey={item.showPubkey}
          canEdit={canEditEvent}
          onEdit={onEditEvent} />
      </div>
    {/if}
  {/each}
  {#if loadingEvents || elements.length === 0 || exhaustedEvents}
    <p class="flex h-10 items-center justify-center py-20 text-center">
      {#if loadingEvents}
        <Spinner loading={loadingEvents}>Looking for messages...</Spinner>
      {:else if elements.length === 0}
        <span>No messages yet.</span>
      {:else}
        <Spinner>End of message history</Spinner>
      {/if}
    </p>
  {/if}
</PageContent>

<div class="chat__compose bg-base-200" bind:this={chatCompose}>
  {#if canSendMessage}
    <div>
      {#if parent}
        <RoomComposeParent event={parent} clear={clearParent} verb="Replying to" />
      {/if}
      {#if share}
        <RoomComposeParent event={share} clear={clearShare} verb="Sharing" />
      {/if}
      {#if eventToEdit}
        <RoomComposeEdit clear={clearEventToEdit} />
      {/if}
    </div>
    {#key eventToEdit}
      <RoomCompose
        url={composeUrl}
        h={communityPubkey}
        showMenu={false}
        {onSubmit}
        {onEscape}
        {onEditPrevious}
        content={eventToEdit?.content}
        bind:this={compose} />
    {/key}
  {:else}
    <div
      class="m-3 flex flex-wrap items-center justify-between gap-3 rounded-box bg-base-100 p-3 shadow-sm">
      <div class="min-w-0">
        <strong class="block text-sm">Room access required</strong>
        <p class="text-xs opacity-70">Request General access to message this room.</p>
      </div>
      <PublishGate
        target={COMMUNITY_WRITE_TARGETS.roomMessage}
        action="message rooms"
        compact
        class="btn btn-primary" />
    </div>
  {/if}
</div>

{#if showScrollButton}
  <div in:fade class="chat__scroll-down">
    <Button class="btn btn-circle btn-neutral" onclick={scrollToBottom}>
      <Icon icon={AltArrowDown} />
    </Button>
  </div>
{/if}

{#if showFixedNewMessages}
  <div class="relative z-popover flex justify-center">
    <div transition:fly={{duration: 200}} class="fixed top-12">
      <Button class="btn btn-primary btn-xs rounded-full" onclick={scrollToNewMessages}>
        New Messages
      </Button>
    </div>
  </div>
{/if}
