<script lang="ts">
  import {goto} from "$app/navigation"
  import {formatTimestamp} from "@welshman/lib"
  import {onMount} from "svelte"
  import {derived} from "svelte/store"
  import Bell from "@assets/icons/bell.svg?dataurl"
  import ArrowRightUp from "@assets/icons/arrow-right-up.svg?dataurl"
  import Bolt from "@assets/icons/bolt.svg?dataurl"
  import Chat from "@assets/icons/chat-round-line.svg?dataurl"
  import Check from "@assets/icons/check.svg?dataurl"
  import Git from "@assets/icons/git.svg?dataurl"
  import Heart from "@assets/icons/heart.svg?dataurl"
  import Mailbox from "@assets/icons/mailbox.svg?dataurl"
  import Magnifier from "@assets/icons/magnifier.svg?dataurl"
  import Reply from "@assets/icons/reply.svg?dataurl"
  import RoundAltArrowDown from "@assets/icons/round-alt-arrow-down.svg?dataurl"
  import UserSpeak from "@assets/icons/user-speak.svg?dataurl"
  import Users from "@assets/icons/users-group-rounded.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import ImageIcon from "@lib/components/ImageIcon.svelte"
  import Button from "@lib/components/Button.svelte"
  import {scrollToEvent} from "@lib/html"
  import ProfileCircle from "@app/components/ProfileCircle.svelte"
  import ProfileDetail from "@app/components/ProfileDetail.svelte"
  import ProfileName from "@app/components/ProfileName.svelte"
  import {deriveBudabitProfileDisplay} from "@app/core/profile-resolver"
  import {clearModals, pushModal} from "@app/util/modal"
  import {markNotificationsRead} from "@app/util/notification-center"
  import {
    loadMoreNotificationHistory,
    NOTIFICATION_HISTORY_ROW_STEP,
    notificationHistorySince,
    resetNotificationHistory,
  } from "@app/util/notification-history"
  import {
    latestNotificationCenterTimestamp,
    notificationCenterRows,
  } from "@app/util/notification-sources"
  import {
    filterNotificationRows,
    getNotificationRowDisplay,
    NOTIFICATION_ROW_FILTERS,
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

  const rowsWithActorNames = derived(notificationCenterRows, ($rows, set) => {
    const actorPubkeys = Array.from(
      new Set($rows.map(row => row.actorPubkey).filter((value): value is string => Boolean(value))),
    )

    if (actorPubkeys.length === 0) {
      set($rows)
      return
    }

    const nameStores = actorPubkeys.map(pubkey => deriveBudabitProfileDisplay(pubkey))

    return derived(nameStores, actorNames => {
      const namesByPubkey = new Map(
        actorPubkeys.map((pubkey, index) => [pubkey, String(actorNames[index] || "").trim()]),
      )

      return $rows.map(row => {
        const actorName = row.actorPubkey ? namesByPubkey.get(row.actorPubkey) : ""

        return actorName && actorName !== row.actorName ? {...row, actorName} : row
      })
    }).subscribe(set)
  }, [] as NotificationRow[])

  const rows = $derived(filterNotificationRows($rowsWithActorNames, {filters: rowFilters, term}))
  const visibleRows = $derived(rows.slice(0, visibleRowLimit))
  const hasMoreLoadedRows = $derived(rows.length > visibleRows.length)
  const canLoadOlderHistory = $derived($notificationHistorySince > 0)
  const loadMoreLabel = $derived(
    hasMoreLoadedRows ? "Show more notifications" : "Load older notifications",
  )

  onMount(() => {
    visibleRowLimit = NOTIFICATION_HISTORY_ROW_STEP
    resetNotificationHistory()
  })

  $effect(() => {
    if ($latestNotificationCenterTimestamp > 0) markNotificationsRead($latestNotificationCenterTimestamp)
  })

  $effect(() => {
    if (expandedRowId && !rows.some(row => row.id === expandedRowId)) expandedRowId = undefined
  })

  const toggleRow = (row: NotificationRow) => {
    expandedRowId = expandedRowId === row.id ? undefined : row.id
  }

  const isExternalPath = (path: string) => /^[a-z][a-z0-9+.-]*:\/\//i.test(path)

  const openNavigationTarget = async (
    event: Event | undefined,
    target: NotificationRowNavigation | NotificationRowDisplaySection,
  ) => {
    event?.preventDefault()
    event?.stopPropagation()

    if (!target.path) return

    clearModals()

    if (isExternalPath(target.path)) {
      window.open(target.path, "_blank", "noopener")
      return
    }

    await goto(target.path)

    if (target.eventId) await scrollToEvent(target.eventId)
  }

  const openProfile = (event: Event, pubkey: string) => {
    event.preventDefault()
    event.stopPropagation()
    pushModal(ProfileDetail, {pubkey})
  }

  const activateRow = (
    event: Event | undefined,
    row: NotificationRow,
    display: ReturnType<typeof getNotificationRowDisplay>,
  ) => {
    if (display.canExpand) {
      event?.preventDefault()
      event?.stopPropagation()
      toggleRow(row)
      return
    }

    void openNavigationTarget(event, display.primaryAction)
  }

  const activateRowFromKeyboard = (
    event: KeyboardEvent,
    row: NotificationRow,
    display: ReturnType<typeof getNotificationRowDisplay>,
  ) => {
    if (event.key !== "Enter" && event.key !== " ") return

    event.preventDefault()
    activateRow(event, row, display)
  }

  const stopKeyboardPropagation = (event: KeyboardEvent) => event.stopPropagation()

  const loadMoreRows = () => {
    visibleRowLimit += NOTIFICATION_HISTORY_ROW_STEP
    loadMoreNotificationHistory()
  }

  const getFilterIcon = (source: NotificationRowFilter) => {
    if (source === "chat") return Chat
    if (source === "git") return Git
    if (source === "community") return Users

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

    return Bell
  }

  const isFilterActive = (source: NotificationRowFilter) => rowFilters.includes(source)
</script>

<div class="flex max-h-[82vh] min-h-[28rem] flex-col gap-4 sm:min-w-[28rem]">
  <header class="px-1">
    <h1 class="text-lg font-semibold leading-none">Notifications</h1>
  </header>

  <div class="grid gap-3">
    <label class="input input-bordered input-sm flex min-w-0 flex-1 items-center gap-2">
      <Icon icon={Magnifier} size={4} />
      <input
        bind:value={term}
        class="min-w-0 grow text-xs placeholder:text-xs"
        type="search"
        placeholder="Search notifications" />
    </label>

    <div class="flex flex-wrap gap-2">
      {#each NOTIFICATION_ROW_FILTERS as option}
        <label
          class="btn btn-xs gap-1.5"
          class:btn-primary={isFilterActive(option.value)}
          class:btn-outline={!isFilterActive(option.value)}>
          <input
            class="sr-only"
            type="checkbox"
            value={option.value}
            bind:group={rowFilters} />
          <Icon icon={getFilterIcon(option.value)} size={3.5} />
          <span>{option.label}</span>
          {#if isFilterActive(option.value)}
            <Icon icon={Check} size={3} />
          {/if}
        </label>
      {/each}
    </div>
  </div>

  <div class="scroll-container -mx-2 min-h-0 flex-1 overflow-auto px-2">
    <div class="grid gap-3 pb-2">
      {#if visibleRows.length > 0}
        <section class="grid gap-2">
          <h2 class="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Activity
          </h2>
          {#each visibleRows as row (row.id)}
            {@const display = getNotificationRowDisplay(row)}
            {@const isExpanded = expandedRowId === row.id}
            <article class="card2 overflow-hidden bg-alt text-left transition-colors hover:bg-base-200">
              <div
                role="button"
                tabindex="0"
                aria-expanded={display.canExpand ? isExpanded : undefined}
                class="flex cursor-pointer items-start gap-2.5 p-3 sm:gap-3"
                onclick={event => activateRow(event, row, display)}
                onkeydown={event => activateRowFromKeyboard(event, row, display)}>
                <div
                  class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-base-200 text-primary">
                  <Icon icon={getTypeIcon(display.type)} size={4.5} />
                </div>

                {#if row.actorPubkey}
                  <Button
                    class="btn btn-ghost btn-circle btn-sm shrink-0 p-0"
                    aria-label="View profile"
                    onkeydown={stopKeyboardPropagation}
                    onclick={event => openProfile(event, row.actorPubkey!)}>
                    <ProfileCircle pubkey={row.actorPubkey} size={8} />
                  </Button>
                {:else}
                  <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-base-200">
                    <ImageIcon alt={display.sourceLabel} src={Bell} size={5} />
                  </div>
                {/if}

                <div class="min-w-0 flex-1">
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                      <div class="flex min-w-0 flex-wrap items-baseline gap-x-1 text-sm leading-snug">
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
                      <div class="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <span class="badge badge-neutral badge-sm">{display.sourceLabel}</span>
                        {#if row.createdAt > 0}
                          <span>{formatTimestamp(row.createdAt)}</span>
                        {/if}
                        {#if row.eventIds && row.eventIds.length > 1}
                          <span>{row.eventIds.length} events</span>
                        {/if}
                      </div>
                    </div>
                    {#if display.canExpand}
                      <Icon
                        icon={RoundAltArrowDown}
                        size={4}
                        class={isExpanded ? "mt-1 rotate-180 transition-transform" : "mt-1 transition-transform"} />
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
                      <article class="rounded-xl border border-base-300 bg-base-100/70 p-3 shadow-sm">
                        <div class="flex items-start justify-between gap-2">
                          <span class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {section.label}
                          </span>
                          {#if section.path}
                            <Button
                              class="btn btn-ghost btn-xs shrink-0 gap-1"
                              aria-label={section.actionLabel || display.primaryAction.label}
                              onkeydown={stopKeyboardPropagation}
                              onclick={event => openNavigationTarget(event, section)}>
                              <Icon icon={ArrowRightUp} size={3} />
                              <span>{section.actionLabel || display.primaryAction.label}</span>
                            </Button>
                          {/if}
                        </div>
                        <p class="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed">
                          {section.preview}
                        </p>
                      </article>
                    {/each}

                    <Button
                      class="btn btn-primary btn-sm justify-center gap-2"
                      aria-label={display.primaryAction.label}
                      onkeydown={stopKeyboardPropagation}
                      onclick={event => openNavigationTarget(event, display.primaryAction)}>
                      <Icon icon={ArrowRightUp} size={3.5} />
                      <span>{display.primaryAction.label}</span>
                    </Button>
                  </div>
                </div>
              {/if}
            </article>
          {/each}
          {#if hasMoreLoadedRows || canLoadOlderHistory}
            <Button class="btn btn-outline btn-sm justify-center" onclick={loadMoreRows}>
              {loadMoreLabel}
            </Button>
          {/if}
        </section>
      {/if}

      {#if visibleRows.length === 0}
        <div class="card2 col-2 items-center bg-alt p-8 text-center">
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
            <Button class="btn btn-outline btn-sm" onclick={loadMoreRows}>Load older notifications</Button>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</div>
