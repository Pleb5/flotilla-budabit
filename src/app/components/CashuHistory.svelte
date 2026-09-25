<script lang="ts">
  import {onMount} from "svelte"
  import {
    cashuTokenHistory,
    cancelCashuInvoicePayment,
    cashuTokenStatuses,
    cashuTokenDisplayKey,
    loadCashuTokenStatus,
    checkCashuTokenStatus,
    checkRecentCashuTokens,
    pauseCashuTokenChecks,
  } from "@app/core/cashu"
  import type {TokenHistoryEntry} from "@app/core/cashu"
  import {formatCashuSats} from "@app/util/cashu-format"
  import Button from "@lib/components/Button.svelte"
  import TimestampDetails from "@lib/components/TimestampDetails.svelte"
  import ClickHelp from "@lib/components/ClickHelp.svelte"
  import CashuTokenStatus from "./CashuTokenStatus.svelte"

  interface Props {
    limit?: number
  }

  const {limit = 0}: Props = $props()

  const history = $derived($cashuTokenHistory)
  let showAll = $state(false)
  let copiedId = $state<string | null>(null)
  let releasing = $state("")
  let releaseError = $state("")

  const releaseQuote = async (entry: TokenHistoryEntry) => {
    if (!entry.paymentOperationId || releasing) return
    releasing = entry.id
    releaseError = ""
    try {
      await cancelCashuInvoicePayment(entry.paymentOperationId)
    } catch (e) {
      releaseError = e instanceof Error ? e.message : "Could not release the fee quote."
    } finally {
      releasing = ""
    }
  }

  const displayed = $derived(limit > 0 && !showAll ? history.slice(0, limit) : history)

  $effect(() => {
    for (const entry of displayed) {
      if (entry.token) void loadCashuTokenStatus(entry.token)?.catch(() => {})
    }
    if (history.length) void checkRecentCashuTokens().catch(() => {})
  })
  onMount(() => {
    const refresh = () => {
      if (!document.hidden) void checkRecentCashuTokens().catch(() => {})
    }
    window.addEventListener("focus", refresh)
    window.addEventListener("online", refresh)
    document.addEventListener("visibilitychange", refresh)
    return () => {
      pauseCashuTokenChecks()
      window.removeEventListener("focus", refresh)
      window.removeEventListener("online", refresh)
      document.removeEventListener("visibilitychange", refresh)
    }
  })

  const directionLabel = (entry: TokenHistoryEntry) => {
    if (entry.direction === "sent" && entry.token) return "Token created"
    if (!["finalized", "paid", "issued", "pending"].includes(entry.state.toLowerCase()))
      return "Transaction"
    if (entry.state.toLowerCase() === "pending" && entry.direction === "minted") return "Top-up"
    if (entry.direction === "sent") return "Sent"
    if (entry.direction === "received") return "Received"
    return "Minted"
  }

  const directionClass = (entry: TokenHistoryEntry) => {
    if (entry.direction === "sent" && entry.token) return "text-base-content"
    if (
      ["failed", "rolled_back", "rolledback", "recovery_required"].includes(
        entry.state.toLowerCase(),
      )
    )
      return "opacity-60"
    if (!["finalized", "paid", "issued"].includes(entry.state.toLowerCase())) return "text-warning"
    if (entry.direction === "sent") return "text-error"
    return "text-success"
  }

  const copyToken = async (entry: TokenHistoryEntry) => {
    if (!entry.token) return
    await navigator.clipboard.writeText(entry.token)
    copiedId = entry.id
    setTimeout(() => (copiedId = null), 2000)
  }

  const stateLabels: Record<string, string> = {
    finalized: "Complete",
    paid: "Complete",
    issued: "Complete",
    pending: "Processing",
    prepared: "Ready",
    unpaid: "Awaiting payment",
    failed: "Not completed",
    rolled_back: "Cancelled",
    rolledBack: "Cancelled",
    recovery_required: "Needs attention",
  }
  const stateLabel = (state: string) => stateLabels[state] || "Needs attention"
</script>

<div class="flex min-w-0 flex-col gap-2">
  {#if releaseError}<p role="alert" class="text-sm text-error">{releaseError}</p>{/if}
  {#if history.length === 0}
    <p class="py-4 text-center text-sm opacity-50">No transaction history yet.</p>
  {:else}
    {#each displayed as entry (entry.id)}
      {@const status = entry.token
        ? $cashuTokenStatuses[cashuTokenDisplayKey(entry.token)]
        : undefined}
      {@const used =
        status?.check?.state === "spent" ||
        status?.outgoing?.state === "spent" ||
        status?.outgoing?.state === "reclaimed" ||
        entry.state === "finalized" ||
        entry.state === "rolled_back"}
      <div
        class="card2 bg-alt flex min-w-0 flex-col gap-2 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
        <div class="flex min-w-0 flex-col gap-0.5">
          <div class="flex flex-wrap items-center gap-2">
            <span class={`font-semibold ${directionClass(entry)}`}>
              {directionLabel(entry)}
            </span>
            <span class="font-mono font-bold">
              {entry.token && entry.direction === "sent" && entry.state !== "rolled_back"
                ? "−"
                : ["finalized", "paid", "issued"].includes(entry.state.toLowerCase())
                  ? entry.direction === "sent"
                    ? "-"
                    : "+"
                  : ""}{formatCashuSats(entry.amount)} sats
            </span>
            {#if entry.direction === "sent" && entry.token}
              <CashuTokenStatus
                status={status || {
                  id: entry.id,
                  outgoing: {
                    operationId: entry.tokenOperationId || "",
                    state:
                      entry.state === "finalized"
                        ? "spent"
                        : entry.state === "rolled_back"
                          ? "reclaimed"
                          : "created",
                  },
                }} />
            {:else}
              <span class="text-xs opacity-70">{stateLabel(entry.state)}</span>
            {/if}
          </div>
          <div class="text-xs opacity-70"><TimestampDetails value={entry.createdAt} /></div>
          {#if status?.checkError}<span class="text-warning"
              ><ClickHelp
                label="Couldn't check status"
                text="The mint couldn't be reached. Any status shown is from the last successful check. Try again shortly." /></span
            >{/if}
          {#if entry.error}<span class="text-warning"
              ><ClickHelp
                label="Needs attention"
                text="The wallet couldn't finish this transaction. Check its status before trying again." /></span
            >{/if}
        </div>
        {#if entry.paymentOperationId && entry.state === "prepared"}
          <Button
            class="btn btn-ghost btn-xs justify-center"
            onclick={() => releaseQuote(entry)}
            disabled={Boolean(releasing)}>Cancel unpaid payment</Button>
        {:else if entry.direction === "sent" && entry.token}
          {#if !used}<div class="flex flex-wrap items-center gap-1">
              <Button
                class="btn btn-ghost btn-xs min-h-10 justify-center"
                disabled={status?.checking}
                onclick={() => checkCashuTokenStatus(entry.token!).catch(() => {})}>
                {status?.checking ? "Checking…" : "Check status"}
              </Button>
              <Button
                class="btn btn-ghost btn-xs inline-flex min-h-10 justify-center"
                onclick={() => copyToken(entry)}>
                {copiedId === entry.id ? "Copied!" : "Copy token"}
              </Button>
            </div>{/if}
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
