<script lang="ts">
  import Bell from "@assets/icons/bell.svg?dataurl"
  import Check from "@assets/icons/check.svg?dataurl"
  import Filter from "@assets/icons/filter.svg?dataurl"
  import Magnifier from "@assets/icons/magnifier.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import ImageIcon from "@lib/components/ImageIcon.svelte"
  import Button from "@lib/components/Button.svelte"
  import InlinePopover from "@lib/components/InlinePopover.svelte"
  import ModalHeader from "@lib/components/ModalHeader.svelte"
  import {notifications, setChecked} from "@app/util/notifications"
  import {
    markNotificationHistoryIdsRead,
    notificationHistory,
  } from "@app/util/notification-center"

  type VisibilityFilter = "all" | "unread" | "read"

  let term = $state("")
  let visibilityFilter = $state<VisibilityFilter>("all")
  let filterOpen = $state(false)

  const historyRows = $derived.by(() =>
    $notificationHistory.ids
      .map(id => ({id, read: Boolean($notificationHistory.readAt[id])}))
      .filter(row => {
        if (visibilityFilter === "unread" && row.read) return false
        if (visibilityFilter === "read" && !row.read) return false
        if (term.trim() && !row.id.toLowerCase().includes(term.trim().toLowerCase())) return false

        return true
      }),
  )
  const unreadPaths = $derived.by(() => Array.from($notifications).sort())
  const pathRows = $derived.by(() =>
    unreadPaths.filter(path => !term.trim() || path.toLowerCase().includes(term.trim().toLowerCase())),
  )
  const unreadHistoryCount = $derived(
    $notificationHistory.ids.filter(id => !$notificationHistory.readAt[id]).length,
  )
  const hasUnread = $derived(unreadHistoryCount > 0 || unreadPaths.length > 0)

  const markVisibleHistoryRead = () => {
    markNotificationHistoryIdsRead(historyRows.map(row => row.id))
  }

  const markPathRead = (path: string) => {
    setChecked(path)
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
            <label class="flex items-center gap-2">
              <input class="radio radio-primary radio-sm" type="radio" value="all" bind:group={visibilityFilter} />
              All notifications
            </label>
            <label class="flex items-center gap-2">
              <input
                class="radio radio-primary radio-sm"
                type="radio"
                value="unread"
                bind:group={visibilityFilter} />
              Unread only
            </label>
            <label class="flex items-center gap-2">
              <input class="radio radio-primary radio-sm" type="radio" value="read" bind:group={visibilityFilter} />
              Read only
            </label>
            <p class="text-xs text-muted-foreground">
              Source filters arrive with the event-backed rows in the next phase.
            </p>
          </div>
        </InlinePopover>
      {/if}
    </div>

    <Button
      class="btn btn-neutral btn-sm shrink-0"
      disabled={historyRows.length === 0}
      onclick={markVisibleHistoryRead}>
      <Icon icon={Check} size={4} />
      Mark read
    </Button>
  </div>

  <div class="scroll-container -mx-2 min-h-0 flex-1 overflow-auto px-2">
    <div class="grid gap-3 pb-2">
      {#if historyRows.length > 0}
        <section class="grid gap-2">
          <h2 class="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Event history
          </h2>
          {#each historyRows as row (row.id)}
            <button
              type="button"
              class="card2 flex items-start gap-3 bg-alt p-3 text-left transition-colors hover:bg-base-200"
              onclick={() => markNotificationHistoryIdsRead([row.id])}>
              <div class="relative mt-1 h-2 w-2 rounded-full" class:bg-primary={!row.read} class:bg-base-300={row.read}></div>
              <div class="min-w-0 flex-1">
                <div class="flex items-center justify-between gap-2">
                  <strong class="truncate text-sm">Event notification</strong>
                  <span class="badge badge-sm {row.read ? 'badge-neutral' : 'badge-primary'}">
                    {row.read ? "read" : "unread"}
                  </span>
                </div>
                <p class="mt-1 break-all text-xs text-muted-foreground">{row.id}</p>
              </div>
            </button>
          {/each}
        </section>
      {/if}

      {#if pathRows.length > 0 && visibilityFilter !== "read"}
        <section class="grid gap-2">
          <h2 class="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Current unread places
          </h2>
          {#each pathRows as path (path)}
            <button
              type="button"
              class="card2 flex items-start gap-3 bg-alt p-3 text-left transition-colors hover:bg-base-200"
              onclick={() => markPathRead(path)}>
              <div class="mt-1 h-2 w-2 rounded-full bg-primary"></div>
              <div class="min-w-0 flex-1">
                <div class="flex items-center justify-between gap-2">
                  <strong class="truncate text-sm">Unread activity</strong>
                  <span class="badge badge-primary badge-sm">unread</span>
                </div>
                <p class="mt-1 break-all text-xs text-muted-foreground">{path}</p>
              </div>
            </button>
          {/each}
        </section>
      {/if}

      {#if historyRows.length === 0 && (visibilityFilter === "read" || pathRows.length === 0)}
        <div class="card2 col-2 items-center bg-alt p-8 text-center">
          <ImageIcon alt="Notifications" src={Bell} size={10} />
          <strong>No notifications found</strong>
          <p class="max-w-sm text-sm text-muted-foreground">
            {#if term.trim()}
              Try a different search or filter.
            {:else if visibilityFilter === "read"}
              Read notification history will appear here after event-backed rows are indexed.
            {:else}
              Event-backed notification history will be connected in the next phase.
            {/if}
          </p>
        </div>
      {/if}
    </div>
  </div>
</div>
