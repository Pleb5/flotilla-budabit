<script lang="ts">
  import Button from "@lib/components/Button.svelte"
  import ModalFooter from "@lib/components/ModalFooter.svelte"
  import {
    ChevronDown,
    ChevronUp,
    GripVertical,
    ListFilter,
    RotateCcw,
    X,
  } from "@lucide/svelte"
  import {
    getDefaultRepoDiscoveryPrioritySettings,
    type RepoDiscoveryPrioritySetting,
  } from "@src/lib/budabit/repo-discovery-search"

  type Props = {
    settings: RepoDiscoveryPrioritySetting[]
    onApply: (settings: RepoDiscoveryPrioritySetting[]) => void
  }

  const {settings, onApply}: Props = $props()

  const cloneSettings = (value: RepoDiscoveryPrioritySetting[]) => value.map(item => ({...item}))

  let draft = $state(cloneSettings(settings))
  let draggingIndex = $state<number | null>(null)
  let dragOverIndex = $state<number | null>(null)

  const back = () => history.back()

  const moveItem = (fromIndex: number, toIndex: number) => {
    const next = [...draft]
    if (fromIndex < 0 || fromIndex >= next.length) return
    if (fromIndex === toIndex) return

    const [moved] = next.splice(fromIndex, 1)
    const targetIndex = Math.max(0, Math.min(toIndex, next.length))
    next.splice(targetIndex, 0, moved)
    draft = next
  }

  const toggleEnabled = (index: number, enabled: boolean) => {
    draft = draft.map((item, itemIndex) =>
      itemIndex === index ? {...item, enabled} : item,
    )
  }

  const handleDragStart = (index: number, event: DragEvent) => {
    draggingIndex = index
    dragOverIndex = index

    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move"
      event.dataTransfer.setData("text/plain", String(index))
    }
  }

  const handleDragOver = (index: number, event: DragEvent) => {
    if (draggingIndex === null) return
    event.preventDefault()
    dragOverIndex = index

    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move"
    }
  }

  const handleDrop = (index: number, event: DragEvent) => {
    if (draggingIndex === null) return
    event.preventDefault()
    moveItem(draggingIndex, index)
    draggingIndex = null
    dragOverIndex = null
  }

  const handleDragEnd = () => {
    draggingIndex = null
    dragOverIndex = null
  }

  const reset = () => {
    draft = getDefaultRepoDiscoveryPrioritySettings()
  }

  const apply = () => {
    onApply(cloneSettings(draft))
    back()
  }
</script>

<div class="flex max-h-[85vh] w-[min(42rem,calc(100vw-1.5rem))] flex-col gap-4 overflow-hidden rounded-box border border-border bg-card p-4 shadow-xl">
  <div class="flex items-start justify-between gap-3">
    <div class="flex min-w-0 items-start gap-3">
      <div class="mt-0.5 rounded-full border border-border bg-background/80 p-2 text-muted-foreground">
        <ListFilter class="h-4 w-4" />
      </div>
      <div class="min-w-0">
        <h2 class="text-lg font-semibold">Search Discovery</h2>
        <p class="text-sm text-muted-foreground">
          Enabled targets are searched in this order until the 30 second time budget is used.
        </p>
      </div>
    </div>
    <button
      type="button"
      class="btn btn-circle btn-ghost btn-sm"
      aria-label="Close search discovery settings"
      onclick={back}>
      <X class="h-4 w-4" />
    </button>
  </div>

  <div class="rounded-md border border-border bg-background/60 p-3 text-sm text-muted-foreground">
    Drag rows to reorder them. Turn rows off to skip that source completely during search.
  </div>

  <div class="flex min-h-0 flex-col gap-2 overflow-y-auto pr-1" role="list">
    {#each draft as item, index (item.key)}
      {@const isDragOver = dragOverIndex === index && draggingIndex !== null}
      {@const isFirst = index === 0}
      {@const isLast = index === draft.length - 1}

      <div
        role="listitem"
        class={`flex items-center gap-3 rounded-md border p-3 transition-colors ${
          isDragOver ? "border-primary/50 bg-primary/5" : "border-border bg-background/60"
        } ${item.enabled ? "" : "opacity-65"}`}
        ondragover={event => handleDragOver(index, event)}
        ondrop={event => handleDrop(index, event)}>
        <button
          type="button"
          class="cursor-grab rounded-md p-2 text-muted-foreground transition-colors hover:text-foreground active:cursor-grabbing"
          draggable="true"
          aria-label={`Reorder ${item.label}`}
          aria-grabbed={draggingIndex === index ? "true" : "false"}
          ondragstart={event => handleDragStart(index, event)}
          ondragend={handleDragEnd}>
          <GripVertical class="h-4 w-4" />
        </button>

        <input
          type="checkbox"
          class="checkbox checkbox-sm"
          checked={item.enabled}
          aria-label={`Enable ${item.label}`}
          onchange={event => toggleEnabled(index, (event.currentTarget as HTMLInputElement).checked)} />

        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <p class="font-medium text-foreground">{item.label}</p>
            {#if index === 0}
              <span class="rounded-full border border-border bg-background px-2 py-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                Primary
              </span>
            {/if}
            {#if !item.enabled}
              <span class="rounded-full border border-border bg-background px-2 py-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                Off
              </span>
            {/if}
          </div>
          <p class="text-sm text-muted-foreground">{item.description}</p>
        </div>

        <div class="flex flex-col sm:hidden">
          <button
            type="button"
            class="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            onclick={() => moveItem(index, index - 1)}
            disabled={isFirst}
            aria-label={`Move ${item.label} up`}>
            <ChevronUp class="h-4 w-4" />
          </button>
          <button
            type="button"
            class="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            onclick={() => moveItem(index, index + 1)}
            disabled={isLast}
            aria-label={`Move ${item.label} down`}>
            <ChevronDown class="h-4 w-4" />
          </button>
        </div>
      </div>
    {/each}
  </div>

  <ModalFooter>
    <Button class="btn btn-ghost" onclick={reset}>
      <RotateCcw class="h-4 w-4" />
      Reset
    </Button>
    <div class="flex-1"></div>
    <Button class="btn btn-ghost" onclick={back}>Cancel</Button>
    <Button class="btn btn-primary" onclick={apply}>Apply</Button>
  </ModalFooter>
</div>
