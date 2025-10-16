<script lang="ts">
  import {readable, type Readable} from "svelte/store"
  import {onMount} from "svelte"
  import {page} from "$app/stores"
  import {makeFeed} from "@app/core/requests"
  import {now, formatTimestampAsDate} from "@welshman/lib"
  import type {TrustedEvent, EventContent} from "@welshman/util"
  import {
    makeEvent,
    makeRoomMeta,
    MESSAGE,
    DELETE,
    REACTION,
    GIT_STATUS_CLOSED,
    GIT_STATUS_DRAFT,
    GIT_STATUS_OPEN,
    GIT_STATUS_COMPLETE,
    COMMENT,
  } from "@welshman/util"
  import {pubkey, publishThunk, getThunkError, joinRoom, leaveRoom} from "@welshman/app"
  import {slide, fade, fly} from "@lib/transition"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import Divider from "@lib/components/Divider.svelte"
  import ChannelMessage from "@app/components/ChannelMessage.svelte"
  import ChannelCompose from "@app/components/ChannelCompose.svelte"
  import ChannelComposeParent from "@app/components/ChannelComposeParent.svelte"
  import {
    userSettingsValues,
    decodeRelay,
    REACTION_KINDS,
  } from "@app/core/state"
  import {checked} from "@app/util/notifications"
  import {prependParent} from "@app/core/commands"
  import {PROTECTED} from "@app/core/state"
  import {popKey} from "@lib/implicit"
  import {pushToast} from "@app/util/toast"
  import {GIT_REPO_ANNOUNCEMENT, type IssueEvent, type PatchEvent} from "@nostr-git/shared-types"
  import ThunkToast from "@app/components/ThunkToast.svelte"
  import AltArrowDown from "@assets/icons/alt-arrow-down.svg?dataurl"

  const {id} = $page.params
  const {data} = $props()
  const {repoClass} = data
  const room = id

  const mounted = now()
  const lastChecked = $checked[$page.url.pathname]
  const url = decodeRelay($page.params.relay)

  const roomFilter = {kinds: [MESSAGE], "#h": [room]}

  const statusFilter = {
    kinds: [GIT_STATUS_COMPLETE, GIT_STATUS_CLOSED, GIT_STATUS_DRAFT, GIT_STATUS_OPEN],
    "#e": [
      ...repoClass.issues.map((issue: IssueEvent) => issue.id),
      ...repoClass.patches.map((patch: PatchEvent) => patch.id),
    ],
  }

  const commentFilter = {
    kinds: [COMMENT],
    "#E": [
      ...repoClass.issues.map((issue: IssueEvent) => issue.id),
      ...repoClass.patches.map((patch: PatchEvent) => patch.id),
    ],
  }

  const filter = [roomFilter, statusFilter, commentFilter]

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

    const thunk = publishThunk({
      relays: [url],
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
  let start: (() => void) | undefined = $state()
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

      const today = formatTimestampAsDate(Date.now() / 1000)
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

  const initialEvents = $state<TrustedEvent[]>([])
  initialEvents.push(
    ...repoClass.issues,
    ...repoClass.patches.filter(p => p.tags.some((t: string[]) => t[0] === "t" && t[1] === "root")),
  )
  initialEvents.sort((a, b) => b.created_at - a.created_at)

  onMount(() => {
    const controller = new AbortController()

    const observer = new ResizeObserver(() => {
      if (dynamicPadding && chatCompose) {
        dynamicPadding!.style.minHeight = `${chatCompose!.offsetHeight}px`
      }
    })

    observer.observe(chatCompose!)
    observer.observe(dynamicPadding!)

    const feed = makeFeed({
      element: element!,
      relays: [url],
      feedFilters: filter,
      subscriptionFilters: [
        ...filter,
        {kinds: [DELETE, MESSAGE, ...REACTION_KINDS], since: now()},
        {kinds: [DELETE, REACTION, MESSAGE, GIT_REPO_ANNOUNCEMENT], "#h": [room], since: now()},
      ],
      initialEvents: initialEvents,
      onExhausted: () => {
        loadingEvents = false
      },
    })
    events = feed.events
    cleanup = feed.cleanup


    return () => {
      controller.abort()
      observer.unobserve(chatCompose!)
      observer.unobserve(dynamicPadding!)
    }
  })
</script>

<svelte:head>
  <title>{repoClass.name} - Feed</title>
</svelte:head>

<div bind:this={element} onscroll={onScroll} class="flex flex-col-reverse">
  <div bind:this={dynamicPadding}></div>
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
  <p class="flex h-10 items-center justify-center py-8">
    {#if loadingEvents}
      <Spinner loading={loadingEvents}>Looking for messages...</Spinner>
    {:else}
      <Spinner>End of message history</Spinner>
    {/if}
  </p>
</div>

<div class="chat__compose bg-base-200" bind:this={chatCompose}>
  <div>
    {#if parent}
      <ChannelComposeParent event={parent} clear={clearParent} verb="Replying to" />
    {/if}
    {#if share}
      <ChannelComposeParent event={share} clear={clearShare} verb="Sharing" />
    {/if}
  </div>
  <ChannelCompose bind:this={compose} {onSubmit} {url} />
</div>

{#if showScrollButton}
  <div in:fade class="chat__scroll-down">
    <Button class="btn btn-circle btn-neutral" onclick={scrollToBottom}>
      <Icon icon={AltArrowDown} />
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
