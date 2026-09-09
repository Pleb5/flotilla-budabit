<style>
  :global(.notification-event-content *) {
    max-width: 100%;
  }

  :global(.notification-event-content .event-renderer) {
    min-width: 0;
    overflow-x: auto;
  }
</style>

<script lang="ts">
  import {goto} from "$app/navigation"
  import {pubkey} from "@welshman/app"
  import {formatTimestamp} from "@welshman/lib"
  import {onDestroy, onMount, tick, untrack} from "svelte"
  import Bell from "@assets/icons/bell.svg?dataurl"
  import ArrowRightUp from "@assets/icons/arrow-right-up.svg?dataurl"
  import Bolt from "@assets/icons/bolt.svg?dataurl"
  import Chat from "@assets/icons/chat-round-line.svg?dataurl"
  import Check from "@assets/icons/check.svg?dataurl"
  import Close from "@assets/icons/close.svg?dataurl"
  import Git from "@assets/icons/git.svg?dataurl"
  import Heart from "@assets/icons/heart.svg?dataurl"
  import Mailbox from "@assets/icons/mailbox.svg?dataurl"
  import Magnifier from "@assets/icons/magnifier.svg?dataurl"
  import Reply from "@assets/icons/reply.svg?dataurl"
  import Refresh from "@assets/icons/refresh-circle.svg?dataurl"
  import RoundAltArrowDown from "@assets/icons/round-alt-arrow-down.svg?dataurl"
  import UserSpeak from "@assets/icons/user-speak.svg?dataurl"
  import Users from "@assets/icons/users-group-rounded.svg?dataurl"
  import Widget from "@assets/icons/widget.svg?dataurl"
  import Settings from "@assets/icons/settings.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import ImageIcon from "@lib/components/ImageIcon.svelte"
  import Button from "@lib/components/Button.svelte"
  import ProfileCircle from "@app/components/ProfileCircle.svelte"
  import ProfileDetail from "@app/components/ProfileDetail.svelte"
  import ProfileName from "@app/components/ProfileName.svelte"
  import NoteContent from "@app/components/NoteContent.svelte"
  import NotificationDmContent from "@app/components/NotificationDmContent.svelte"
  import PublicationRecoveryList from "@app/components/PublicationRecoveryList.svelte"
  import {deriveBudabitProfileDisplay} from "@app/core/profile-resolver"
  import {DM_KIND} from "@app/core/state"
  import {
    publicationOperationsNeedingAttention,
    recoverablePublicationOperations,
  } from "@app/core/publication-operations"
  import {clearModals, closeTopModal, pushModal, retainTopModal} from "@app/util/modal"
  import {goToEventIdPath} from "@app/util/routes"
  import {
    getNotificationNavigationKey,
    navigateNotificationTarget,
  } from "@app/util/notification-navigation"
  import {
    getUnreadNotificationRowIdsState,
    markNotificationRowsRead,
    notificationCenterOpen,
    notificationReadState,
    setNotificationUnreadHint,
  } from "@app/util/notification-center"
  import {
    loadMoreNotificationHistory,
    NOTIFICATION_HISTORY_ROW_STEP,
    notificationHistoryCanLoadMore,
    resetNotificationHistory,
  } from "@app/util/notification-history"
  import {setCheckedAtMany} from "@app/util/notifications"
  import {notificationCenterRows} from "@app/util/notification-sources"
  import {
    filterNotificationRows,
    getNotificationRowDisplay,
    NOTIFICATION_ROW_FILTERS,
    sortNotificationRows,
    type NotificationRow,
    type NotificationRowDisplaySection,
    type NotificationRowFilter,
    type NotificationRowNavigation,
    type NotificationRowType,
  } from "@app/util/notification-display"

  let term = $state("")
  let rowFilters = $state<NotificationRowFilter[]>([])
  let visibleRowLimit = $state(NOTIFICATION_HISTORY_ROW_STEP)
  let expandedRowId = $state<string | undefined>()
  let loadMoreHistoryPending = $state(false)
  let loadMoreHistoryRowCount = $state(0)
  let loadMoreHistoryTimeout: ReturnType<typeof setTimeout> | undefined
  let pendingNavigationKey = $state("")
  let sessionInitialized = $state(false)
  let sessionNewById = $state<Record<string, true>>({})
  const knownRowIds = new Set<string>()

  let actorNamesByPubkey = $state<Record<string, string>>({})
  const filteredRows = $derived(
    filterNotificationRows($notificationCenterRows, {filters: rowFilters, term}),
  )
  const sessionNewRowIds = $derived(new Set(Object.keys(sessionNewById)))
  const newRows = $derived(
    sortNotificationRows(filteredRows.filter(row => sessionNewRowIds.has(row.id))),
  )
  const activityRows = $derived(filteredRows.filter(row => !sessionNewRowIds.has(row.id)))
  const visibleNewRows = $derived(newRows.slice(0, visibleRowLimit))
  const visibleActivityRows = $derived(
    activityRows.slice(0, Math.max(0, visibleRowLimit - visibleNewRows.length)),
  )
  const visibleRowsWithoutActorNames = $derived([...visibleNewRows, ...visibleActivityRows])
  const visibleRows = $derived(
    visibleRowsWithoutActorNames.map(row => {
      const actorName = row.actorPubkey ? actorNamesByPubkey[row.actorPubkey] : ""
      return actorName && actorName !== row.actorName ? {...row, actorName} : row
    }),
  )
  const visibleNewRowCount = $derived(visibleNewRows.length)
  const hasMoreLoadedRows = $derived(filteredRows.length > visibleRows.length)
  const unreadSessionRows = $derived.by(() => {
    const unreadIds = new Set(
      getUnreadNotificationRowIdsState(
        $notificationReadState,
        $pubkey || undefined,
        $notificationCenterRows.filter(row => sessionNewRowIds.has(row.id)).map(row => row.id),
      ),
    )

    return $notificationCenterRows.filter(row => unreadIds.has(row.id))
  })
  const hiddenNewCountBySource = $derived.by(() => {
    if (rowFilters.length === 0) return {} as Partial<Record<NotificationRowFilter, number>>

    return Object.fromEntries(
      NOTIFICATION_ROW_FILTERS.map(({value}) => [
        value,
        rowFilters.includes(value)
          ? 0
          : unreadSessionRows.filter(row => row.source === value).length,
      ]),
    ) as Partial<Record<NotificationRowFilter, number>>
  })
  const searchHiddenNewCount = $derived.by(() => {
    if (!term.trim()) return 0
    const sourceRows = filterNotificationRows(unreadSessionRows, {filters: rowFilters})
    const matchingRows = filterNotificationRows(sourceRows, {term})

    return sourceRows.length - matchingRows.length
  })
  const canLoadOlderHistory = $derived($notificationHistoryCanLoadMore)
  const loadMoreLabel = $derived(loadMoreHistoryPending ? "Loading..." : "Load more")
  const navigationPending = $derived(Boolean(pendingNavigationKey))
  const publicationOperationCount = $derived($recoverablePublicationOperations.length)
  const publicationAttentionCount = $derived($publicationOperationsNeedingAttention.length)
  const notificationSettingsTarget: NotificationRowNavigation = {
    label: "Notification settings",
    path: "/settings/notifications",
  }

  const clearLoadMoreHistoryPending = () => {
    loadMoreHistoryPending = false
    if (loadMoreHistoryTimeout) clearTimeout(loadMoreHistoryTimeout)
    loadMoreHistoryTimeout = undefined
  }

  onMount(() => {
    visibleRowLimit = NOTIFICATION_HISTORY_ROW_STEP
    resetNotificationHistory()

    for (const row of $notificationCenterRows) knownRowIds.add(row.id)
    const unreadIds = new Set(
      getUnreadNotificationRowIdsState(
        $notificationReadState,
        $pubkey || undefined,
        $notificationCenterRows.map(row => row.id),
      ),
    )
    sessionNewById = Object.fromEntries(
      $notificationCenterRows
        .filter(row => unreadIds.has(row.id))
        .map(row => [row.id, true] as const),
    )
    sessionInitialized = true
  })

  onDestroy(() => {
    if (loadMoreHistoryTimeout) clearTimeout(loadMoreHistoryTimeout)
  })

  $effect(() => {
    if (!sessionInitialized || !$notificationCenterOpen) return

    const allUnreadIds = getUnreadNotificationRowIdsState(
      $notificationReadState,
      $pubkey || undefined,
      $notificationCenterRows.map(row => row.id),
    )
    setNotificationUnreadHint($pubkey || undefined, allUnreadIds.length > 0)

    const additions = $notificationCenterRows.filter(row => !knownRowIds.has(row.id))
    additions.forEach(row => knownRowIds.add(row.id))

    const unreadAdditionIds = new Set(
      getUnreadNotificationRowIdsState(
        $notificationReadState,
        $pubkey || undefined,
        additions.map(row => row.id),
      ),
    )
    if (unreadAdditionIds.size > 0) {
      sessionNewById = {
        ...sessionNewById,
        ...Object.fromEntries(
          additions
            .filter(row => unreadAdditionIds.has(row.id))
            .map(row => [row.id, true] as const),
        ),
      }
    }

    const visibleUnreadIds = new Set(
      getUnreadNotificationRowIdsState(
        $notificationReadState,
        $pubkey || undefined,
        visibleRowsWithoutActorNames.map(row => row.id),
      ),
    )
    if (visibleUnreadIds.size > 0) {
      const visibleUnreadRows = visibleRowsWithoutActorNames.filter(row =>
        visibleUnreadIds.has(row.id),
      )
      markNotificationRowsRead(
        $pubkey || undefined,
        visibleUnreadRows.map(row => row.id),
      )
    }
    setCheckedAtMany(
      visibleRowsWithoutActorNames.map(row => [row.readPath, row.createdAt] as const),
    )
  })

  $effect(() => {
    if (expandedRowId && !filteredRows.some(row => row.id === expandedRowId))
      expandedRowId = undefined
  })

  $effect(() => {
    if (loadMoreHistoryPending && filteredRows.length > loadMoreHistoryRowCount) {
      clearLoadMoreHistoryPending()
    }
  })

  $effect(() => {
    const actorPubkeys = Array.from(
      new Set(
        visibleRowsWithoutActorNames
          .map(row => row.actorPubkey)
          .filter((value): value is string => Boolean(value)),
      ),
    )
    actorNamesByPubkey = {}
    const unsubscribers = actorPubkeys.map(pubkey =>
      deriveBudabitProfileDisplay(pubkey).subscribe(actorName => {
        const normalized = String(actorName || "").trim()
        if (normalized) {
          actorNamesByPubkey = untrack(() => ({...actorNamesByPubkey, [pubkey]: normalized}))
        }
      }),
    )

    return () => unsubscribers.forEach(unsubscribe => unsubscribe())
  })

  const toggleRow = (row: NotificationRow) => {
    expandedRowId = expandedRowId === row.id ? undefined : row.id
  }

  const isNavigationPending = (target: NotificationRowNavigation | NotificationRowDisplaySection) =>
    pendingNavigationKey === getNotificationNavigationKey(target)

  const waitForNavigationIntentPaint = async () => {
    await tick()
    if (typeof requestAnimationFrame !== "function") return
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  }

  const scrollDestinationToTop = async () => {
    await tick()
    if (typeof requestAnimationFrame === "function") {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    }

    for (const element of document.querySelectorAll<HTMLElement>(
      '[data-component="PageContent"], [data-component="Page"]',
    )) {
      element.scrollTo({top: 0, left: 0, behavior: "auto"})
    }

    document.scrollingElement?.scrollTo({top: 0, left: 0, behavior: "auto"})
    window.scrollTo({top: 0, left: 0, behavior: "auto"})
  }

  const openNavigationTarget = async (
    event: Event | undefined,
    target: NotificationRowNavigation | NotificationRowDisplaySection,
  ) => {
    event?.preventDefault()
    event?.stopPropagation()

    if (!target.path) return
    if (navigationPending) return

    const navigationKey = getNotificationNavigationKey(target)
    pendingNavigationKey = navigationKey

    try {
      await navigateNotificationTarget(target, {
        goto,
        goToEventIdPath,
        openExternal: path => window.open(path, "_blank", "noopener,noreferrer"),
        waitForIntentPaint: waitForNavigationIntentPaint,
        scrollToTop: scrollDestinationToTop,
        retainModal: retainTopModal,
        clearModals,
      })
    } catch (error) {
      if (pendingNavigationKey === navigationKey) pendingNavigationKey = ""
      console.error("[NotificationsModal] Failed to navigate to notification target", error)
    }
  }

  const openProfile = (event: Event, pubkey: string) => {
    event.preventDefault()
    event.stopPropagation()
    if (navigationPending) return
    pushModal(ProfileDetail, {pubkey})
  }

  const activateRow = (
    event: Event | undefined,
    display: ReturnType<typeof getNotificationRowDisplay>,
  ) => {
    if (navigationPending) {
      event?.preventDefault()
      event?.stopPropagation()
      return
    }

    void openNavigationTarget(event, display.primaryAction)
  }

  const activateRowFromKeyboard = (
    event: KeyboardEvent,
    display: ReturnType<typeof getNotificationRowDisplay>,
  ) => {
    if (event.key !== "Enter" && event.key !== " ") return

    event.preventDefault()
    activateRow(event, display)
  }

  const stopKeyboardPropagation = (event: KeyboardEvent) => event.stopPropagation()

  const toggleRowFromControl = (event: Event, row: NotificationRow) => {
    event.preventDefault()
    event.stopPropagation()
    if (!navigationPending) toggleRow(row)
  }

  const loadMoreRows = () => {
    if (loadMoreHistoryPending) return

    visibleRowLimit += NOTIFICATION_HISTORY_ROW_STEP
    if (!hasMoreLoadedRows && canLoadOlderHistory) {
      loadMoreHistoryRowCount = filteredRows.length
      loadMoreHistoryPending = true
      loadMoreNotificationHistory()

      if (loadMoreHistoryTimeout) clearTimeout(loadMoreHistoryTimeout)
      loadMoreHistoryTimeout = setTimeout(clearLoadMoreHistoryPending, 5000)
    }
  }

  const getFilterIcon = (source: NotificationRowFilter) => {
    if (source === "chat") return Chat
    if (source === "git") return Git
    if (source === "community") return Users
    if (source === "widget") return Widget

    return Bell
  }

  const getTypeIcon = (type: NotificationRowType) => {
    if (type === "chat") return Mailbox
    if (type === "reply") return Reply
    if (type === "mention") return UserSpeak
    if (type === "reaction") return Heart
    if (type === "zap") return Bolt
    if (type === "repo") return Git
    if (type === "community") return Users
    if (type === "widget") return Widget

    return Bell
  }

  const getSectionIcon = (
    section: NotificationRowDisplaySection,
    display: ReturnType<typeof getNotificationRowDisplay>,
  ) => {
    if (section.eventId === display.primaryAction.eventId) return getTypeIcon(display.type)

    return Bell
  }

  const isFilterActive = (source: NotificationRowFilter) => rowFilters.includes(source)

  const openPublicationRecovery = () => pushModal(PublicationRecoveryList)

  const openNotificationSettings = (event: Event) =>
    openNavigationTarget(event, notificationSettingsTarget)
