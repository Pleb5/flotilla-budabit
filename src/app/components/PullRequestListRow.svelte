<script lang="ts">
  import type {PullRequestEvent} from "@nostr-git/core/events"
  import {formatTimestampRelative} from "@welshman/lib"
  import {getTagValue} from "@welshman/util"
  import {
    CircleCheck,
    CircleDot,
    FileCode,
    GitBranch,
    MessageCircle,
    Users,
    XCircle,
  } from "@lucide/svelte"
  import ProfileName from "@app/components/ProfileName.svelte"

  type Props = {
    event: PullRequestEvent
    title: string
    status?: string
    commentCount?: number
    reviewerCount?: number
    labels?: string[]
    branchName?: string
    profileRelays?: string[]
  }

  const {
    event,
    title,
    status = "open",
    commentCount = 0,
    reviewerCount = 0,
    labels = [],
    branchName = "",
    profileRelays = [],
  }: Props = $props()

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
    {#if status === "merged"}
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
      {#if branchName}
        <span aria-hidden="true"> · </span>
        <GitBranch class="inline-block h-3 w-3 align-[-2px]" />
        {branchName}
      {/if}
    </div>
  </div>

  <div class="mt-0.5 flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
    {#if reviewerCount > 0}
      <span
        class="flex items-center gap-1"
        title={`${reviewerCount} ${reviewerCount === 1 ? "reviewer" : "reviewers"}`}
        aria-label={`${reviewerCount} ${reviewerCount === 1 ? "reviewer" : "reviewers"}`}>
        <Users class="h-3.5 w-3.5" />
        {reviewerCount}
      </span>
    {/if}
    <span
      class="flex min-w-7 items-center justify-end gap-1"
      title={`${commentCount} ${commentCount === 1 ? "comment" : "comments"}`}
      aria-label={`${commentCount} ${commentCount === 1 ? "comment" : "comments"}`}>
      <MessageCircle class="h-3.5 w-3.5" />
      {commentCount}
    </span>
  </div>
</div>
