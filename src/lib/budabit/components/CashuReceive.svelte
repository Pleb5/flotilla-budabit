<script lang="ts">
  import {
    receiveCashuToken,
    trustCashuMint,
    recoverCashuMint,
    UntrustedMintError,
  } from "@lib/budabit/cashu"
  import {getDecodedToken} from "@cashu/coco-core"
  import Button from "@lib/components/Button.svelte"

  let token = $state("")
  let loading = $state(false)
  let received = $state<number | null>(null)
  let error = $state("")
  let trustPrompt = $state<string | null>(null)
  let recoverPrompt = $state<string | null>(null)

  const isOutputsSignedError = (msg: string) =>
    /outputs?\s+already\s+signed/i.test(msg)

  const extractMintUrl = (raw: string): string => {
    try {
      return (getDecodedToken(raw) as any).mint || ""
    } catch {
      return ""
    }
  }

  const redeem = async () => {
    const t = token.trim()
    if (!t) return
    loading = true
    error = ""
    received = null
    trustPrompt = null
    recoverPrompt = null
    try {
      const amount = await receiveCashuToken(t)
      received = amount
      token = ""
    } catch (e: any) {
      if (e instanceof UntrustedMintError) {
        trustPrompt = e.mintUrl
      } else if (isOutputsSignedError(e?.message || "")) {
        recoverPrompt = extractMintUrl(t)
        if (!recoverPrompt) error = e?.message || "Failed to redeem token"
      } else {
        error = e?.message || "Failed to redeem token"
      }
    } finally {
      loading = false
    }
  }

  const trustAndRedeem = async () => {
    if (!trustPrompt) return
    loading = true
    error = ""
    try {
      await trustCashuMint(trustPrompt)
      trustPrompt = null
      const amount = await receiveCashuToken(token.trim())
      received = amount
      token = ""
    } catch (e: any) {
      error = e?.message || "Failed to redeem token"
    } finally {
      loading = false
    }
  }

  const recoverAndRedeem = async () => {
    if (!recoverPrompt) return
    loading = true
    error = ""
    try {
      await recoverCashuMint(recoverPrompt)
      recoverPrompt = null
      const amount = await receiveCashuToken(token.trim())
      received = amount
      token = ""
    } catch (e: any) {
      error = e?.message || "Recovery failed"
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

    {#if recoverPrompt}
      <div class="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3">
        <p class="text-sm">
          The mint says these outputs were already signed. The wallet's counter is out of
          sync with the mint and is reusing blinded messages it shouldn't.
        </p>
        <p class="break-all font-mono text-xs">{recoverPrompt}</p>
        <p class="text-xs opacity-70">
          Recovery cancels the stuck operation and asks the mint for any proofs we missed,
          advancing the counter past the collision range. Then we'll retry.
        </p>
        <div class="flex gap-2">
          <Button
            class="btn btn-warning btn-sm flex-1"
            onclick={recoverAndRedeem}
            disabled={loading}>
            {loading ? "Recovering…" : "Recover and retry"}
          </Button>
          <Button
            class="btn btn-ghost btn-sm"
            onclick={() => (recoverPrompt = null)}
            disabled={loading}>
            Cancel
          </Button>
        </div>
      </div>
    {:else if trustPrompt}
      <div class="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3">
        <p class="text-sm">
          This token is from a mint you don't trust yet:
        </p>
        <p class="break-all font-mono text-xs">{trustPrompt}</p>
        <p class="text-xs opacity-70">
          Trusting a mint means relying on it to honor your ecash. Only trust mints you know.
        </p>
        <div class="flex gap-2">
          <Button
            class="btn btn-warning btn-sm flex-1"
            onclick={trustAndRedeem}
            disabled={loading}>
            {loading ? "Working…" : "Trust mint and redeem"}
          </Button>
          <Button
            class="btn btn-ghost btn-sm"
            onclick={() => (trustPrompt = null)}
            disabled={loading}>
            Cancel
          </Button>
        </div>
      </div>
    {:else}
      <Button
        class="btn btn-primary"
        onclick={redeem}
        disabled={loading || !token.trim()}>
        {loading ? "Redeeming…" : "Redeem Token"}
      </Button>
    {/if}
  {/if}
</div>