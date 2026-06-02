<script lang="ts" generics="T extends {value: string; label: string}">
  import type {Snippet} from 'svelte'
  import {ChevronDown, Search} from '@lucide/svelte'

  interface Props {
    label: string
    options: T[]
    selected: Set<string>
    onChange: (next: Set<string>) => void
    placeholder?: string
    extraBottom?: Snippet
    row?: Snippet<[T]>
  }

  const {
    label,
    options,
    selected,
    onChange,
    placeholder,
    extraBottom,
    row,
  }: Props = $props()

  let open = $state(false)
  let query = $state('')
  let button: HTMLButtonElement | undefined = $state()
  let panel: HTMLDivElement | undefined = $state()

  const filtered = $derived(
    query
      ? options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()))
      : options,
  )

  const activeCount = $derived(selected.size)

  function toggle(value: string) {
    const next = new Set(selected)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    onChange(next)
  }

  function clear() {
    onChange(new Set())
  }

  function onDocumentPointerDown(event: PointerEvent) {
    if (!open) return
    const target = event.target as Node
    if (button?.contains(target)) return
    if (panel?.contains(target)) return
    open = false
  }

  $effect(() => {
    if (!open) return
    document.addEventListener('pointerdown', onDocumentPointerDown)
    return () => document.removeEventListener('pointerdown', onDocumentPointerDown)
  })

  $effect(() => {
    if (!open) query = ''
  })
</script>

<div class="relative">
  <button
    bind:this={button}
    type="button"
    class={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm hover:bg-accent ${activeCount ? 'text-foreground' : 'text-muted-foreground'}`}
    onclick={() => (open = !open)}
  >
    <span>{label}</span>
    {#if activeCount > 0}
      <span class="rounded-full bg-primary/20 px-1.5 text-xs font-medium text-primary">
        {activeCount}
      </span>
    {/if}
    <ChevronDown class="h-3.5 w-3.5" />
  </button>

  {#if open}
    <div
      bind:this={panel}
      class="absolute right-0 z-20 mt-2 w-72 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg"
    >
      <div class="flex items-center justify-between border-b border-border px-3 py-2">
        <span class="text-sm font-medium">Filter by {label}</span>
        {#if activeCount > 0}
          <button class="text-xs text-muted-foreground hover:text-foreground" onclick={clear}>
            Clear
          </button>
        {/if}
      </div>

      <div class="border-b border-border px-3 py-2">
        <div class="relative">
          <Search class="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            bind:value={query}
            class="w-full rounded-md border border-input bg-background py-1.5 pl-7 pr-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            placeholder={placeholder ?? `Filter ${label.toLowerCase()}…`}
            type="text"
          />
        </div>
      </div>

      <div class="max-h-64 overflow-y-auto py-1">
        {#if filtered.length === 0}
          <div class="px-3 py-2 text-xs text-muted-foreground">No matches.</div>
        {:else}
          {#each filtered as option (option.value)}
            <label class="flex min-w-0 cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent">
              <input
                type="checkbox"
                checked={selected.has(option.value)}
                onchange={() => toggle(option.value)}
                class="filter-check"
              />
              {#if row}
                <span class="min-w-0 flex-1">{@render row(option)}</span>
              {:else}
                <span class="min-w-0 flex-1 truncate">{option.label}</span>
              {/if}
            </label>
          {/each}
        {/if}
      </div>

      {#if extraBottom}
        <div class="border-t border-border px-3 py-2">
          {@render extraBottom()}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  :global(.filter-check) {
    appearance: none;
    -webkit-appearance: none;
    width: 1rem;
    height: 1rem;
    flex-shrink: 0;
    border: 1px solid hsl(var(--input));
    border-radius: 0.25rem;
    background: hsl(var(--background));
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: background-color 120ms, border-color 120ms;
  }
  :global(.filter-check:hover) {
    border-color: hsl(var(--primary));
  }
  :global(.filter-check:checked) {
    background: hsl(var(--primary));
    border-color: hsl(var(--primary));
  }
  :global(.filter-check:checked::after) {
    content: '';
    width: 0.3rem;
    height: 0.6rem;
    border: solid hsl(var(--primary-foreground));
    border-width: 0 2px 2px 0;
    transform: rotate(45deg) translate(-1px, -1px);
  }
</style>
