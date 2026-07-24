<style>
  @media (hover: none) {
    :global(.label-filter-button:not(.label-selected):hover) {
      background-color: hsl(var(--ng-background));
      color: inherit;
    }
  }
</style>

<script lang="ts">
  import Icon from "@lib/components/Icon.svelte"
  import Magnifer from "@assets/icons/magnifer.svg?dataurl"
  import User from "@assets/icons/user.svg?dataurl"
  import CalendarDays from "@assets/icons/calendar-date.svg?dataurl"
  import Check from "@assets/icons/check.svg?dataurl"
  import GitCommit from "@assets/icons/git.svg?dataurl"
  import X from "@assets/icons/xxx.svg?dataurl"
  import Clock from "@assets/icons/clock-circle.svg?dataurl"
  import ProfileName from "@app/components/ProfileName.svelte"
  import {slide} from "@lib/transition"
  import {createEventDispatcher, onDestroy, onMount} from "svelte"
  import {Button} from "@nostr-git/ui"
  import {ChevronDown, SlidersHorizontal} from "@lucide/svelte"

  interface Props {
    storageKey?: string
    mode?: "issues" | "prs"
    statusValue?: string
    statusBadgeCounts?: Record<string, number>

    // visibility handled by parent; this component just renders the panel box
    onStatusChange?: (v: string) => void
    onSortChange?: (v: string) => void

    authors?: string[]
    authorFilter?: string
    onAuthorChange?: (v: string) => void

    allLabels?: string[]
    onToggleLabel?: (lbl: string) => void
    onClearLabels?: () => void

    matchAllLabels?: boolean

    labelSearchEnabled?: boolean
    labelSearch?: string
    onLabelSearchChange?: (s: string) => void

    showReset?: boolean
  }

  const dispatch = createEventDispatcher<{
    statusChange: string
    sortChange: string
    authorChange: string
    labelsChange: string[]
    matchAllChange: boolean
    reset: void
  }>()

  let {
    storageKey = "",
    mode = "issues",
    statusValue = "open",
    statusBadgeCounts = {},
    onStatusChange,
    onSortChange,
    authors = [],
    authorFilter = "",
    onAuthorChange,
    allLabels = [],
    onToggleLabel,
    onClearLabels,
    labelSearchEnabled = false,
    labelSearch = "",
    onLabelSearchChange,
    showReset = false,
  }: Props = $props()

  // Filter and sort options
  let statusFilter = $state<string>("open") // all, open, applied, closed, draft
  let sortByOrder = $state<string>("newest") // newest, oldest, status, commits
  let showAdvancedFilters = $state(false)
  let selectedLabels = $state<string[]>([])
  let matchAllLabels = $state(false)
  let sortOptions = $state([
    {value: "newest", label: "Newest", icon: CalendarDays},
    {value: "oldest", label: "Oldest", icon: CalendarDays},
    {value: "status", label: "Status", icon: Check},
  ])
  let statusOptions = $state([
    {value: "open", label: "Open", icon: GitCommit},
    {
      value: mode === "prs" ? "merged" : "resolved",
      label: mode === "prs" ? "Merged" : "Resolved",
      icon: Check,
    },
    {value: "closed", label: "Closed", icon: X},
    {value: "draft", label: "Draft", icon: Clock},
  ])

  // Update statusOptions when mode changes
  $effect(() => {
    statusOptions = [
      {value: "open", label: "Open", icon: GitCommit},
      {
        value: mode === "prs" ? "merged" : "resolved",
        label: mode === "prs" ? "Merged" : "Resolved",
        icon: Check,
      },
      {value: "closed", label: "Closed", icon: X},
      {value: "draft", label: "Draft", icon: Clock},
    ]
    sortOptions = [
      {value: "newest", label: "Newest", icon: CalendarDays},
      {value: "oldest", label: "Oldest", icon: CalendarDays},
      {value: "status", label: "Status", icon: Check},
    ]
  })

  $effect(() => {
    if (statusValue !== statusFilter) {
      statusFilter = statusValue
    }
  })

  const getStatusBadgeCount = (value: string) => Math.max(0, statusBadgeCounts[value] || 0)

  const formatStatusBadgeCount = (value: string) => {
    const count = getStatusBadgeCount(value)
    return count > 9 ? "9+" : String(count)
  }

  const advancedFilterCount = $derived(
    (sortByOrder !== "newest" ? 1 : 0) +
      (authorFilter ? 1 : 0) +
      selectedLabels.length +
      (matchAllLabels && selectedLabels.length > 0 ? 1 : 0),
  )
  const hasAdvancedOptions = $derived(
    sortOptions.length > 0 || authors.length > 1 || allLabels.length > 0,
  )
  const hasActiveFilters = $derived(statusFilter !== "open" || advancedFilterCount > 0)

  const applyFromData = (data: any) => {
    if (!data) return
    if (typeof data.statusFilter === "string") statusFilter = data.statusFilter
    if (typeof data.sortByOrder === "string") sortByOrder = data.sortByOrder
    if (typeof data.authorFilter === "string") authorFilter = data.authorFilter
    if (typeof data.showAdvancedFilters === "boolean") {
      showAdvancedFilters = data.showAdvancedFilters
    }
    if (Array.isArray(data.selectedLabels)) selectedLabels = data.selectedLabels
    if (typeof data.matchAllLabels === "boolean") matchAllLabels = data.matchAllLabels
  }

  const syncToParent = () => {
    onStatusChange?.(statusFilter)
    onSortChange?.(sortByOrder)
    onAuthorChange?.(authorFilter)
    dispatch("statusChange", statusFilter)
    dispatch("sortChange", sortByOrder)
    dispatch("authorChange", authorFilter)
    dispatch("labelsChange", selectedLabels)
    dispatch("matchAllChange", matchAllLabels)
  }

  const resetFilters = () => {
    statusFilter = "open"
    sortByOrder = "newest"
    authorFilter = ""
    showAdvancedFilters = false
    selectedLabels = []
    matchAllLabels = false
    if (storageKey) localStorage.removeItem(storageKey)
  }

  let storageListener: ((e: StorageEvent) => void) | null = null

  onMount(() => {
    if (!storageKey) return
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) {
        const data = JSON.parse(raw)
        applyFromData(data)
      }
    } catch (e) {
      // ignore
    }
    syncToParent()
    storageListener = (e: StorageEvent) => {
      if (!storageKey) return
      if (e.key === storageKey) {
        try {
          const data = e.newValue ? JSON.parse(e.newValue) : null
          if (data) {
            applyFromData(data)
            syncToParent()
          }
        } catch {
          // Ignore malformed filter data from other tabs.
        }
      }
    }
    window.addEventListener("storage", storageListener)
  })

  onDestroy(() => {
    if (storageListener) window.removeEventListener("storage", storageListener)
  })

  const blurOnPointerUp = (event: PointerEvent) => {
    const target = event.currentTarget as HTMLElement | null
    target?.blur()
  }

  const persist = () => {
    if (!storageKey) return
    try {
      const data = {
        statusFilter,
        sortByOrder,
        authorFilter,
        showAdvancedFilters,
        selectedLabels,
        matchAllLabels,
      }
      localStorage.setItem(storageKey, JSON.stringify(data))
    } catch (e) {
      // ignore
    }
  }

  // Persist on changes (single watcher)
  $effect(() => {
    persist()
  })
