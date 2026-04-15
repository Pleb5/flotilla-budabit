<script lang="ts">
  import {readable, writable, type Readable} from "svelte/store"
  import {getContext, onDestroy, onMount} from "svelte"
  import {beforeNavigate} from "$app/navigation"
  import {page} from "$app/stores"
  import {now, formatTimestampAsDate, on} from "@welshman/lib"
  import type {EventContent, TrustedEvent} from "@welshman/util"
  import {
    DELETE,
    MESSAGE,
    GIT_ISSUE,
    GIT_STATUS_OPEN,
    GIT_STATUS_DRAFT,
    GIT_STATUS_CLOSED,
    GIT_STATUS_COMPLETE,
    makeEvent,
    matchFilters,
    normalizeRelayUrl,
  } from "@welshman/util"
  import {pubkey, publishThunk, repository, tracker} from "@welshman/app"
  import {request} from "@welshman/net"
  import {fade, fly, slide} from "@lib/transition"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import Divider from "@lib/components/Divider.svelte"
  import ChannelMessage from "@app/components/ChannelMessage.svelte"
  import RepoFeedGitItem from "@app/components/RepoFeedGitItem.svelte"
  import RoomCompose from "@app/components/RoomCompose.svelte"
  import RoomComposeParent from "@app/components/RoomComposeParent.svelte"
  import {PLATFORM_RELAYS, REACTION_KINDS, decodeRelay, getEventsForUrl, userSettingsValues} from "@app/core/state"
  import {checked} from "@app/util/notifications"
  import {prependParent} from "@app/core/commands"
  import {popKey} from "@lib/implicit"
  import {pushToast} from "@app/util/toast"
  import ThunkToast from "@app/components/ThunkToast.svelte"
  import AltArrowDown from "@assets/icons/alt-arrow-down.svg?dataurl"
  import {REPO_FEED_ACTIVITY_KEY, REPO_KEY, STATUS_EVENTS_BY_ROOT_KEY} from "@lib/budabit/state"
  import type {Repo} from "@nostr-git/ui"
  import type {StatusEvent} from "@nostr-git/core/events"

  const repoClass = getContext<Repo>(REPO_KEY)
  const repoFeedActivityStore = getContext<Readable<TrustedEvent[]>>(REPO_FEED_ACTIVITY_KEY)
  const statusEventsByRootStore = getContext<Readable<Map<string, StatusEvent[]>>>(STATUS_EVENTS_BY_ROOT_KEY)

  if (!repoClass) {
    throw new Error("Repo context not available")
  }

  const mounted = now()
  const lastChecked = $checked[$page.url.pathname]
  const relayParam = String($page.params.relay ?? "")
  const routeUrl = decodeRelay(relayParam)
  const basePath = $derived.by(() => $page.url.pathname.replace(/\/feed$/, ""))
  const scrollStorageKey = $derived.by(() => `repo-feed-scroll:${$page.url.pathname}`)

  const normalizeRelay = (relay: string) => {
    try {
      return normalizeRelayUrl(relay)
    } catch {
      return ""
    }
  }

  const platformRelays = $derived.by(() => [...new Set(PLATFORM_RELAYS.map(normalizeRelay).filter(Boolean))])
  const communityUrl = $derived.by(() => platformRelays[0] || "")
  const fallbackRepoAddress = $derived.by(() => {
    const repoPubkey = String(($page.data as any)?.repoPubkey ?? "")
    const repoName = String(($page.data as any)?.repoName ?? "")

    if (repoClass.address) {
      return repoClass.address
    }

    if (repoPubkey && repoName) {
      return `30617:${repoPubkey}:${repoName}`
    }

    return ""
  })
  const communityScope = $derived.by(() => fallbackRepoAddress)

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
    if (!communityScope || platformRelays.length === 0) {
      return
    }

    tags.push(["h", communityScope])

    let template = {content, tags}

    if (share) {
      template = prependParent(share, template)
    }

    if (parent) {
      template = prependParent(parent, template)
    }

    const thunk = publishThunk({
      relays: platformRelays,
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

    setTimeout(scrollToBottom, 100)
  }

  const getDistanceFromBottom = () => {
    if (!element) return 0

    return Math.max(0, element.scrollHeight - element.clientHeight - element.scrollTop)
  }

  const onScroll = () => {
    const distanceFromBottom = getDistanceFromBottom()

    showScrollButton = distanceFromBottom > 800

    if (!newMessages || newMessagesSeen) {
      showFixedNewMessages = false
      return
    }

    const rect = newMessages.getBoundingClientRect()
    const withinViewport = rect.top >= 0 && rect.bottom <= window.innerHeight

    if (withinViewport || (distanceFromBottom < 48 && rect.top < 0)) {
      newMessagesSeen = true
      showFixedNewMessages = false
      return
    }

    showFixedNewMessages = rect.top > window.innerHeight
  }

  const scrollToNewMessages = () =>
    newMessages?.scrollIntoView({behavior: "smooth", block: "center"})

  const scrollToBottom = () => {
    bottomAnchor?.scrollIntoView({behavior: "smooth", block: "end"})
  }

  const restoreFeedScroll = () => {
    if (!element || pendingScrollRestore === null) {
      return false
    }

    const top = pendingScrollRestore

    element.scrollTo({top, behavior: "auto"})
    requestAnimationFrame(() => {
      element?.scrollTo({top, behavior: "auto"})
    })
    setTimeout(() => {
      element?.scrollTo({top, behavior: "auto"})
    }, 40)

    pendingScrollRestore = null

    if (typeof sessionStorage !== "undefined") {
      sessionStorage.removeItem(scrollStorageKey)
    }

    return true
  }

  const syncScrollParent = () => {
    const next = container?.closest(".scroll-container") as HTMLElement | null

    if (next === element) {
      return
    }

    if (element) {
      element.removeEventListener("scroll", onScroll)
    }

    element = next || undefined
    element?.addEventListener("scroll", onScroll, {passive: true})
    onScroll()
  }

  let loadingEvents = $state(false)
  let share = $state(popKey<TrustedEvent | undefined>("share"))
  let parent: TrustedEvent | undefined = $state()
  let container: HTMLElement | undefined = $state()
  let element: HTMLElement | undefined = $state()
  let newMessages: HTMLElement | undefined = $state()
  let bottomAnchor: HTMLElement | undefined = $state()
  let chatCompose: HTMLElement | undefined = $state()
  let dynamicPadding: HTMLElement | undefined = $state()
  let newMessagesSeen = false
  let showFixedNewMessages = $state(false)
  let showScrollButton = $state(false)
  let feedCleanup: (() => void) | undefined = $state(undefined)
  let feedInitialized = $state(false)
  let lastFeedKey = ""
  let communityEvents: Readable<TrustedEvent[]> = $state(readable([]))
  let compose: RoomCompose | undefined = $state()
  let pendingScrollRestore: number | null = $state(null)

  const repoFeedActivity = $derived.by(() => $repoFeedActivityStore || [])
  const statusEventsByRoot = $derived.by(() => $statusEventsByRootStore || new Map())

  const visibleCommunityEvents = $derived.by(() => $communityEvents.filter(event => event.kind === MESSAGE))

  const displayEvents = $derived.by(() => {
    const deduped = new Map<string, TrustedEvent>()

    for (const event of [...repoFeedActivity, ...visibleCommunityEvents]) {
      deduped.set(event.id, event)
    }

    return Array.from(deduped.values()).sort(
      (a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id),
    )
  })

  const elements = $derived.by(() => {
    const nextElements = []
    const seen = new Set<string>()

    let previousDate
    let previousPubkey
    let hasSeenNewMessages = false

    const lastUserEvent = displayEvents.find(event => event.pubkey === $pubkey && event.kind === MESSAGE)
    const adjustedLastChecked =
      lastChecked && lastUserEvent ? Math.max(lastUserEvent.created_at, lastChecked) : lastChecked
    const today = formatTimestampAsDate(Date.now() / 1000)

    for (const event of [...displayEvents].toReversed()) {
      if (seen.has(event.id)) {
        continue
      }

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

      if (date !== previousDate && date !== today) {
        nextElements.push({type: "date", value: date, id: date, showPubkey: false})
      }

      nextElements.push({
        id: event.id,
        type: "note",
        value: event,
        showPubkey: date !== previousDate || previousPubkey !== event.pubkey,
      })

      previousDate = date
      previousPubkey = event.pubkey
      seen.add(event.id)
    }

    setTimeout(onScroll, 100)

    return nextElements
  })

  const getOpenHref = (event: TrustedEvent) =>
    event.kind === GIT_ISSUE ? `${basePath}/issues/${event.id}` : `${basePath}/patches/${event.id}`

  const statusStateById = $derived.by(() => {
    const byId = new Map<string, "open" | "draft" | "closed" | "applied">()

    for (const event of repoFeedActivity) {
      const statusEvent = statusEventsByRoot.get(event.id)?.at(-1)

      switch (statusEvent?.kind) {
        case GIT_STATUS_DRAFT:
          byId.set(event.id, "draft")
          break
        case GIT_STATUS_CLOSED:
          byId.set(event.id, "closed")
          break
        case GIT_STATUS_COMPLETE:
          byId.set(event.id, "applied")
          break
        case GIT_STATUS_OPEN:
        default:
          byId.set(event.id, "open")
          break
      }
    }

    return byId
  })

  const feedKey = $derived.by(() =>
    communityScope && platformRelays.length > 0 ? [communityScope, ...platformRelays].join("|") : "",
  )

  const startFeed = () => {
    if (feedInitialized || !communityScope || platformRelays.length === 0) {
      return
    }

    loadingEvents = true
    newMessagesSeen = false
    showFixedNewMessages = false
    feedInitialized = true
    lastFeedKey = feedKey

    const historyFilters = [{kinds: [MESSAGE], "#h": [communityScope]}]
    const liveFilters = [{kinds: [DELETE, MESSAGE, ...REACTION_KINDS], "#h": [communityScope], since: now()}]
    const allFilters = [...historyFilters, ...liveFilters]
    const controller = new AbortController()
    const platformRelaySet = new Set(platformRelays)
    const initialEvents = new Map<string, TrustedEvent>()

    for (const relay of platformRelays) {
      for (const event of getEventsForUrl(relay, historyFilters)) {
        initialEvents.set(event.id, event)
      }
    }

    const events = writable(
      Array.from(initialEvents.values()).sort(
        (a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id),
      ),
    )

    const matchesPlatformRelay = (event: TrustedEvent) => {
      for (const relay of tracker.getRelays(event.id)) {
        if (platformRelaySet.has(normalizeRelay(relay))) {
          return true
        }
      }

      return false
    }

    const unsubscribe = on(repository, "update", ({added, removed}) => {
      if (removed.size > 0) {
        events.update($events => $events.filter(event => !removed.has(event.id)))
      }

      for (const event of added) {
        if (!matchFilters(allFilters, event) || !matchesPlatformRelay(event) || event.kind !== MESSAGE) {
          continue
        }

        events.update($events => {
          if ($events.some(existing => existing.id === event.id)) {
            return $events
          }

          return [...$events, event].sort(
            (a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id),
          )
        })
      }
    })

    void request({relays: platformRelays, signal: controller.signal, autoClose: true, filters: historyFilters}).finally(() => {
      if (!controller.signal.aborted) {
        loadingEvents = false
      }
    })

    void request({relays: platformRelays, signal: controller.signal, filters: liveFilters})

    communityEvents = events
    feedCleanup = () => {
      unsubscribe()
      controller.abort()
    }

    setTimeout(scrollToBottom, 100)
  }

  const resetFeed = () => {
    feedCleanup?.()
    feedCleanup = undefined
    communityEvents = readable([])
    feedInitialized = false
    lastFeedKey = ""
    loadingEvents = false
  }

  $effect(() => {
    const key = feedKey

    if (!key) {
      resetFeed()
      return
    }

    if (!feedInitialized) {
      startFeed()
      return
    }

    if (key !== lastFeedKey) {
      resetFeed()
      startFeed()
    }
  })

  onMount(() => {
    if (typeof sessionStorage !== "undefined") {
      const saved = Number(sessionStorage.getItem(scrollStorageKey) || "")
      pendingScrollRestore = Number.isFinite(saved) ? saved : null
    }

    syncScrollParent()

    const observer = new ResizeObserver(() => {
      if (dynamicPadding && chatCompose) {
        dynamicPadding.style.minHeight = `${chatCompose.offsetHeight}px`
      }
    })

    if (chatCompose) observer.observe(chatCompose)
    if (dynamicPadding) observer.observe(dynamicPadding)

    const timeout = setTimeout(() => {
      syncScrollParent()
      startFeed()
      if (!restoreFeedScroll()) {
        scrollToBottom()
      }
    }, 100)

    return () => {
      clearTimeout(timeout)
      if (chatCompose) observer.unobserve(chatCompose)
      if (dynamicPadding) observer.unobserve(dynamicPadding)
      observer.disconnect()
    }
  })

  onDestroy(() => {
    resetFeed()
    element?.removeEventListener("scroll", onScroll)
  })

  beforeNavigate(({from, to}) => {
    if (from?.route.id !== "/spaces/[relay]/git/[id=naddr]/feed") return
    if (typeof sessionStorage === "undefined") return
    if (!element) return

    const nextPath = to?.url.pathname || ""

    if (nextPath.startsWith(basePath)) {
      sessionStorage.setItem(scrollStorageKey, String(element.scrollTop))
    } else {
      sessionStorage.removeItem(scrollStorageKey)
    }
  })
</script>

<svelte:head>
  <title>{repoClass.name} - Feed</title>
</svelte:head>

<div bind:this={container} class="flex min-h-full flex-col">
  <p class="flex h-10 items-center justify-center py-4 text-sm sm:py-8 sm:text-base">
    {#if loadingEvents}
      <Spinner loading={loadingEvents}>Looking for messages...</Spinner>
    {:else if elements.length === 0}
      <span>No activity yet.</span>
    {:else}
      <Spinner>End of message history</Spinner>
    {/if}
  </p>

  {#each elements as {type, id, value, showPubkey} (id)}
    {#if type === "new-messages"}
      <div
        bind:this={newMessages}
        class="flex items-center px-2 py-2 text-xs transition-colors sm:px-4"
        class:opacity-0={showFixedNewMessages}>
        <div class="h-px flex-grow bg-primary"></div>
        <p class="whitespace-nowrap rounded-full bg-primary px-2 py-1 text-center text-primary-content">New Messages</p>
        <div class="h-px flex-grow bg-primary"></div>
      </div>
    {:else if type === "date"}
      <div class="px-2 sm:px-4">
        <Divider>{value}</Divider>
      </div>
    {:else}
      {@const event = $state.snapshot(value as TrustedEvent)}
      <div in:slide class:-mt-1={!showPubkey} class="px-1 sm:px-2 md:px-4">
        {#if event.kind === MESSAGE}
          <ChannelMessage
            url={communityUrl || routeUrl}
            interactionRelays={platformRelays}
            scopeH={communityScope}
            protectInteractions={false}
            {replyTo}
            event={event}
            {showPubkey} />
        {:else}
          <RepoFeedGitItem
            url={routeUrl}
            interactionRelays={platformRelays}
            scopeH={communityScope}
            {replyTo}
            event={event}
            openHref={getOpenHref(event)}
            statusState={statusStateById.get(event.id) || "open"} />
        {/if}
      </div>
    {/if}
  {/each}

  <div bind:this={bottomAnchor}></div>
  <div bind:this={dynamicPadding}></div>
</div>

{#if $pubkey}
  {#if platformRelays.length > 0 && communityScope}
    <div class="chat__compose bg-base-200 px-2 py-2 sm:px-4" bind:this={chatCompose}>
      <div class="max-w-full overflow-hidden">
        {#if parent}
          <RoomComposeParent event={parent} clear={clearParent} verb="Replying to" />
        {/if}
        {#if share}
          <RoomComposeParent event={share} clear={clearShare} verb="Sharing" />
        {/if}
      </div>
      <RoomCompose bind:this={compose} {onSubmit} url={communityUrl} h={communityScope} />
    </div>
  {:else}
    <div class="bg-base-200 px-2 py-3 text-center text-sm text-muted-foreground sm:px-4" bind:this={chatCompose}>
      Community chat is unavailable because no platform relays are configured.
    </div>
  {/if}
{:else}
  <div class="bg-base-200 px-2 py-3 text-center text-sm text-muted-foreground sm:px-4" bind:this={chatCompose}>
    {#if platformRelays.length > 0 && communityScope}
      Sign in to join the conversation
    {:else}
      Community chat is unavailable because no platform relays are configured.
    {/if}
  </div>
{/if}

{#if showScrollButton}
  <div in:fade class="chat__scroll-down right-2 bottom-16 sm:right-4 sm:bottom-20">
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
