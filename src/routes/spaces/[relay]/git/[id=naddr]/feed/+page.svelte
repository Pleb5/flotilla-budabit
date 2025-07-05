<script lang="ts">
  import cx from "classnames"
  import {readable} from "svelte/store"
  import {onMount, onDestroy} from "svelte"
  import {page} from "$app/stores"
  import type {Readable} from "svelte/store"
  import {now, formatTimestampAsDate} from "@welshman/lib"
  import {load, request} from "@welshman/net"
  import type {TrustedEvent, EventContent} from "@welshman/util"
  import {
    makeEvent,
    makeRoomMeta,
    MESSAGE,
    DELETE,
    REACTION,
    ROOM_ADD_USER,
    ROOM_REMOVE_USER,
    GIT_ISSUE,
    GIT_PATCH,
    Address,
    GIT_STATUS_CLOSED,
    GIT_STATUS_DRAFT,
    GIT_STATUS_OPEN,
    GIT_STATUS_COMPLETE,
    COMMENT,
  } from "@welshman/util"
  import {
    pubkey,
    publishThunk,
    getThunkError,
    joinRoom,
    leaveRoom,
    deriveRelay,
  } from "@welshman/app"
  import {slide, fade, fly} from "@lib/transition"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import Divider from "@lib/components/Divider.svelte"
  import MenuSpaceButton from "@app/components/MenuSpaceButton.svelte"
  import ChannelName from "@app/components/ChannelName.svelte"
  import ChannelMessage from "@app/components/ChannelMessage.svelte"
  import ChannelCompose from "@app/components/ChannelCompose.svelte"
  import ChannelComposeParent from "@app/components/ChannelComposeParent.svelte"
  import {
    userRoomsByUrl,
    userSettingValues,
    decodeRelay,
    deriveUserMembershipStatus,
    deriveChannel,
    MembershipStatus,
  } from "@app/state"
  import {setChecked, checked} from "@app/notifications"
  import {addRoomMembership, removeRoomMembership, prependParent} from "@app/commands"
  import {PROTECTED} from "@app/state"
  import {makeFeed} from "@app/requests"
  import {popKey} from "@app/implicit"
  import {pushToast} from "@app/toast"
  import {GIT_REPO} from "@src/lib/util"

  const {id} = $page.params
  const {data} = $props()
  const {repoClass} = data
  const room = id
  const mounted = now()
  const lastChecked = $checked[$page.url.pathname]
  const url = decodeRelay($page.params.relay)
  const channel = deriveChannel(url, room)

  const roomFilter = {kinds: [MESSAGE], "#h": [room]}
  const issueFilter = {
    kinds: [GIT_ISSUE],
    "#a": [Address.fromEvent(repoClass.repoEvent).toString()],
  }
  const patchFilter = {
    kinds: [GIT_PATCH],
    "#a": [Address.fromEvent(repoClass.repoEvent).toString()],
    "#t": ["root"],
  }
  const statusFilter = {
    kinds: [GIT_STATUS_COMPLETE, GIT_STATUS_CLOSED, GIT_STATUS_DRAFT, GIT_STATUS_OPEN],
    "#e": [...repoClass.issues.map(issue => issue.id), ...repoClass.patches.map(patch => patch.id)],
  }

  const commentFilter = {
    kinds: [COMMENT],
    "#E": [...repoClass.issues.map(issue => issue.id), ...repoClass.patches.map(patch => patch.id)],
  }

  const filter = [roomFilter, issueFilter, patchFilter, statusFilter, commentFilter]

  const isFavorite = $derived($userRoomsByUrl.get(url)?.has(room))
  const membershipStatus = deriveUserMembershipStatus(url, room)

  const addFavorite = () => addRoomMembership(url, room)

  const removeFavorite = () => removeRoomMembership(url, room)
  const relay = deriveRelay(url)

  const join = async () => {
    joining = true

    try {
      const message = await getThunkError(joinRoom(url, makeRoomMeta({id: room})))

      if (message && !message.startsWith("duplicate:")) {
        return pushToast({theme: "error", message})
      } else {
        // Restart the feed now that we're a member
        start()
      }
    } finally {
      joining = false
    }
  }

  const leave = async () => {
    leaving = true
    try {
      const message = await getThunkError(leaveRoom(url, makeRoomMeta({id: room})))

      if (message && !message.startsWith("duplicate:")) {
        pushToast({theme: "error", message})
      }
    } finally {
      leaving = false
    }
  }

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

  const onSubmit = ({content, tags}: EventContent) => {
    tags.push(["h", room])
    tags.push(PROTECTED)

    let template = {content, tags}

    if (share) {
      template = prependParent(share, template)
    }

    if (parent) {
      template = prependParent(parent, template)
    }

    publishThunk({
      relays: [url],
      event: makeEvent(MESSAGE, template),
      delay: $userSettingValues.send_delay,
    })

    clearParent()
    clearShare()
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

  let joining = $state(false)
  let leaving = $state(false)
  let loadingEvents = $state(true)
  let share = $state(popKey<TrustedEvent | undefined>("share"))
  let parent: TrustedEvent | undefined = $state()
  let element: HTMLElement | undefined = $state()
  let newMessages: HTMLElement | undefined = $state()
  let chatCompose: HTMLElement | undefined = $state()
  let dynamicPadding: HTMLElement | undefined = $state()
  let newMessagesSeen = false
  let showFixedNewMessages = $state(false)
  let showScrollButton = $state(false)
  let cleanup: () => void
  let events: Readable<TrustedEvent[]> = $state(readable([]))
  let compose: ChannelCompose | undefined = $state()

  const elements = $derived.by(() => {
    const elements = []
    const seen = new Set()

    let previousDate
    let previousPubkey
    let newMessagesSeen = false

    if (events) {
      const lastUserEvent = $events.find(e => e.pubkey === $pubkey)

      // Adjust last checked to account for messages that came from a different device
      const adjustedLastChecked =
        lastChecked && lastUserEvent ? Math.max(lastUserEvent.created_at, lastChecked) : lastChecked

      for (const event of $events.toReversed()) {
        if (seen.has(event.id)) {
          continue
        }

        const date = formatTimestampAsDate(event.created_at)

        if (
          !newMessagesSeen &&
          adjustedLastChecked &&
          event.pubkey !== $pubkey &&
          event.created_at > adjustedLastChecked &&
          event.created_at < mounted
        ) {
          elements.push({type: "new-messages", id: "new-messages"})
          newMessagesSeen = true
        }

        if (date !== previousDate) {
          elements.push({type: "date", value: date, id: date, showPubkey: false})
        }

        elements.push({
          id: event.id,
          type: "note",
          value: event,
          showPubkey: date !== previousDate || previousPubkey !== event.pubkey,
        })

        previousDate = date
        previousPubkey = event.pubkey
        seen.add(event.id)
      }
    }

    elements.reverse()

    setTimeout(onScroll, 100)

    return elements
  })

  const start = async () => {
    cleanup?.()

    const initialEvents = await load({
      relays: repoClass.relays || [url],
      filters: filter,
    })

    initialEvents.push(
      ...repoClass.issues,
      ...repoClass.patches.filter(p => p.tags.some(t => t[0] === "t" && t[1] === "root")),
    )

initialEvents.sort((a, b) => b.created_at - a.created_at)

    const feed = makeFeed({
      element: element!,
      relays: [url],
      feedFilters: filter,
      subscriptionFilters: [
        ...filter,
        {kinds: [DELETE, REACTION, MESSAGE, GIT_REPO], "#h": [room], since: now()},
      ],
      initialEvents,
      onExhausted: () => {
        loadingEvents = false
      },
    })

    events = feed.events
    cleanup = feed.cleanup
  }

  onMount(() => {
    const controller = new AbortController()

    request({
      signal: controller.signal,
      relays: [url],
      filters: [
        {
          kinds: [ROOM_ADD_USER, ROOM_REMOVE_USER],
          "#p": [$pubkey!],
          "#h": [room],
          limit: 10,
        },
      ],
    })

    const observer = new ResizeObserver(() => {
      if (dynamicPadding && chatCompose) {
        dynamicPadding!.style.minHeight = `${chatCompose!.offsetHeight}px`
      }
    })

    observer.observe(chatCompose!)
    observer.observe(dynamicPadding!)
    start()

    return () => {
      controller.abort()
      observer.unobserve(chatCompose!)
      observer.unobserve(dynamicPadding!)
    }
  })

  onDestroy(() => {
    cleanup()

    // Sveltekit calls onDestroy at the beginning of the page load for some reason
    setTimeout(() => {
      setChecked($page.url.pathname)
    }, 800)
  })
</script>


<div bind:this={element} onscroll={onScroll} class="flex flex-col-reverse pt-4">
  <div bind:this={dynamicPadding}></div>
  {#if $channel?.private && $membershipStatus !== MembershipStatus.Granted}
    <div class="py-20">
      <div class="card2 col-8 m-auto max-w-md items-center text-center">
        <p class="row-2">You aren't currently a member of this room.</p>
        {#if $membershipStatus === MembershipStatus.Pending}
          <Button class="btn btn-neutral btn-sm" disabled={leaving} onclick={leave}>
            <Icon icon="clock-circle" />
            Access Pending
          </Button>
        {:else}
          <Button class="btn btn-neutral btn-sm" disabled={joining} onclick={join}>
            {#if joining}
              <span class="loading loading-spinner loading-sm"></span>
            {:else}
              <Icon icon="login-2" />
            {/if}
            Join Room
          </Button>
        {/if}
      </div>
    </div>
  {:else}
    {#each elements as { type, id, value, showPubkey } (id)}
      {#if type === "new-messages"}
        <div
          bind:this={newMessages}
          class="flex items-center py-2 text-xs transition-colors"
          class:opacity-0={showFixedNewMessages}>
          <div class="h-px flex-grow bg-primary"></div>
          <p class="rounded-full bg-primary px-2 py-1 text-primary-content">New Messages</p>
          <div class="h-px flex-grow bg-primary"></div>
        </div>
      {:else if type === "date"}
        <Divider>{value}</Divider>
      {:else}
        <div in:slide class:-mt-1={!showPubkey}>
          <ChannelMessage
            {url}
            {replyTo}
            event={$state.snapshot(value as TrustedEvent)}
            {showPubkey} />
        </div>
      {/if}
    {/each}
    <p class="flex h-10 items-center justify-center py-20">
      {#if loadingEvents}
        <Spinner loading={loadingEvents}>Looking for messages...</Spinner>
      {:else}
        <Spinner>End of message history</Spinner>
      {/if}
    </p>
  {/if}
</div>

<div class="chat__compose bg-base-200" bind:this={chatCompose}>
  {#if $channel?.private && $membershipStatus !== MembershipStatus.Granted}
    <!-- pass -->
  {:else if $channel?.closed && $membershipStatus !== MembershipStatus.Granted}
    <div class="bg-alt card m-4 flex flex-row items-center justify-between px-4 py-3">
      <p>Only members are allowed to post to this room.</p>
      {#if $membershipStatus === MembershipStatus.Pending}
        <Button class="btn btn-neutral btn-sm" disabled={leaving} onclick={leave}>
          <Icon icon="clock-circle" />
          Access Pending
        </Button>
      {:else}
        <Button class="btn btn-neutral btn-sm" disabled={joining} onclick={join}>
          {#if joining}
            <span class="loading loading-spinner loading-sm"></span>
          {:else}
            <Icon icon="login-2" />
          {/if}
          Ask to Join
        </Button>
      {/if}
    </div>
  {:else}
    <div>
      {#if parent}
        <ChannelComposeParent event={parent} clear={clearParent} verb="Replying to" />
      {/if}
      {#if share}
        <ChannelComposeParent event={share} clear={clearShare} verb="Sharing" />
      {/if}
    </div>
    <ChannelCompose bind:this={compose} {onSubmit} {url} />
  {/if}
</div>

{#if showScrollButton}
  <div in:fade class="chat__scroll-down">
    <Button class="btn btn-circle btn-neutral" onclick={scrollToBottom}>
      <Icon icon="alt-arrow-down" />
    </Button>
  </div>
{/if}

{#if showFixedNewMessages}
  <div class="relative z-feature flex justify-center">
    <div transition:fly={{duration: 200}} class="fixed top-12">
      <Button class="btn btn-primary btn-xs rounded-full" onclick={scrollToNewMessages}>
        New Messages
      </Button>
    </div>
  </div>
{/if}
