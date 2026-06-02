<script lang="ts">
  import {cashuBalancesByMint, createCashuToken, addAutoPayWhitelist} from "@app/core/cashu"
  import {formatCashuSats} from "@app/util/cashu-format"
  import Button from "@lib/components/Button.svelte"

  interface Props {
    amount: number
    mintUrl: string
    label?: string
    extensionId: string
    onresult: (result: {token: string} | {error: string}) => void
  }

  const {amount, mintUrl, label, extensionId, onresult}: Props = $props()

  const balances = $derived($cashuBalancesByMint)
  const balance = $derived(balances.get(mintUrl) ?? 0)

  let alwaysAllow = $state(false)
  let loading = $state(false)
  let error = $state("")

  const approve = async () => {
    loading = true
    error = ""
    try {
      if (alwaysAllow) {
        addAutoPayWhitelist(extensionId)
      }
      const token = await createCashuToken(amount, mintUrl)
      onresult({token})
    } catch (e: any) {
      error = e?.message || "Failed to create token"
      onresult({error: error})
    } finally {
      loading = false
    }
  }

  const reject = () => {
    onresult({error: "user_rejected"})
  }
</script>

<div class="flex min-w-0 flex-col gap-4 p-2 sm:gap-6 sm:p-4">
  <div class="flex flex-col gap-2">
    <h3 class="text-lg font-bold">Payment Request</h3>
    <p class="text-sm opacity-75">
      <strong>{label || extensionId}</strong> wants to spend
      <strong>{formatCashuSats(amount)} sats</strong>
      from <span class="break-all font-mono text-xs">{mintUrl}</span>
    </p>
    <p class="text-xs opacity-50">
      Your balance at this mint: {formatCashuSats(balance)} sats
    </p>
  </div>

  {#if balance < amount}
    <div class="rounded-lg bg-warning/10 p-3 text-sm text-warning">
      Insufficient balance. You need {formatCashuSats(amount - balance)} more sats.
    </div>
  {/if}

  <label class="flex cursor-pointer items-start gap-2 text-sm">
    <input type="checkbox" class="checkbox checkbox-sm" bind:checked={alwaysAllow} />
    <span
      >Always allow <strong class="break-all">{label || extensionId}</strong> to deduct from this wallet</span>
  </label>

  {#if error}
    <p class="text-sm text-error">{error}</p>
  {/if}

  <div class="flex flex-col gap-2 sm:flex-row sm:gap-3">
    <Button
      class="btn btn-ghost inline-flex flex-1 justify-center"
      onclick={reject}
      disabled={loading}>Reject</Button>
    <Button
      class="btn btn-primary inline-flex flex-1 justify-center"
      onclick={approve}
      disabled={loading || balance < amount}>
      {loading ? "Processing…" : "Approve"}
    </Button>
  </div>
</div>
