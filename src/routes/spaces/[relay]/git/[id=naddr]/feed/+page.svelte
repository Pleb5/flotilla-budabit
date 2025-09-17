<script lang="ts">
  import {readable, type Readable} from "svelte/store"
  import {onMount, onDestroy} from "svelte"
  import {page} from "$app/stores"
  import {makeFeed} from "@app/requests"
  import {whenElementReady} from "@src/lib/html"
  import {now, formatTimestampAsDate} from "@welshman/lib"
  import {load} from "@welshman/net"
  import type {TrustedEvent, EventContent} from "@welshman/util"
  import {
    makeEvent,
    makeRoomMeta,
    MESSAGE,
    DELETE,
    REACTION,
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
  } from "@welshman/app"
  import {slide, fade, fly} from "@lib/transition"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import Divider from "@lib/components/Divider.svelte"
  import ChannelMessage from "@app/components/ChannelMessage.svelte"
  import ChannelCompose from "@app/components/ChannelCompose.svelte"
  import ChannelComposeParent from "@app/components/ChannelComposeParent.svelte"
  import {
    userSettingValues,
    decodeRelay,
    deriveUserMembershipStatus,
    deriveChannel,
    MembershipStatus,
  } from "@app/state"
  import {setChecked, checked} from "@app/notifications"
  import {prependParent} from "@app/commands"
  import {PROTECTED} from "@app/state"
  import {popKey} from "@app/implicit"
  import {pushToast} from "@app/toast"
  import {GIT_REPO} from "@src/lib/util"
  import type {IssueEvent, PatchEvent} from "@nostr-git/shared-types"

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
    "#a": [Address.fromEvent(repoClass.repoEvent!).toString()],
  }
  const patchFilter = {
    kinds: [GIT_PATCH],
    "#a": [Address.fromEvent(repoClass.repoEvent!).toString()],
    "#t": ["root"],
  }
  const statusFilter = {
    kinds: [GIT_STATUS_COMPLETE, GIT_STATUS_CLOSED, GIT_STATUS_DRAFT, GIT_STATUS_OPEN],
    "#e": [...repoClass.issues.map((issue: IssueEvent) => issue.id), ...repoClass.patches.map((patch: PatchEvent) => patch.id)],
  }

  const commentFilter = {
    kinds: [COMMENT],
    "#E": [...repoClass.issues.map((issue: IssueEvent) => issue.id), ...repoClass.patches.map((patch: PatchEvent) => patch.id)],
  }

  const filter = [roomFilter, issueFilter, patchFilter, statusFilter, commentFilter]

  const membershipStatus = deriveUserMembershipStatus(url, room)

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
      const today = formatTimestampAsDate(Date.now()/1000)
      // Adjust last checked to account for messages that came from a different device
      const adjustedLastChecked =
        lastChecked && lastUserEvent ? Math.max(lastUserEvent.created_at, lastChecked) : lastChecked

      for (const event of $events) {
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

        if (date !== previousDate && date !== today) {
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

    //elements.reverse()

    setTimeout(onScroll, 100)

    return elements
  })

  const start = async () => {
    cleanup?.()

    await whenElementReady(
      () => element,
      async (readyElement) => {
        const initialEvents = await load({
          relays: repoClass.relays || [url],
          filters: filter,
        })

        initialEvents.push(
          ...repoClass.issues,
          ...repoClass.patches.filter(p => p.tags.some((t: string[]) => t[0] === "t" && t[1] === "root")),
        )

        initialEvents.sort((a, b) => b.created_at - a.created_at)

        const feed = makeFeed({
          element: readyElement,
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
    )
  }

  onMount(() => {
    start()
  })

  onDestroy(() => {
    cleanup?.()

    // Sveltekit calls onDestroy at the beginning of the page load for some reason
    setTimeout(() => {
      setChecked($page.url.pathname)
    }, 800)
  })
</script>

<div
  bind:this={element}
  onscroll={onScroll}
  class="scroll-container cw md:bottom-sai fixed bottom-[calc(var(--saib)+3.5rem)] top-[calc(var(--sait)+16rem)] flex flex-col overflow-y-auto overflow-x-hidden px-6 w-full">
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
      <Icon icon="alt-arrow-up" />
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
