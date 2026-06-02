<script lang="ts">
  import type {Snippet} from 'svelte'
  import {ChevronDown} from '@lucide/svelte'

  interface Props {
    onPrimary: () => void
    disabled?: boolean
    primary: Snippet
    menu: Snippet<[() => void]>
    class?: string
  }

  const {onPrimary, disabled = false, primary, menu, class: className = ''}: Props = $props()

  let open = $state(false)
  let trigger: HTMLButtonElement | undefined = $state()
  let panel: HTMLDivElement | undefined = $state()

  function onDocumentPointerDown(event: PointerEvent) {
    if (!open) return
    const target = event.target as Node
    if (trigger?.contains(target)) return
    if (panel?.contains(target)) return
    open = false
  }

  $effect(() => {
    if (!open) return
    document.addEventListener('pointerdown', onDocumentPointerDown)
    return () => document.removeEventListener('pointerdown', onDocumentPointerDown)
  })
</script>

<div class={`relative inline-flex ${className}`}>
  <button
    type="button"
    class="inline-flex items-center gap-2 rounded-l-md border border-green-700 bg-green-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-green-500 disabled:opacity-60"
    {disabled}
    onclick={onPrimary}>
    {@render primary()}
  </button>
  <button
    bind:this={trigger}
    type="button"
    class="inline-flex items-center rounded-r-md border border-l-0 border-green-700 bg-green-600 px-2 py-1.5 text-white shadow-sm hover:bg-green-500 disabled:opacity-60"
    {disabled}
    aria-label="More re-run options"
    onclick={() => (open = !open)}>
    <ChevronDown class="h-4 w-4" />
  </button>

  {#if open}
    <div
      bind:this={panel}
      class="absolute right-0 top-full z-20 mt-2 w-80 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg">
      {@render menu(() => (open = false))}
    </div>
  {/if}
</div>
