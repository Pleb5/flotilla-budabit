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

  interface StatusOpt {
    value: string
    label: string
    icon?: any
  }
  interface SortOpt {
    value: string
    label: string
    icon?: any
  }

  interface Props {
    storageKey?: string
    mode?: "issues" | "patches"

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
  let showFilters = $state(true)
  let searchTerm = $state("")
  let selectedLabels = $state<string[]>([])
  let matchAllLabels = $state(false)
  let sortOptions = $state([
        {value: "newest", label: "Newest", icon: CalendarDays},
        {value: "oldest", label: "Oldest", icon: CalendarDays},
        {value: "status", label: "Status", icon: Check},
        ...(mode === "patches" ? [{value: "commits", label: "Commits", icon: GitCommit}] : []),
      ])
  let statusOptions = $state([
        {value: "open", label: "Open", icon: GitCommit},
        {value: mode === "patches" ? "applied" : "resolved", label: mode === "patches" ? "Applied" : "Resolved", icon: Check},
        {value: "closed", label: "Closed", icon: X},
        {value: "draft", label: "Draft", icon: Clock},
      ])

  // Update statusOptions when mode changes
  $effect(() => {
    mode
    statusOptions = [
      {value: "open", label: "Open", icon: GitCommit},
      {value: mode === "patches" ? "applied" : "resolved", label: mode === "patches" ? "Applied" : "Resolved", icon: Check},
      {value: "closed", label: "Closed", icon: X},
      {value: "draft", label: "Draft", icon: Clock},
    ]
    sortOptions = [
      {value: "newest", label: "Newest", icon: CalendarDays},
      {value: "oldest", label: "Oldest", icon: CalendarDays},
      {value: "status", label: "Status", icon: Check},
      ...(mode === "patches" ? [{value: "commits", label: "Commits", icon: GitCommit}] : []),
    ]
  })

  const applyFromData = (data: any) => {
    if (!data) return
    if (typeof data.statusFilter === "string") statusFilter = data.statusFilter
    if (typeof data.sortByOrder === "string") sortByOrder = data.sortByOrder
    if (typeof data.authorFilter === "string") authorFilter = data.authorFilter
    if (typeof data.showFilters === "boolean") showFilters = data.showFilters
    if (typeof data.searchTerm === "string") searchTerm = data.searchTerm
    if (Array.isArray(data.selectedLabels)) selectedLabels = data.selectedLabels
    if (typeof data.matchAllLabels === "boolean") matchAllLabels = data.matchAllLabels
  }

  const resetFilters = () => {
    statusFilter = "open"
    sortByOrder = "newest"
    authorFilter = ""
    showFilters = true
    searchTerm = ""
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
        if (typeof data.statusFilter === "string") statusFilter = data.statusFilter
        if (typeof data.sortByOrder === "string") sortByOrder = data.sortByOrder
        if (typeof data.authorFilter === "string") authorFilter = data.authorFilter
        if (typeof data.showFilters === "boolean") showFilters = data.showFilters
        if (typeof data.searchTerm === "string") searchTerm = data.searchTerm
        if (Array.isArray(data.selectedLabels)) selectedLabels = data.selectedLabels
        if (typeof data.matchAllLabels === "boolean") matchAllLabels = data.matchAllLabels
      }
    } catch (e) {
      // ignore
    }
    storageListener = (e: StorageEvent) => {
      if (!storageKey) return
      if (e.key === storageKey) {
        try {
          const data = e.newValue ? JSON.parse(e.newValue) : null
          if (data) applyFromData(data)
        } catch {}
      }
    }
    window.addEventListener("storage", storageListener)
  })

  onDestroy(() => {
    if (storageListener) window.removeEventListener("storage", storageListener)
  })

  const onMatchAllToggle = () => (matchAllLabels = !matchAllLabels)

  const persist = () => {
    if (!storageKey) return
    try {
      const data = {
        statusFilter,
        sortByOrder,
        authorFilter,
        showFilters,
        searchTerm,
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
    statusFilter
    sortByOrder
    authorFilter
    showFilters
    searchTerm
    selectedLabels
    matchAllLabels
    persist()
  })

</script>

<div class="mb-6 rounded-md border border-border bg-card p-4" transition:slide>
  <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
    <!-- Status Filter -->
    <div>
      <h3 class="mb-2 text-sm font-medium">Status</h3>
      <div class="flex flex-wrap gap-2">
        <Button
          variant={statusFilter === "all" ? "default" : "outline"}
          size="sm"
          onclick={() => {
            statusFilter = "all"
            onStatusChange?.("all")
            dispatch("statusChange", "all")
          }}>
          All
        </Button>
        {#each statusOptions as s (s.value)}
          <Button
            variant={statusFilter === s.value ? "default" : "outline"}
            size="sm"
            onclick={() => {
              statusFilter = s.value
              onStatusChange?.(s.value)
              dispatch("statusChange", s.value)
            }}
            class="gap-1">
            {#if s.icon}
              <Icon icon={s.icon} class="h-3 w-3" />
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
              variant={sortByOrder === so.value ? "default" : "outline"}
              size="sm"
              onclick={() => {
                sortByOrder = so.value
                onSortChange?.(so.value)
                dispatch("sortChange", so.value)
              }}
              class="gap-1">
              {#if so.icon}
                <Icon icon={so.icon} class="h-3 w-3" />
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
            onclick={() => {
              authorFilter = ""
              onAuthorChange?.("")
              dispatch("authorChange", "")
            }}>All Authors</Button>

          {#each authors as a (a)}
            <Button
              variant={authorFilter === a ? "default" : "outline"}
              size="sm"
              onclick={() => {
                authorFilter = a
                onAuthorChange?.(a)
                dispatch("authorChange", a)
              }}
              class="gap-1">
              <Icon icon={User} />
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
            <Icon icon={Magnifer} />
            <input
              class="w-full"
              value={labelSearch}
              oninput={e => onLabelSearchChange?.((e.target as HTMLInputElement).value)}
              type="text"
              placeholder="Search labels..." />
          </div>
        {/if}
        <div class="flex flex-wrap gap-2">
          {#each labelSearchEnabled ? allLabels.filter(l => l
                  .toLowerCase()
                  .includes(labelSearch.toLowerCase())) : allLabels as lbl (lbl)}
            <Button
              variant={selectedLabels.includes(lbl) ? "default" : "outline"}
              size="sm"
              onclick={() => {
                if (selectedLabels.includes(lbl)) {
                  selectedLabels = selectedLabels.filter(l => l !== lbl)
                } else {
                  selectedLabels = [...selectedLabels, lbl]
                }
                onToggleLabel?.(lbl)
                dispatch("labelsChange", selectedLabels)
              }}>
              {lbl}
            </Button>
          {/each}
          <Button
            variant={matchAllLabels ? "default" : "outline"}
            size="sm"
            onclick={() => {
              matchAllLabels = !matchAllLabels
              onMatchAllToggle?.()
              dispatch("matchAllChange", matchAllLabels)
            }}>Match all</Button>
          {#if selectedLabels.length > 0}
            <Button variant="ghost" size="sm" onclick={() => {
              selectedLabels = []
              onClearLabels?.()
              dispatch("labelsChange", selectedLabels)
            }}
              >Clear labels</Button>
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
      <Button variant="ghost" size="sm" onclick={() => { resetFilters(); dispatch("reset") }}>Reset Filters</Button>
    </div>
  {/if}
</div>
