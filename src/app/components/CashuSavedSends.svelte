<script lang="ts">
  import {onMount, onDestroy} from "svelte"
  import {
    listSavedCashuSends,
    getSavedCashuSend,
    resumeCashuSend,
    cancelPreparedCashuSend,
    retryInterruptedCashuSends,
    observeCashuActivity,
    loadCashuTokenStatus,
    checkCashuTokenStatus,
    cashuTokenStatuses,
    cashuTokenDisplayKey,
  } from "@app/core/cashu"
  import type {SavedCashuSend, SavedSendCursor, SavedSendPage} from "@app/core/cashu-saved-sends"
  import {formatCashuSats} from "@app/util/cashu-format"
  import Button from "@lib/components/Button.svelte"
  import TimestampDetails from "@lib/components/TimestampDetails.svelte"
  import CashuTokenStatus from "./CashuTokenStatus.svelte"

  const {onopen}: {onopen: (token: string) => void} = $props()
  let page = $state<SavedSendPage>({entries: []})
  let cursors = $state<(SavedSendCursor | undefined)[]>([undefined])
  let loading = $state(true)
  let busy = $state("")
  let error = $state("")
  let readError = $state("")
  let notice = $state("")
  let generation = 0
  let alive = true

  const refresh = async (signal?: AbortSignal) => {
    const current = ++generation
    loading = true
    try {
      const result = await listSavedCashuSends(cursors[cursors.length - 1], signal)
      if (!alive || signal?.aborted || current !== generation) return
      page = result
      readError = ""
    } catch {
      if (alive && !signal?.aborted && current === generation)
        readError = "Could not load saved tokens. Try again."
    } finally {
      if (alive && current === generation) loading = false
    }
  }
  onMount(() => observeCashuActivity("history", refresh))
  onDestroy(() => {
    alive = false
    generation++
  })
  $effect(() => {
    const controller = new AbortController()
    for (const entry of page.entries) {
      if (entry.token)
        void loadCashuTokenStatus(entry.token, {
          signal: controller.signal,
          sendOperationId: entry.id,
        })?.catch(() => {})
    }
    return () => controller.abort()
  })

  const act = async (
    entry: SavedCashuSend,
    action: "open" | "resume" | "cancel" | "recover" | "check",
  ) => {
    if (busy) return
    busy = entry.id
    error = ""
    notice = ""
    try {
      if (action === "cancel") {
        await cancelPreparedCashuSend(entry.id)
        if (alive) notice = "Preparation cancelled. Reserved funds are available again."
      } else if (action === "resume") {
        const token = await resumeCashuSend(entry.id)
        if (alive) onopen(token)
      } else if (action === "recover") {
        await retryInterruptedCashuSends()
        const latest = await getSavedCashuSend(entry.id)
        if (alive)
          notice =
            latest.state === "rolled_back"
              ? "Interrupted creation recovered. Check your wallet balance."
              : "Recovery checked. Any unresolved sends remain saved below."
      } else {
        const latest = await getSavedCashuSend(entry.id)
        if (latest.state !== "pending" || !latest.token)
          throw new Error("This token is no longer available to send. Check its history.")
        const status = await loadCashuTokenStatus(latest.token, {
          explicit: true,
          sendOperationId: latest.id,
        })?.catch(() => undefined)
        if (status?.received || status?.check?.state === "spent")
          throw new Error("This token has already been redeemed.")
        if (action === "check") await checkCashuTokenStatus(latest.token)
        else if (alive) onopen(latest.token)
      }
    } catch (e) {
      if (alive) error = e instanceof Error ? e.message : "Could not update this saved send."
    } finally {
      if (alive) {
        busy = ""
        await refresh()
      }
    }
  }
  const nextPage = () => {
    if (!page.next || loading) return
    cursors = [...cursors, page.next]
    void refresh()
  }
  const previousPage = () => {
    cursors = cursors.slice(0, -1)
    void refresh()
  }
</script>

