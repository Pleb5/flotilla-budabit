<script lang="ts">
  import {receiveCashuToken} from "@lib/budabit/cashu"
  import Button from "@lib/components/Button.svelte"

  let token = $state("")
  let loading = $state(false)
  let received = $state<number | null>(null)
  let error = $state("")

  const redeem = async () => {
    const t = token.trim()
    if (!t) return
    loading = true
    error = ""
    received = null
    try {
      const amount = await receiveCashuToken(t)
      received = amount
      token = ""
    } catch (e: any) {
      error = e?.message || "Failed to redeem token"
    } finally {
      loading = false
    }
  }
</script>

<div class="flex flex-col gap-4">
  {#if received !== null}
    <div class="rounded-lg bg-success/10 p-4 text-center text-success">
      <p class="text-lg font-bold">+{received.toLocaleString()} sats received!</p>
      <Button class="btn btn-ghost btn-sm mt-2" onclick={() => (received = null)}>
        Redeem another
      </Button>
    </div>
  {:else}
    <div class="flex flex-col gap-2">
      <label class="text-sm font-medium" for="cashu-token-input">Paste Cashu Token</label>
      <textarea
        id="cashu-token-input"
        class="textarea textarea-bordered font-mono text-xs"
        rows={4}
        placeholder="cashuA..."
        bind:value={token}></textarea>
    </div>

    {#if error}
      <p class="text-sm text-error">{error}</p>
    {/if}

    <Button
      class="btn btn-primary"
      onclick={redeem}
      disabled={loading || !token.trim()}>
      {loading ? "Redeeming…" : "Redeem Token"}
    </Button>
  {/if}
</div>