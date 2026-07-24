<script lang="ts">
  import type {IssueEvent} from "@nostr-git/core/events"
  import {formatTimestampRelative} from "@welshman/lib"
  import {getTagValue} from "@welshman/util"
  import {CircleCheck, CircleDot, FileCode, MessageCircle, XCircle} from "@lucide/svelte"
  import ProfileName from "@app/components/ProfileName.svelte"

  type Props = {
    event: IssueEvent
    status?: string
    commentCount?: number
    labels?: string[]
    profileRelays?: string[]
  }

  const {
    event,
    status = "open",
    commentCount = 0,
    labels = [],
    profileRelays = [],
  }: Props = $props()

  const title = $derived(getTagValue("subject", event.tags) || "No title")
  const visibleLabels = $derived(labels.slice(0, 3))
  const hiddenLabelCount = $derived(Math.max(0, labels.length - visibleLabels.length))
  const statusLabel = $derived(status.charAt(0).toUpperCase() + status.slice(1))
  const displayCreatedAt = $derived.by(() => {
    const originalDate = getTagValue("original_date", event.tags)
    const timestamp = Number(originalDate)

    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : event.created_at
  })
</script>

<div class="flex min-w-0 items-start gap-2.5 px-3 py-2.5 sm:px-4">
  <span class="mt-0.5 shrink-0" title={statusLabel}>
    {#if status === "resolved"}
      <CircleCheck class="h-4 w-4 text-sky-700 dark:text-sky-300" aria-label={statusLabel} />
    {:else if status === "closed"}
      <XCircle class="h-4 w-4 text-rose-700 dark:text-rose-300" aria-label={statusLabel} />
    {:else if status === "draft"}
      <FileCode class="h-4 w-4 text-amber-700 dark:text-amber-300" aria-label={statusLabel} />
    {:else}
      <CircleDot class="h-4 w-4 text-emerald-700 dark:text-emerald-300" aria-label={statusLabel} />
    {/if}
  </span>

  <div class="min-w-0 flex-1">
    <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
      <h3
        class="min-w-0 break-words text-sm font-semibold leading-5 text-foreground sm:text-[15px]">
        {title}
      </h3>
      {#each visibleLabels as label (label)}
        <span
          class="max-w-40 truncate rounded-full border border-border bg-muted/60 px-1.5 py-px text-[11px] leading-4 text-muted-foreground">
          {label}
        </span>
      {/each}
      {#if hiddenLabelCount > 0}
        <span class="text-[11px] text-muted-foreground">+{hiddenLabelCount}</span>
      {/if}
    </div>

    <div class="mt-0.5 truncate text-xs text-muted-foreground">
      Opened {formatTimestampRelative(displayCreatedAt)} by
      <ProfileName pubkey={event.pubkey} relays={profileRelays} />
    </div>
  </div>

  <span
    class="mt-0.5 flex min-w-7 shrink-0 items-center justify-end gap-1 text-xs text-muted-foreground"
    title={`${commentCount} ${commentCount === 1 ? "comment" : "comments"}`}
    aria-label={`${commentCount} ${commentCount === 1 ? "comment" : "comments"}`}>
    <MessageCircle class="h-3.5 w-3.5" />
    {commentCount}
  </span>
</div>
