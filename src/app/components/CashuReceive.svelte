<script lang="ts">
  import {getDecodedToken} from "@cashu/coco-core"
  import {
    cashuMints,
    cashuBackupConfirmed,
    cashuSeedLocked,
    cashuSetupRequired,
    cashuSetupResolved,
    receiveCashuToken,
    trustCashuMint,
    recoverCashuMint,
    confirmCashuBackup,
    getCashuMnemonic,
  } from "@app/core/cashu"
  import {createCashuBackupText} from "@app/util/cashu-backup"
  import {formatCashuSats} from "@app/util/cashu-format"
  import {downloadText} from "@lib/html"
  import Button from "@lib/components/Button.svelte"
  import CashuMintChangeConfirm from "@app/components/CashuMintChangeConfirm.svelte"
  import {pushModal} from "@app/util/modal"

  // Recognize the untrusted-mint error by any of the surface markers — class
  // identity (instanceof) breaks across HMR / module duplication, and even
  // class-field code/name attributes can vary depending on emit. Falls back
  // to message-shape match, which catches both our own UntrustedMintError
  // and any equivalent coco-internal "Mint X is not trusted" raise.
  const matchUntrustedMint = (e: any): {mintUrl: string} | null => {
    if (!e || typeof e !== "object") return null
    const code = (e as {code?: string}).code
    const name = (e as {name?: string}).name
    const msg =
      typeof (e as {message?: unknown}).message === "string" ? (e as {message: string}).message : ""
    const looksUntrusted =
      code === "untrusted_mint" || name === "UntrustedMintError" || /\bis not trusted\b/i.test(msg)
    if (!looksUntrusted) return null
    const explicit = (e as {mintUrl?: unknown}).mintUrl
    if (typeof explicit === "string" && explicit) return {mintUrl: explicit}
    const fromMsg = msg.match(/Mint\s+(\S+)\s+is not trusted/i)
    if (fromMsg && fromMsg[1]) return {mintUrl: fromMsg[1]}
    return null
  }

  let token = $state("")
  let loading = $state(false)
  let received = $state<number | null>(null)
  let error = $state("")
  let trustPrompt = $state<string | null>(null)
  let recoverPrompt = $state<string | null>(null)

  const mints = $derived($cashuMints)
  const configuredWallet = $derived(
    $cashuSetupResolved && $cashuBackupConfirmed && !$cashuSetupRequired && !$cashuSeedLocked,
  )

  const isOutputsSignedError = (msg: string) => /outputs?\s+already\s+signed/i.test(msg)

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
      console.error("[cashu] redeem error:", e, {name: e?.name, code: e?.code, message: e?.message})
      const untrusted = matchUntrustedMint(e)
      if (untrusted) {
        trustPrompt = untrusted.mintUrl
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

  const trustAndRedeem = async (recover = false): Promise<boolean | string> => {
    if (!trustPrompt) return false
    loading = true
    error = ""
    try {
      const nextMints = Array.from(new Set([...mints, trustPrompt]))
      const backupText = configuredWallet
        ? createCashuBackupText({mnemonic: getCashuMnemonic(), mints: nextMints})
        : ""
      await trustCashuMint(trustPrompt)
      if (configuredWallet) {
        downloadText("Budabit Cashu Wallet Seed.txt", backupText)
        await confirmCashuBackup()
      }
      if (recover) await recoverCashuMint(trustPrompt)
      trustPrompt = null
      const amount = await receiveCashuToken(token.trim())
      received = amount
      token = ""
      return true
    } catch (e: any) {
      error = e?.message || "Failed to redeem token"
      return error
    } finally {
      loading = false
    }
  }

  const confirmTrustAndRedeem = () => {
    if (!trustPrompt || !configuredWallet) {
      trustAndRedeem(false)
      return
    }

    pushModal(CashuMintChangeConfirm, {
      action: "add",
      mintUrl: trustPrompt,
      addLabel: "Trust, back up, and redeem",
      addRecoveryLabel: "Trust, recover, and redeem",
      confirm: ({recover}: {recover: boolean}) => trustAndRedeem(recover),
    })
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

<div class="flex min-w-0 flex-col gap-4">
  {#if received !== null}
    <div class="rounded-lg bg-success/10 p-4 text-center text-success">
      <p class="text-lg font-bold">+{formatCashuSats(received)} sats received!</p>
      <Button class="btn btn-ghost btn-sm mt-2" onclick={() => (received = null)}>
        Redeem another
      </Button>
    </div>
  {:else}
    <div class="flex flex-col gap-2">
      <label class="text-sm font-medium" for="cashu-token-input">Paste Cashu Token</label>
      <textarea
        id="cashu-token-input"
        class="textarea textarea-bordered min-w-0 break-all font-mono text-xs"
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
          The mint says these outputs were already signed. The wallet's counter is out of sync with
          the mint and is reusing blinded messages it shouldn't.
        </p>
        <p class="break-all font-mono text-xs">{recoverPrompt}</p>
        <p class="text-xs opacity-70">
          Recovery cancels the stuck operation and asks the mint for any proofs we missed, advancing
          the counter past the collision range. Then we'll retry.
        </p>
        <div class="flex flex-col gap-2 sm:flex-row">
          <Button
            class="btn btn-warning btn-sm inline-flex flex-1 justify-center"
            onclick={recoverAndRedeem}
            disabled={loading}>
            {loading ? "Recovering…" : "Recover and retry"}
          </Button>
          <Button
            class="btn btn-ghost btn-sm inline-flex justify-center"
            onclick={() => (recoverPrompt = null)}
            disabled={loading}>
            Cancel
          </Button>
        </div>
      </div>
    {:else if trustPrompt}
      <div class="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3">
        <p class="text-sm">This token is from a mint you don't trust yet:</p>
        <p class="break-all font-mono text-xs">{trustPrompt}</p>
        <p class="text-xs opacity-70">
          Trusting a mint means relying on it to honor your ecash. Only trust mints you know.
        </p>
        <div class="flex flex-col gap-2 sm:flex-row">
          <Button
            class="btn btn-warning btn-sm inline-flex flex-1 justify-center"
            onclick={confirmTrustAndRedeem}
            disabled={loading}>
            {loading ? "Working…" : configuredWallet ? "Trust mint, back up, and redeem" : "Trust mint and redeem"}
          </Button>
          <Button
            class="btn btn-ghost btn-sm inline-flex justify-center"
            onclick={() => (trustPrompt = null)}
            disabled={loading}>
            Cancel
          </Button>
        </div>
      </div>
    {:else}
      <Button
        class="btn btn-primary inline-flex w-full justify-center"
        onclick={redeem}
        disabled={loading || !token.trim()}>
        {loading ? "Redeeming…" : "Redeem Token"}
      </Button>
    {/if}
  {/if}
</div>
