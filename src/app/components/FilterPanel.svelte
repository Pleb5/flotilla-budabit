<script lang="ts">
  import { Button } from "@nostr-git/ui"
  import { Bell, CalendarDays, Check, Clock, GitCommit, User } from "@lucide/svelte"
  import Icon from "@src/lib/components/Icon.svelte"
  import ProfileName from "@src/app/components/ProfileName.svelte"
  import { slide } from "@lib/transition"
  import { createEventDispatcher } from "svelte"

  interface StatusOpt { value: string; label: string; icon?: any }
  interface SortOpt { value: string; label: string; icon?: any }

  interface Props {
    // visibility handled by parent; this component just renders the panel box
    statusOptions?: StatusOpt[]
    selectedStatus?: string
    onStatusChange?: (v: string) => void

    sortOptions?: SortOpt[]
    sortBy?: string
    onSortChange?: (v: string) => void

    authors?: string[]
    authorFilter?: string
    onAuthorChange?: (v: string) => void

    allLabels?: string[]
    selectedLabels?: string[]
    onToggleLabel?: (lbl: string) => void
    onClearLabels?: () => void

    matchAllLabels?: boolean
    onMatchAllToggle?: () => void

    labelSearchEnabled?: boolean
    labelSearch?: string
    onLabelSearchChange?: (s: string) => void

    showReset?: boolean
    onReset?: () => void

    showReviewIndicator?: boolean
  }

  const dispatch = createEventDispatcher<{ statusChange: string }>()

  const {
    statusOptions = [],
    selectedStatus = "all",
    onStatusChange,
    sortOptions = [],
    sortBy = "newest",
    onSortChange,
    authors = [],
    authorFilter = "",
    onAuthorChange,
    allLabels = [],
    selectedLabels = [],
    onToggleLabel,
    onClearLabels,
    matchAllLabels = false,
    onMatchAllToggle,
    labelSearchEnabled = false,
    labelSearch = "",
    onLabelSearchChange,
    showReset = false,
    onReset,
    showReviewIndicator = true,
  }: Props = $props()
</script>

<div class="mb-6 rounded-md border border-border bg-card p-4" transition:slide>
  <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
    <!-- Status Filter -->
    <div>
      <h3 class="mb-2 text-sm font-medium">Status</h3>
      <div class="flex flex-wrap gap-2">
        <Button
          variant={selectedStatus === "all" ? "default" : "outline"}
          size="sm"
          onclick={() => { onStatusChange?.("all"); dispatch("statusChange", "all") }}>
          All
        </Button>
        {#each statusOptions as s (s.value)}
          <Button
            variant={selectedStatus === s.value ? "default" : "outline"}
            size="sm"
            onclick={() => { onStatusChange?.(s.value); dispatch("statusChange", s.value) }}
            class="gap-1">
            {#if s.icon}
              {@const I = s.icon}
              <I class="h-3 w-3" />
            {/if}
            {s.label}
          </Button>
        {/each}
      </div>
    </div>

    <!-- Sort Options -->
    {#if sortOptions.length}
      <div>
        <h3 class="mb-2 text-sm font-medium">Sort By</h3>
        <div class="flex flex-wrap gap-2">
          {#each sortOptions as so (so.value)}
            <Button
              variant={sortBy === so.value ? "default" : "outline"}
              size="sm"
              onclick={() => onSortChange?.(so.value)}
              class="gap-1">
              {#if so.icon}
                {@const SI = so.icon}
                <SI class="h-3 w-3" />
              {/if}
              {so.label}
            </Button>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Author Filter -->
    {#if authors.length > 1}
      <div class="md:col-span-2">
        <h3 class="mb-2 text-sm font-medium">Author</h3>
        <div class="flex flex-wrap gap-2">
          <Button
            variant={authorFilter === "" ? "default" : "outline"}
            size="sm"
            onclick={() => onAuthorChange?.("")}>All Authors</Button>

          {#each authors as a (a)}
            <Button
              variant={authorFilter === a ? "default" : "outline"}
              size="sm"
              onclick={() => onAuthorChange?.(a)}
              class="gap-1">
              <User class="h-3 w-3" />
              <span class="text-sm"><ProfileName pubkey={a} /></span>
            </Button>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Label Filter -->
    {#if allLabels.length > 0}
      <div class="md:col-span-2">
        <h3 class="mb-2 text-sm font-medium">Labels</h3>
        {#if labelSearchEnabled}
          <div class="row-2 input mb-2 max-w-md">
            <Icon icon="magnifer" />
            <input
              class="w-full"
              value={labelSearch}
              oninput={(e) => onLabelSearchChange?.((e.target as HTMLInputElement).value)}
              type="text"
              placeholder="Search labels..." />
          </div>
        {/if}
        <div class="flex flex-wrap gap-2">
          {#each (labelSearchEnabled ? allLabels.filter(l => l.toLowerCase().includes(labelSearch.toLowerCase())) : allLabels) as lbl (lbl)}
            <Button
              variant={selectedLabels.includes(lbl) ? "default" : "outline"}
              size="sm"
              onclick={() => onToggleLabel?.(lbl)}>
              {lbl}
            </Button>
          {/each}
          <Button
            variant={matchAllLabels ? "default" : "outline"}
            size="sm"
            onclick={() => onMatchAllToggle?.()}>Match all</Button>
          {#if selectedLabels.length > 0}
            <Button variant="ghost" size="sm" onclick={() => onClearLabels?.()}>Clear labels</Button>
          {/if}
        </div>
        {#if selectedLabels.length > 0}
          <div class="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span class="text-muted-foreground">Selected:</span>
            {#each selectedLabels as sl (sl)}
              <span class="badge badge-ghost badge-sm">{sl}</span>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>

  {#if showReset}
    <div class="mt-4 flex items-center justify-end">
      <Button variant="ghost" size="sm" onclick={() => onReset?.()}>Reset Filters</Button>
    </div>
  {/if}

  {#if showReviewIndicator}
    <div class="mt-3 flex items-center justify-end">
      <span class="text-[11px] opacity-60 inline-flex items-center gap-1" title="Bell indicates review requested (label, you are tagged, or mentioned in comments)">
        <Bell class="h-3 w-3" />
        Review indicator
      </span>
    </div>
  {/if}
</div>
