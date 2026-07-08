<script lang="ts">
  import {goto} from "$app/navigation"
  import {formatTimestamp} from "@welshman/lib"
  import Bell from "@assets/icons/bell.svg?dataurl"
  import Check from "@assets/icons/check.svg?dataurl"
  import Filter from "@assets/icons/filter.svg?dataurl"
  import Magnifier from "@assets/icons/magnifier.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import ImageIcon from "@lib/components/ImageIcon.svelte"
  import Button from "@lib/components/Button.svelte"
  import InlinePopover from "@lib/components/InlinePopover.svelte"
  import ModalHeader from "@lib/components/ModalHeader.svelte"
  import ProfileCircle from "@app/components/ProfileCircle.svelte"
  import ProfileName from "@app/components/ProfileName.svelte"
  import {setChecked} from "@app/util/notifications"
  import {clearModals} from "@app/util/modal"
  import {
    markNotificationHistoryIdsRead,
    NOTIFICATION_HISTORY_LIMIT,
    notificationHistory,
    rememberNotificationHistoryIds,
  } from "@app/util/notification-center"
  import {notificationCenterRows} from "@app/util/notification-sources"
  import {
    filterNotificationRows,
    NOTIFICATION_ROW_FILTERS,
    type NotificationRow,
    type NotificationRowFilter,
  } from "@app/util/notification-display"

  let term = $state("")
  let rowFilter = $state<NotificationRowFilter>("all")
  let filterOpen = $state(false)

  const rows = $derived(filterNotificationRows($notificationCenterRows, {filter: rowFilter, term}))
  const unreadRows = $derived(rows.filter(row => !row.read))
  const hasUnread = $derived($notificationCenterRows.some(row => !row.read))

  const getRowEventIds = (rows: NotificationRow[]) =>
    Array.from(new Set(rows.flatMap(row => (row.eventId ? [row.eventId] : []))))

  $effect(() => {
    const knownIds = new Set($notificationHistory.ids)
    const missingIds = getRowEventIds($notificationCenterRows)
      .slice(0, NOTIFICATION_HISTORY_LIMIT)
      .filter(id => !knownIds.has(id))
    if (missingIds.length > 0) rememberNotificationHistoryIds(missingIds)
  })

  const markRowsRead = (rows: NotificationRow[]) => {
    const eventIds = getRowEventIds(rows)
    if (eventIds.length > 0) {
      rememberNotificationHistoryIds(eventIds)
      markNotificationHistoryIdsRead(eventIds)
    }

    for (const path of new Set(rows.map(row => row.readPath).filter(Boolean))) {
      setChecked(path)
    }
  }

  const openRow = (row: NotificationRow) => {
    markRowsRead([row])
    clearModals()
    goto(row.path)
  }
</script>

<div class="flex max-h-[82vh] min-h-[28rem] flex-col gap-4 sm:min-w-[28rem]">
  <ModalHeader>
    {#snippet title()}
      <span class="inline-flex items-center justify-center gap-2">
        <ImageIcon alt="Notifications" src={Bell} size={6} />
        Notifications
      </span>
    {/snippet}
    {#snippet info()}
      {#if hasUnread}
        Review unread activity without clearing it just by opening this modal.
      {:else}
        Your notification history will appear here as events are indexed.
      {/if}
    {/snippet}
  </ModalHeader>

  <div class="flex items-center gap-2">
    <label class="input input-bordered input-sm flex min-w-0 flex-1 items-center gap-2">
      <Icon icon={Magnifier} size={4} />
      <input
        bind:value={term}
        class="min-w-0 grow text-xs placeholder:text-xs"
        type="search"
        placeholder="Search notifications" />
    </label>

    <div class="relative shrink-0">
      <Button
        class="btn btn-neutral btn-square btn-sm"
        aria-label="Filter notifications"
        aria-expanded={filterOpen}
        onclick={() => (filterOpen = !filterOpen)}>
        <Icon icon={Filter} size={4} />
      </Button>
      {#if filterOpen}
        <InlinePopover align="right" widthClass="w-72" onClose={() => (filterOpen = false)}>
          <div class="grid gap-3 text-sm">
            <strong>Show</strong>
            {#each NOTIFICATION_ROW_FILTERS as option}
              <label class="flex items-center gap-2">
                <input
                  class="radio radio-primary radio-sm"
                  type="radio"
                  value={option.value}
                  bind:group={rowFilter} />
                {option.label}
              </label>
            {/each}
          </div>
        </InlinePopover>
      {/if}
    </div>

    <Button
      class="btn btn-neutral btn-sm shrink-0"
      disabled={unreadRows.length === 0}
      onclick={() => markRowsRead(unreadRows)}>
      <Icon icon={Check} size={4} />
      Mark read
    </Button>
  </div>

  <div class="scroll-container -mx-2 min-h-0 flex-1 overflow-auto px-2">
    <div class="grid gap-3 pb-2">
      {#if rows.length > 0}
        <section class="grid gap-2">
          <h2 class="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Activity
          </h2>
          {#each rows as row (row.id)}
            <button
              type="button"
              class="card2 flex items-start gap-3 bg-alt p-3 text-left transition-colors hover:bg-base-200"
              onclick={() => openRow(row)}>
              <div
                class="relative mt-2 h-2 w-2 rounded-full"
                class:bg-primary={!row.read}
                class:bg-base-300={row.read}></div>
              {#if row.actorPubkey}
                <ProfileCircle pubkey={row.actorPubkey} size={8} />
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
                    <span class="badge badge-sm {row.read ? 'badge-neutral' : 'badge-primary'}">
                      {row.read ? "read" : "unread"}
                    </span>
                  </div>
                </div>
                <p class="mt-2 line-clamp-2 text-sm">{row.preview}</p>
                <p class="mt-1 break-all text-xs text-muted-foreground">
                  {row.path}{#if row.createdAt > 0} · {formatTimestamp(row.createdAt)}{/if}
                </p>
              </div>
            </button>
          {/each}
        </section>
      {/if}

      {#if rows.length === 0}
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
        </div>
      {/if}
    </div>
  </div>
</div>
