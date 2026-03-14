<script lang="ts">
  import {Copy, ExternalLink} from "@lucide/svelte"
  import {toast} from "@nostr-git/ui"

  interface Props {
    title: string
    content: string
    url?: string | null
    defaultLines?: number
    variant?: "default" | "error"
  }

  const {title, content, url = null, defaultLines = 5, variant = "default"}: Props = $props()

  let expanded = $state(false)

  const lines = $derived(content ? content.split("\n") : [])
  const isError = $derived(variant === "error")
</script>

<div class="overflow-hidden rounded-lg border {isError ? 'border-red-900/50' : 'border-gray-700'}">
  <div class="flex items-center justify-between {isError ? 'bg-red-950/80' : 'bg-gray-800'} px-4 py-2">
    <h3 class="text-sm font-semibold {isError ? 'text-red-300' : 'text-gray-200'}">{title}</h3>
    <div class="flex items-center gap-2">
      {#if url}
        <a href={url} target="_blank" rel="noopener" class="text-xs {isError ? 'text-red-400 hover:text-red-200' : 'text-gray-400 hover:text-gray-200'}">
          <ExternalLink class="h-3 w-3" />
        </a>
      {/if}
      {#if content}
        <button
          onclick={() => {
            navigator.clipboard.writeText(content)
            toast.push({message: "Copied", variant: "default"})
          }}
          class="{isError ? 'text-red-400 hover:text-red-200' : 'text-gray-400 hover:text-gray-200'}">
          <Copy class="h-3 w-3" />
        </button>
      {/if}
    </div>
  </div>

  <div class="overflow-y-auto bg-gray-900 px-4 py-3 font-mono text-sm">
    {#if lines.length > 0}
      {@const collapsed = !expanded && lines.length > defaultLines}
      {#each collapsed ? lines.slice(0, defaultLines) : lines as line}
        <div class="{isError ? 'text-red-400' : 'text-gray-100'}">{line}</div>
      {/each}
    {:else}
      <div class="text-gray-500">No output</div>
    {/if}
  </div>

  {#if lines.length > defaultLines}
    <button
      class="w-full {isError ? 'bg-red-950/80 text-red-400 hover:text-red-200' : 'bg-gray-800 text-gray-400 hover:text-gray-200'} px-4 py-1.5 text-xs transition-colors"
      onclick={() => (expanded = !expanded)}>
      {expanded ? "Collapse" : `Show all ${lines.length} lines`}
    </button>
  {/if}
</div>
