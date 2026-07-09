<script lang="ts">
  import {goto} from "$app/navigation"
  import {formatTimestamp} from "@welshman/lib"
  import {onMount} from "svelte"
  import {derived} from "svelte/store"
  import Bell from "@assets/icons/bell.svg?dataurl"
  import Chat from "@assets/icons/chat-round-line.svg?dataurl"
  import Check from "@assets/icons/check.svg?dataurl"
  import Git from "@assets/icons/git.svg?dataurl"
  import Magnifier from "@assets/icons/magnifier.svg?dataurl"
  import Users from "@assets/icons/users-group-rounded.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import ImageIcon from "@lib/components/ImageIcon.svelte"
  import Button from "@lib/components/Button.svelte"
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
    NOTIFICATION_ROW_FILTERS,
    type NotificationRow,
    type NotificationRowFilter,
  } from "@app/util/notification-display"

  let term = $state("")
  let rowFilters = $state<NotificationRowFilter[]>([])
  let visibleRowLimit = $state(NOTIFICATION_HISTORY_ROW_STEP)

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

  const openRow = (row: NotificationRow) => {
    clearModals()
    goto(row.path)
  }

  const openProfile = (event: Event, pubkey: string) => {
    event.preventDefault()
    event.stopPropagation()
    pushModal(ProfileDetail, {pubkey})
  }

  const openRowFromKeyboard = (event: KeyboardEvent, row: NotificationRow) => {
    if (event.key !== "Enter" && event.key !== " ") return

    event.preventDefault()
    openRow(row)
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
            <div
              role="button"
              tabindex="0"
              class="card2 flex items-start gap-3 bg-alt p-3 text-left transition-colors hover:bg-base-200"
              onclick={() => openRow(row)}
              onkeydown={event => openRowFromKeyboard(event, row)}>
              {#if row.actorPubkey}
                <Button
                  class="btn btn-ghost btn-circle btn-sm shrink-0 p-0"
                  aria-label="View profile"
                  onkeydown={stopKeyboardPropagation}
                  onclick={event => openProfile(event, row.actorPubkey!)}>
                  <ProfileCircle pubkey={row.actorPubkey} size={8} />
                </Button>
              {:else}
                <div class="flex h-8 w-8 items-center justify-center rounded-full bg-base-200">
                  <ImageIcon alt={row.sourceLabel} src={Bell} size={5} />
                </div>
              {/if}
              <div class="min-w-0 flex-1">
                <div class="flex items-center justify-between gap-2">
                  <div class="min-w-0">
                    <strong class="block truncate text-sm">{row.title}</strong>
                    {#if row.actorPubkey}
                      <span class="block truncate text-xs text-muted-foreground">
                        From <ProfileName pubkey={row.actorPubkey} />
                      </span>
                    {/if}
                  </div>
                  <div class="flex shrink-0 items-center gap-1">
                    <span class="badge badge-neutral badge-sm">{row.sourceLabel}</span>
                  </div>
                </div>
                <p class="mt-2 line-clamp-2 text-sm">{row.preview}</p>
                {#if row.createdAt > 0}
                  <p class="mt-1 text-xs text-muted-foreground">{formatTimestamp(row.createdAt)}</p>
                {/if}
              </div>
            </div>
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