<section
  aria-label="Saved outgoing tokens"
  class="flex min-w-0 flex-col gap-3 border-t border-base-300 pt-4">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <h3 class="text-sm font-semibold">Saved outgoing tokens</h3>
    <Button
      class="btn btn-ghost btn-xs justify-center"
      disabled={loading || Boolean(busy)}
      onclick={() => refresh()}>Refresh saved tokens</Button>
  </div>
  <p class="text-xs opacity-70">
    Reopen tokens created on this device, including older sends. Copying or sharing a token does not
    confirm redemption.
  </p>
  {#if error || readError}<p role="alert" class="text-sm text-error">{error || readError}</p>{/if}
  {#if notice}<p role="status" class="text-sm">{notice}</p>{/if}
  {#if loading}<p role="status" class="text-sm opacity-70">Loading saved tokens…</p>
  {:else if !readError && page.entries.length === 0}<p class="text-sm opacity-70">
      No unresolved sends on this page.
    </p>{/if}
  {#each page.entries as entry (entry.id)}
    {@const status = entry.token
      ? $cashuTokenStatuses[cashuTokenDisplayKey(entry.token)]
      : undefined}
    {@const used =
      status?.check?.state === "spent" ||
      status?.received ||
      status?.outgoing?.state === "spent" ||
      status?.outgoing?.state === "reclaimed"}
    <div class="card2 bg-alt flex min-w-0 flex-col gap-2 p-3 text-sm">
      <div class="flex flex-wrap items-center gap-2">
        <span class="font-mono font-bold">{formatCashuSats(entry.amount)} sats</span>
        {#if entry.token}
          <CashuTokenStatus {status} />
        {:else}<span class="text-warning"
            >{entry.state === "prepared" ? "Preparation saved" : "Creation unconfirmed"}</span
          >{/if}
      </div>
      <span class="break-all text-xs opacity-70">{entry.mintUrl}</span>
      <span class="text-xs opacity-70"><TimestampDetails value={entry.createdAt} /></span>
      {#if status?.checkError}<p class="text-xs text-warning">{status.checkError}</p>{/if}
      <div class="flex flex-wrap gap-2">
        {#if entry.state === "pending" && entry.token && !used}
          <Button
            class="btn btn-neutral btn-sm justify-center"
            disabled={Boolean(busy)}
            onclick={() => act(entry, "open")}>Open token</Button>
          <Button
            class="btn btn-ghost btn-sm justify-center"
            disabled={Boolean(busy) || status?.checking}
            onclick={() => act(entry, "check")}
            >{status?.checking ? "Checking…" : "Check status"}</Button>
        {:else if entry.state === "prepared"}
          <Button
            class="btn btn-neutral btn-sm justify-center"
            disabled={Boolean(busy)}
            onclick={() => act(entry, "resume")}>Resume creation</Button>
          <Button
            class="btn btn-ghost btn-sm justify-center"
            disabled={Boolean(busy)}
            onclick={() => act(entry, "cancel")}>Cancel preparation</Button>
        {:else if entry.state === "executing"}
          <p class="w-full text-xs opacity-70">
            Creation is not confirmed yet. Retry recovery if it does not complete.
          </p>
          <Button
            class="btn btn-neutral btn-sm justify-center"
            disabled={Boolean(busy)}
            onclick={() => act(entry, "recover")}>Retry interrupted sends</Button>
        {:else if entry.state === "rolling_back"}
          <p class="text-xs text-warning">
            Return to wallet was interrupted. Use wallet recovery in Settings.
          </p>
        {/if}
        {#if busy === entry.id}<span role="status" class="self-center text-xs">Working…</span>{/if}
      </div>
    </div>
  {/each}
  {#if cursors.length > 1 || page.next}
    <div class="flex flex-wrap items-center justify-between gap-2">
      <Button
        class="btn btn-ghost btn-sm justify-center"
        disabled={loading || Boolean(busy) || cursors.length === 1}
        onclick={previousPage}>Previous tokens</Button>
      <span class="text-xs opacity-70">Page {cursors.length}</span>
      <Button
        class="btn btn-ghost btn-sm justify-center"
        disabled={loading || Boolean(busy) || !page.next}
        onclick={nextPage}>More saved tokens</Button>
    </div>
  {/if}
</section>
