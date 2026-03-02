<script lang="ts">
  import {readable, type Readable} from "svelte/store"
  import {onMount, onDestroy} from "svelte"
  import {page} from "$app/stores"
  import {afterNavigate} from "$app/navigation"
  import {makeFeed} from "@app/core/requests"
  import {now, formatTimestampAsDate} from "@welshman/lib"
  import type {TrustedEvent, EventContent} from "@welshman/util"
  import {
    makeEvent,
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
  import RoomCompose from "@app/components/RoomCompose.svelte"
  import RoomComposeParent from "@app/components/RoomComposeParent.svelte"
  import {userSettingsValues, decodeRelay, REACTION_KINDS} from "@app/core/state"
  import {checked} from "@app/util/notifications"
  import {prependParent} from "@app/core/commands"
  import {PROTECTED} from "@app/core/state"
  import {popKey} from "@lib/implicit"
  import {pushToast} from "@app/util/toast"
  import {GIT_REPO_ANNOUNCEMENT, type IssueEvent, type PatchEvent} from "@nostr-git/core/events"
  import ThunkToast from "@app/components/ThunkToast.svelte"
  import AltArrowDown from "@assets/icons/alt-arrow-down.svg?dataurl"
  import {getContext} from "svelte"
  import {REPO_KEY} from "@lib/budabit/state"
  import type {Repo} from "@nostr-git/ui"

  const roomId = String($page.params.id ?? "")
  const repoClass = getContext<Repo>(REPO_KEY)
  
  if (!repoClass) {
    throw new Error("Repo context not available")
  }

  const mounted = now()
  const lastChecked = $checked[$page.url.pathname]
  const relayParam = String($page.params.relay ?? "")
  const url = decodeRelay(relayParam)

  const roomIds = roomId ? [roomId] : []
  const roomFilter = {kinds: [MESSAGE], "#h": roomIds}

  // Memoize filters to avoid recreating on every render
  const issueIds = $derived.by(() => repoClass.issues.map((issue: IssueEvent) => issue.id))
  const patchIds = $derived.by(() => repoClass.patches.map((patch: PatchEvent) => patch.id))

  const statusFilter = $derived.by(() => ({
    kinds: [GIT_STATUS_COMPLETE, GIT_STATUS_CLOSED, GIT_STATUS_DRAFT, GIT_STATUS_OPEN],
    "#e": [...issueIds, ...patchIds],
  }))

  const commentFilter = $derived.by(() => ({
    kinds: [COMMENT],
    "#E": [...issueIds, ...patchIds],
  }))

  const filter = $derived.by(() => [roomFilter, statusFilter, commentFilter])

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
    if (roomId) {
      tags.push(["h", roomId])
    }
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

  const scrollToBottom = () => {
    // Scroll to the compose area at the bottom
    chatCompose?.scrollIntoView({behavior: "smooth", block: "end"})
  }

  // Start with false to show content immediately - will update when feed loads
  let loadingEvents = $state(false)
  let share = $state(popKey<TrustedEvent | undefined>("share"))
  let parent: TrustedEvent | undefined = $state()
  let element: HTMLElement | undefined = $state()
  let newMessages: HTMLElement | undefined = $state()
  let chatCompose: HTMLElement | undefined = $state()
  let dynamicPadding: HTMLElement | undefined = $state()
  let newMessagesSeen = false
  let showFixedNewMessages = $state(false)
  let showScrollButton = $state(true)
  let feedCleanup: (() => void) | undefined = $state(undefined)
  let feedInitialized = $state(false)
  let lastFeedKey = ""
  let events: Readable<TrustedEvent[]> = $state(readable([]))
  let compose: RoomCompose | undefined = $state()

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

  // Memoize initialEvents to avoid recreating on every render
  const initialEvents = $derived.by(() => {
    const events: TrustedEvent[] = [
      ...repoClass.issues,
      ...repoClass.patches.filter(p => p.tags.some((t: string[]) => t[0] === "t" && t[1] === "root")),
    ]
    return [...events].sort((a, b) => b.created_at - a.created_at)
  })

  const feedKey = $derived.by(() => [relayParam, roomId, ...issueIds, ...patchIds].join("|"))

  const startFeed = () => {
    if (feedInitialized || !element || !url || !roomId) {
      return
    }
    feedInitialized = true
    lastFeedKey = feedKey
    const feed = makeFeed({
      element: element,
      relays: [url],
      feedFilters: filter as any,
      subscriptionFilters: ([
        ...filter,
        statusFilter,
        commentFilter,
        {kinds: [DELETE, MESSAGE, ...REACTION_KINDS], since: now()},
        {kinds: [DELETE, REACTION, MESSAGE, GIT_REPO_ANNOUNCEMENT], "#h": roomIds, since: now()},
      ] as any),
      initialEvents: initialEvents,
      onExhausted: () => {
        loadingEvents = false
      },
    } as any)
    events = feed.events
    feedCleanup = feed.cleanup

    // Scroll to bottom after a short delay to ensure content is rendered
    setTimeout(() => {
      scrollToBottom()
    }, 100)
  }

  const ensureFeed = () => {
    if (feedInitialized) return
    if (!element) {
      requestAnimationFrame(ensureFeed)
      return
    }
    startFeed()
  }

  $effect(() => {
    const key = feedKey
    if (!key) {
      return
    }
    if (!feedInitialized) {
      ensureFeed()
      return
    }
    if (key !== lastFeedKey) {
      feedCleanup?.()
      feedCleanup = undefined
      feedInitialized = false
      ensureFeed()
    }
  })

  onMount(() => {
    const controller = new AbortController()

    const observer = new ResizeObserver(() => {
      if (dynamicPadding && chatCompose) {
        dynamicPadding!.style.minHeight = `${chatCompose!.offsetHeight}px`
      }
    })

    observer.observe(chatCompose!)
    observer.observe(dynamicPadding!)

    const handlePageShow = () => {
      if (!feedInitialized) {
        ensureFeed()
      }
    }

    window.addEventListener("pageshow", handlePageShow)
    afterNavigate(() => {
      if (!feedInitialized) {
        ensureFeed()
      }
    })

    // Defer feed creation to avoid blocking initial render
    const timeout = setTimeout(() => {
      ensureFeed()
    }, 100)

    return () => {
      clearTimeout(timeout)
      controller.abort()
      observer.unobserve(chatCompose!)
      observer.unobserve(dynamicPadding!)
      window.removeEventListener("pageshow", handlePageShow)
    }
  })

  onDestroy(() => {
    feedCleanup?.()
    feedCleanup = undefined
    feedInitialized = false
  })
</script>

<svelte:head>
  <title>{repoClass.name} - Feed</title>
</svelte:head>

<div class="flex min-h-0 flex-1 flex-col">
  <div
    bind:this={element}
    onscroll={onScroll}
    class="scroll-container flex flex-1 min-h-0 flex-col-reverse overflow-y-auto overflow-x-hidden w-full">
    <div bind:this={dynamicPadding}></div>
    {#each elements as { type, id, value, showPubkey } (id)}
      {#if type === "new-messages"}
        <div
          bind:this={newMessages}
          class="flex items-center py-2 text-xs transition-colors px-2 sm:px-4"
          class:opacity-0={showFixedNewMessages}>
          <div class="h-px flex-grow bg-primary"></div>
          <p class="rounded-full bg-primary px-2 py-1 text-primary-content text-center whitespace-nowrap">New Messages</p>
          <div class="h-px flex-grow bg-primary"></div>
        </div>
      {:else if type === "date"}
        <div class="px-2 sm:px-4">
          <Divider>{value}</Divider>
        </div>
      {:else}
        <div in:slide class:-mt-1={!showPubkey} class="px-1 sm:px-2 md:px-4">
          <ChannelMessage
            {url}
            {replyTo}
            event={$state.snapshot(value as TrustedEvent)}
            {showPubkey} />
        </div>
      {/if}
    {/each}
    <p class="flex h-10 items-center justify-center py-4 sm:py-8 text-sm sm:text-base">
      {#if loadingEvents}
        <Spinner loading={loadingEvents}>Looking for messages...</Spinner>
      {:else}
        <Spinner>End of message history</Spinner>
      {/if}
    </p>
  </div>

  <div class="chat__compose bg-base-200 px-2 sm:px-4 py-2" bind:this={chatCompose}>
    <div class="max-w-full overflow-hidden">
      {#if parent}
        <RoomComposeParent event={parent} clear={clearParent} verb="Replying to" />
      {/if}
      {#if share}
        <RoomComposeParent event={share} clear={clearShare} verb="Sharing" />
      {/if}
    </div>
    <RoomCompose bind:this={compose} {onSubmit} {url} />
  </div>

  {#if showScrollButton}
    <div in:fade class="chat__scroll-down right-2 sm:right-4 bottom-16 sm:bottom-20">
      <Button class="btn btn-circle btn-neutral btn-sm sm:btn-md" onclick={scrollToBottom}>
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
</div>
