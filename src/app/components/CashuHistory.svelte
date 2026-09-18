<script lang="ts">
  import {cashuTokenHistory} from "@app/core/cashu"
  import type {TokenHistoryEntry} from "@app/core/cashu"
  import {formatCashuSats} from "@app/util/cashu-format"
  import Button from "@lib/components/Button.svelte"

  interface Props {
    limit?: number
  }

  const {limit = 0}: Props = $props()

  const history = $derived($cashuTokenHistory)
  let showAll = $state(false)
  let copiedId = $state<string | null>(null)

  const displayed = $derived(limit > 0 && !showAll ? history.slice(0, limit) : history)

  const directionLabel = (entry: TokenHistoryEntry) => {
    if (!["finalized", "paid", "issued", "pending"].includes(entry.state.toLowerCase()))
      return "Transaction"
    if (entry.state.toLowerCase() === "pending" && entry.direction === "minted") return "Top-up"
    if (entry.direction === "sent") return "Sent"
    if (entry.direction === "received") return "Received"
    return "Minted"
  }

  const directionClass = (entry: TokenHistoryEntry) => {
    if (["failed", "rolled_back", "rolledback"].includes(entry.state.toLowerCase()))
      return "opacity-60"
    if (!["finalized", "paid", "issued"].includes(entry.state.toLowerCase())) return "text-warning"
    if (entry.direction === "sent") return "text-error"
    return "text-success"
  }

  // Coco history timestamps are Unix milliseconds, including migrated rows.
  const formatDate = (ts: number) =>
    new Date(ts).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })

  const copyToken = async (entry: TokenHistoryEntry) => {
    if (!entry.token) return
    await navigator.clipboard.writeText(entry.token)
    copiedId = entry.id
    setTimeout(() => (copiedId = null), 2000)
  }
</script>

<div class="flex min-w-0 flex-col gap-2">
  {#if history.length === 0}
    <p class="py-4 text-center text-sm opacity-50">No transaction history yet.</p>
  {:else}
    {#each displayed as entry (entry.id)}
      <div
        class="card2 bg-alt flex min-w-0 flex-col gap-2 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
        <div class="flex min-w-0 flex-col gap-0.5">
          <div class="flex flex-wrap items-center gap-2">
            <span class={`font-semibold ${directionClass(entry)}`}>
              {directionLabel(entry)}
            </span>
            <span class="font-mono font-bold">
              {["finalized", "paid", "issued"].includes(entry.state.toLowerCase())
                ? entry.direction === "sent"
                  ? "-"
                  : "+"
                : ""}{formatCashuSats(entry.amount)} sats
            </span>
            <span class="text-xs capitalize opacity-70"
              >{entry.state.replaceAll("_", " ").toLowerCase()}</span>
          </div>
          <span class="text-xs opacity-50">{formatDate(entry.createdAt)}</span>
        </div>
        {#if entry.direction === "sent" && entry.token}
          <Button
            class="btn btn-ghost btn-xs inline-flex w-full justify-center sm:w-auto"
            onclick={() => copyToken(entry)}
            title="Re-copy token">
            {copiedId === entry.id ? "Copied!" : "Re-copy"}
          </Button>
        {/if}
      </div>
    {/each}

    {#if limit > 0 && history.length > limit}
      <Button class="btn btn-ghost btn-xs self-center" onclick={() => (showAll = !showAll)}>
        {showAll ? "Show less" : `Show all ${history.length} entries`}
      </Button>
    {/if}
  {/if}
</div>