</script>

<div class="mb-3 rounded-md border border-border bg-card p-2" transition:slide>
  <div class="flex flex-wrap items-center gap-1.5">
    <span class="px-1 text-xs font-medium text-muted-foreground">Status</span>
    <div class="flex flex-wrap gap-1">
      <Button
        variant={statusFilter === "all" ? "default" : "outline"}
        size="sm"
        class="h-7 min-h-0 px-2 text-xs"
        onclick={() => {
          statusFilter = "all"
          onStatusChange?.("all")
          dispatch("statusChange", "all")
        }}>
        All
      </Button>
      {#each statusOptions as statusOption (statusOption.value)}
        <Button
          variant={statusFilter === statusOption.value ? "default" : "outline"}
          size="sm"
          class="h-7 min-h-0 gap-1 px-2 text-xs"
          onclick={() => {
            statusFilter = statusOption.value
            onStatusChange?.(statusOption.value)
            dispatch("statusChange", statusOption.value)
          }}>
          {#if statusOption.icon}
            <Icon icon={statusOption.icon} class="h-3 w-3" />
          {/if}
          <span>{statusOption.label}</span>
          {#if getStatusBadgeCount(statusOption.value) > 0}
            <span
              class="text-secondary-foreground inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-secondary px-1 text-[10px]">
              {formatStatusBadgeCount(statusOption.value)}
            </span>
          {/if}
        </Button>
      {/each}
    </div>

    <div class="ml-auto flex items-center gap-1">
      {#if showReset && hasActiveFilters}
        <Button
          variant="ghost"
          size="sm"
          class="h-7 min-h-0 px-2 text-xs text-muted-foreground"
          onclick={() => {
            resetFilters()
            syncToParent()
            dispatch("reset")
          }}>Reset</Button>
      {/if}
      {#if hasAdvancedOptions}
        <Button
          variant="outline"
          size="sm"
          class="h-7 min-h-0 gap-1 px-2 text-xs"
          aria-expanded={showAdvancedFilters}
          onclick={() => (showAdvancedFilters = !showAdvancedFilters)}>
          <SlidersHorizontal class="h-3.5 w-3.5" />
          More filters
          {#if advancedFilterCount > 0}
            <span
              class="text-primary-foreground inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px]">
              {advancedFilterCount > 9 ? "9+" : advancedFilterCount}
            </span>
          {/if}
          <ChevronDown
            class={`h-3.5 w-3.5 transition-transform${showAdvancedFilters ? " rotate-180" : ""}`} />
        </Button>
      {/if}
    </div>
  </div>

  {#if showAdvancedFilters}
    <div
      class="mt-2 grid grid-cols-1 gap-3 border-t border-border pt-2 sm:grid-cols-2"
      transition:slide={{duration: 150}}>
      {#if sortOptions.length}
        <div>
          <h3
            class="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Sort by
          </h3>
          <div class="flex flex-wrap gap-1">
            {#each sortOptions as sortOption (sortOption.value)}
              <Button
                variant={sortByOrder === sortOption.value ? "default" : "outline"}
                size="sm"
                class="h-7 min-h-0 gap-1 px-2 text-xs"
                onclick={() => {
                  sortByOrder = sortOption.value
                  onSortChange?.(sortOption.value)
                  dispatch("sortChange", sortOption.value)
                }}>
                {#if sortOption.icon}
                  <Icon icon={sortOption.icon} class="h-3 w-3" />
                {/if}
                {sortOption.label}
              </Button>
            {/each}
          </div>
        </div>
      {/if}

      {#if authors.length > 1}
        <div>
          <h3
            class="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Author
          </h3>
          <div class="flex max-h-24 flex-wrap gap-1 overflow-y-auto pr-1">
            <Button
              variant={authorFilter === "" ? "default" : "outline"}
              size="sm"
              class="h-7 min-h-0 px-2 text-xs"
              onclick={() => {
                authorFilter = ""
                onAuthorChange?.("")
                dispatch("authorChange", "")
              }}>All authors</Button>

            {#each authors as author (author)}
              <Button
                variant={authorFilter === author ? "default" : "outline"}
                size="sm"
                class="h-7 min-h-0 max-w-52 gap-1 px-2 text-xs"
                onclick={() => {
                  authorFilter = author
                  onAuthorChange?.(author)
                  dispatch("authorChange", author)
                }}>
                <Icon icon={User} class="h-3 w-3" />
                <span class="truncate"><ProfileName pubkey={author} /></span>
              </Button>
            {/each}
          </div>
        </div>
      {/if}

      {#if allLabels.length > 0}
        <div class="sm:col-span-2">
          <h3
            class="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Labels
          </h3>
          {#if labelSearchEnabled}
            <div class="row-2 input mb-2 h-8 min-h-0 max-w-md px-2 text-sm">
              <Icon icon={Magnifer} class="h-3.5 w-3.5" />
              <input
                class="h-full w-full"
                value={labelSearch}
                oninput={event => onLabelSearchChange?.((event.target as HTMLInputElement).value)}
                type="text"
                placeholder="Search labels..." />
            </div>
          {/if}
          <div class="flex max-h-28 flex-wrap gap-1 overflow-y-auto">
            {#each labelSearchEnabled ? allLabels.filter(label => label
                    .toLowerCase()
                    .includes(labelSearch.toLowerCase())) : allLabels as label (label)}
              <Button
                variant={selectedLabels.includes(label) ? "default" : "outline"}
                size="sm"
                class={`label-filter-button h-7 min-h-0 px-2 text-xs${selectedLabels.includes(label) ? " label-selected" : ""}`}
                onpointerup={blurOnPointerUp}
                onclick={() => {
                  if (selectedLabels.includes(label)) {
                    selectedLabels = selectedLabels.filter(selected => selected !== label)
                  } else {
                    selectedLabels = [...selectedLabels, label]
                  }
                  onToggleLabel?.(label)
                  dispatch("labelsChange", selectedLabels)
                }}>
                {label}
              </Button>
            {/each}
            <Button
              variant={matchAllLabels ? "default" : "outline"}
              size="sm"
              class="label-filter-button h-7 min-h-0 px-2 text-xs"
              onpointerup={blurOnPointerUp}
              onclick={() => {
                matchAllLabels = !matchAllLabels
                dispatch("matchAllChange", matchAllLabels)
              }}>Match all</Button>
            {#if selectedLabels.length > 0}
              <Button
                variant="ghost"
                size="sm"
                class="label-filter-button h-7 min-h-0 px-2 text-xs"
                onpointerup={blurOnPointerUp}
                onclick={() => {
                  selectedLabels = []
                  onClearLabels?.()
                  dispatch("labelsChange", selectedLabels)
                }}>Clear labels</Button>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>