</script>

<div class="flex min-h-0 min-w-0 flex-1 flex-col gap-4" aria-busy={navigationPending}>
  <header class="flex shrink-0 items-center justify-between gap-3">
    <Button
      class="btn btn-square btn-ghost h-11 min-h-11 w-11 shrink-0"
      aria-label="Close notifications"
      data-modal-initial-focus
      disabled={navigationPending}
      onclick={closeTopModal}>
      <Icon icon={Close} size={7} />
    </Button>
    <!-- Keep drag touch-action off the close and settings buttons. -->
    <h1
      data-swipe-dismiss-handle
      class="flex min-w-0 flex-1 items-center justify-center self-stretch text-lg font-semibold leading-none">
      Notifications
    </h1>
    <Button
      class="btn btn-square btn-ghost h-11 min-h-11 w-11 shrink-0"
      aria-label="Notification settings"
      data-tip="Notification settings"
      disabled={navigationPending}
      onclick={openNotificationSettings}>
      {#if isNavigationPending(notificationSettingsTarget)}
        <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
        <span class="sr-only">Opening notification settings</span>
      {:else}
        <Icon icon={Settings} size={4.5} />
      {/if}
    </Button>
  </header>

  <div class="grid shrink-0 gap-3">
    <label class="input input-sm input-bordered flex min-w-0 flex-1 items-center gap-2">
      <Icon icon={Magnifier} size={4} />
      <input
        bind:value={term}
        class="min-w-0 grow text-xs placeholder:text-xs"
        type="search"
        placeholder="Search notifications" />
    </label>

    <div class="flex flex-wrap gap-2">
      {#each NOTIFICATION_ROW_FILTERS as option}
        {@const hiddenNewCount = hiddenNewCountBySource[option.value] || 0}
        <label
          class="btn btn-xs gap-1.5"
          class:btn-primary={isFilterActive(option.value)}
          class:btn-outline={!isFilterActive(option.value)}>
          <input class="sr-only" type="checkbox" value={option.value} bind:group={rowFilters} />
          <Icon icon={getFilterIcon(option.value)} size={3.5} />
          <span>{option.label}</span>
          {#if hiddenNewCount > 0}
            <span class="badge badge-sm">{hiddenNewCount}</span>
          {/if}
          {#if isFilterActive(option.value)}
            <Icon icon={Check} size={3} />
          {/if}
        </label>
      {/each}
      <Button
        class="btn btn-xs gap-1.5 {publicationAttentionCount > 0 ? 'btn-warning' : 'btn-outline'}"
        aria-label={`Open publication recovery${publicationOperationCount > 0 ? ` with ${publicationOperationCount} item${publicationOperationCount === 1 ? "" : "s"}` : ""}`}
        onclick={openPublicationRecovery}>
        <Icon icon={Refresh} size={3.5} />
        <span>Publications</span>
        {#if publicationOperationCount > 0}
          <span class="badge badge-sm">{publicationOperationCount}</span>
        {/if}
        <Icon icon={ArrowRightUp} size={3} />
      </Button>
    </div>
    {#if searchHiddenNewCount > 0}
      <div class="flex items-center justify-between gap-3 px-1 text-xs text-muted-foreground">
        <span>
          {searchHiddenNewCount} new {searchHiddenNewCount === 1
            ? "notification doesn't"
            : "notifications don't"}
          match your search
        </span>
        <button class="link shrink-0 font-medium" type="button" onclick={() => (term = "")}>
          Clear search
        </button>
      </div>
    {/if}
  </div>

  <div
    data-testid="notification-list"
    class="scroll-container -mx-2 min-h-0 flex-1 overflow-auto overscroll-contain px-2">
    <div class="grid gap-3 pb-2">
      {#if visibleRows.length > 0}
        <section class="grid gap-2">
          <h2 class="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {visibleNewRowCount > 0 ? "New" : "Activity"}
          </h2>
          {#each visibleRows as row, index (row.id)}
            {#if visibleNewRowCount > 0 && index === visibleNewRowCount && visibleActivityRows.length > 0}
              <h2
                class="mt-1 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Activity
              </h2>
            {/if}
            {@const display = getNotificationRowDisplay(row)}
            {@const isExpanded = expandedRowId === row.id}
            {@const rowNavigating = isNavigationPending(display.primaryAction)}
            <article
              class="card2 bg-alt overflow-hidden text-left transition-colors hover:bg-base-200 {rowNavigating
                ? 'cursor-wait ring-2 ring-primary/40'
                : ''}">
              <div
                role="button"
                tabindex="0"
                aria-busy={rowNavigating}
                aria-disabled={navigationPending}
                class="flex items-start gap-2.5 p-3 sm:gap-3 {navigationPending
                  ? 'cursor-wait'
                  : 'cursor-pointer'}"
                onclick={event => activateRow(event, display)}
                onkeydown={event => activateRowFromKeyboard(event, display)}>
                <div
                  class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-base-200 text-primary">
                  <Icon icon={getTypeIcon(display.type)} size={4.5} />
                </div>

                {#if row.actorPubkey}
                  <Button
                    class="btn btn-circle btn-ghost btn-sm shrink-0 p-0"
                    aria-label="View profile"
                    disabled={navigationPending}
                    onkeydown={stopKeyboardPropagation}
                    onclick={event => openProfile(event, row.actorPubkey!)}>
                    <ProfileCircle pubkey={row.actorPubkey} size={8} />
                  </Button>
                {:else}
                  <div
                    class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-base-200">
                    <ImageIcon alt={display.sourceLabel} src={Bell} size={5} />
                  </div>
                {/if}

                <div class="min-w-0 flex-1">
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                      <div
                        class="flex min-w-0 flex-wrap items-baseline gap-x-1 text-sm leading-snug">
                        {#if row.actorPubkey}
                          <strong class="max-w-[9rem] truncate sm:max-w-[12rem]">
                            <ProfileName pubkey={row.actorPubkey} />
                          </strong>
                          <span class="text-muted-foreground">{display.action}</span>
                          <span class="truncate text-muted-foreground">{display.context}</span>
                        {:else}
                          <strong class="truncate">{display.title}</strong>
                          <span class="text-muted-foreground">{display.action}</span>
                        {/if}
                      </div>
                      <p class="mt-1 line-clamp-1 text-sm text-foreground">{display.preview}</p>
                      <div
                        class="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        {#if row.createdAt > 0}
                          <span>{formatTimestamp(row.createdAt)}</span>
                        {/if}
                        {#if row.eventIds && row.eventIds.length > 1}
                          <span>{row.eventIds.length} events</span>
                        {/if}
                      </div>
                    </div>
                    {#if rowNavigating}
                      <span
                        class="mt-1 flex shrink-0 items-center gap-1.5 text-xs font-medium text-primary">
                        <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
                        <span class="hidden sm:inline">Opening...</span>
                        <span class="sr-only sm:hidden">Opening notification</span>
                      </span>
                    {:else if display.canExpand}
                      <Button
                        class="btn btn-circle btn-ghost btn-xs shrink-0"
                        aria-label={isExpanded
                          ? "Collapse notification details"
                          : "Expand notification details"}
                        aria-expanded={isExpanded}
                        disabled={navigationPending}
                        onkeydown={stopKeyboardPropagation}
                        onclick={event => toggleRowFromControl(event, row)}>
                        <Icon
                          icon={RoundAltArrowDown}
                          size={4}
                          class={isExpanded
                            ? "rotate-180 transition-transform"
                            : "transition-transform"} />
                      </Button>
                    {:else}
                      <Icon icon={ArrowRightUp} size={3.5} class="mt-1 text-muted-foreground" />
                    {/if}
                  </div>
                </div>
              </div>

              {#if isExpanded}
                <div class="border-t border-base-300/70 px-3 pb-3 pt-2">
                  <div class="grid gap-2 sm:ml-[5.5rem]">
                    {#each display.sections as section}
                      {@const sectionNavigating = isNavigationPending(section)}
                      <article
                        class="min-w-0 overflow-hidden rounded-xl border border-base-300 bg-base-100/70 p-3 shadow-sm">
                        <div class="flex items-start justify-between gap-2">
                          <div class="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                            {#if section.event?.pubkey}
                              <ProfileCircle pubkey={section.event.pubkey} size={5} />
                            {:else}
                              <Icon icon={getSectionIcon(section, display)} size={3.5} />
                            {/if}
                          </div>
                          {#if section.path}
                            <Button
                              class="btn btn-ghost btn-xs shrink-0 gap-1"
                              aria-label={section.actionLabel || display.primaryAction.label}
                              disabled={navigationPending}
                              onkeydown={stopKeyboardPropagation}
                              onclick={event => openNavigationTarget(event, section)}>
                              {#if sectionNavigating}
                                <span class="loading loading-spinner loading-xs" aria-hidden="true"
                                ></span>
                                <span>Opening...</span>
                              {:else}
                                <Icon icon={ArrowRightUp} size={3} />
                                <span>Open</span>
                              {/if}
                            </Button>
                          {/if}
                        </div>
                        {#if section.event}
                          <div
                            class="notification-event-content mt-2 min-w-0 max-w-full overflow-hidden text-sm leading-relaxed">
                            {#if section.event.kind === DM_KIND}
                              <NotificationDmContent event={section.event} />
                            {:else}
                              <NoteContent
                                event={section.event}
                                showEntire={true}
                                expandMode="inline"
                                minimalQuote={true} />
                            {/if}
                          </div>
                        {:else}
                          <p class="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed">
                            {section.preview}
                          </p>
                        {/if}
                      </article>
                    {/each}
                  </div>
                </div>
              {/if}
            </article>
          {/each}
          {#if hasMoreLoadedRows || canLoadOlderHistory}
            <Button
              class="btn btn-outline btn-sm justify-center gap-2"
              disabled={loadMoreHistoryPending}
              onclick={loadMoreRows}>
              {#if loadMoreHistoryPending}
                <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
              {/if}
              {loadMoreLabel}
            </Button>
          {/if}
        </section>
      {/if}

      {#if visibleRows.length === 0}
        <div class="card2 col-2 bg-alt items-center p-8 text-center">
          <ImageIcon alt="Notifications" src={Bell} size={10} />
          <strong>No notifications found</strong>
          <p class="max-w-sm text-sm text-muted-foreground">
            {#if term.trim()}
              Try a different search or filter.
            {:else}
              Event-backed notification history will appear here as activity is indexed.
            {/if}
          </p>
          {#if canLoadOlderHistory}
            <Button
              class="btn btn-outline btn-sm gap-2"
              disabled={loadMoreHistoryPending}
              onclick={loadMoreRows}>
              {#if loadMoreHistoryPending}
                <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
              {/if}
              {loadMoreLabel}
            </Button>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</div>
