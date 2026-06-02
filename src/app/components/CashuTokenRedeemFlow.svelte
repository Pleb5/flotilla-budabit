<script lang="ts">
  import {
    cashuBackupConfirmed,
    cashuMints,
    cashuSeedLocked,
    cashuSetupRequired,
    cashuSetupResolved,
    confirmCashuBackup,
    getCashuMnemonic,
    receiveCashuToken,
    recoverCashuMint,
    trustCashuMint,
  } from "@app/core/cashu"
  import CashuMintCard from "@app/components/CashuMintCard.svelte"
  import CashuSeedBackup from "@app/components/CashuSeedBackup.svelte"
  import {createCashuBackupText} from "@app/util/cashu-backup"
  import {formatCashuSats} from "@app/util/cashu-format"
  import {
    extractCashuMintUrl,
    getCashuMintDisplayName,
    getCashuTokenInfo,
    isCashuOutputsSignedError,
    matchUntrustedCashuMint,
    shortenCashuToken,
  } from "@app/util/cashu-token"
  import {downloadText} from "@lib/html"
  import Button from "@lib/components/Button.svelte"
  import ModalHeader from "@lib/components/ModalHeader.svelte"

  type Step =
    | "loading"
    | "setup"
    | "unlock"
    | "backup"
    | "redeeming"
    | "untrusted"
    | "recover"
    | "trusting"
    | "recovering"
    | "success"
    | "error"

  interface Props {
    token: string
    onredeemed?: (result: {amount: number; mintUrl: string}) => void
  }

  const {token, onredeemed}: Props = $props()

  const normalizeMintUrl = (mintUrl: string) => {
    try {
      const url = new URL(mintUrl)
      url.hash = ""
      url.search = ""
      return url.toString().replace(/\/$/, "")
    } catch {
      return mintUrl.trim().replace(/\/$/, "")
    }
  }

  const tokenInfo = $derived(getCashuTokenInfo(token))
  const mints = $derived($cashuMints)
  const walletUnlocked = $derived($cashuSetupResolved && !$cashuSetupRequired && !$cashuSeedLocked)
  const tokenMintTrusted = $derived.by(() => {
    if (!tokenInfo) return false

    const tokenMint = normalizeMintUrl(tokenInfo.mintUrl)
    return mints.some(mint => normalizeMintUrl(mint) === tokenMint)
  })
  const amountLabel = $derived.by(() => {
    if (!tokenInfo) return "Cashu token"
    if (tokenInfo.amount <= 0) return "Cashu token"
    return `${formatCashuSats(tokenInfo.amount)} ${tokenInfo.unit === "sat" ? "sats" : tokenInfo.unit}`
  })
  const mintHost = $derived(tokenInfo ? getCashuMintDisplayName(tokenInfo.mintUrl) : "")
  const tokenLabel = $derived(
    tokenInfo ? shortenCashuToken(tokenInfo.token) : shortenCashuToken(token),
  )

  let step = $state<Step>("loading")
  let started = $state(false)
  let error = $state("")
  let received = $state<number | null>(null)
  let untrustedMintUrl = $state("")
  let recoverMintUrl = $state("")

  const close = () => history.back()

  const setError = (message: string) => {
    error = message
    step = "error"
  }

  const continueRedeem = async () => {
    error = ""

    if (!tokenInfo) {
      setError("This does not look like a valid Cashu token.")
      return
    }

    if (!$cashuSetupResolved) {
      step = "loading"
      return
    }

    if ($cashuSetupRequired) {
      step = "setup"
      return
    }

    if ($cashuSeedLocked) {
      step = "unlock"
      return
    }

    if (!tokenMintTrusted) {
      untrustedMintUrl = tokenInfo.mintUrl
      step = "untrusted"
      return
    }

    if (!$cashuBackupConfirmed) {
      step = "backup"
      return
    }

    await redeemToken()
  }

  const redeemToken = async () => {
    if (!tokenInfo) return

    step = "redeeming"
    error = ""
    untrustedMintUrl = ""
    recoverMintUrl = ""

    try {
      const amount = await receiveCashuToken(tokenInfo.token)
      received = amount
      step = "success"
      onredeemed?.({amount, mintUrl: tokenInfo.mintUrl})
    } catch (e: any) {
      console.error("[cashu] redeem flow error:", e, {
        name: e?.name,
        code: e?.code,
        message: e?.message,
      })

      const untrusted = matchUntrustedCashuMint(e)
      if (untrusted) {
        untrustedMintUrl = untrusted.mintUrl
        step = "untrusted"
        return
      }

      if (isCashuOutputsSignedError(e?.message || "")) {
        recoverMintUrl = extractCashuMintUrl(tokenInfo.token)
        if (recoverMintUrl) {
          step = "recover"
          return
        }
      }

      setError(e?.message || "Failed to redeem token")
    }
  }

  const trustMintBackupAndRedeem = async () => {
    if (!tokenInfo || !untrustedMintUrl || !walletUnlocked) return

    step = "trusting"
    error = ""

    try {
      const nextMints = Array.from(new Set([...mints, untrustedMintUrl]))
      const backupText = createCashuBackupText({mnemonic: getCashuMnemonic(), mints: nextMints})

      await trustCashuMint(untrustedMintUrl)
      downloadText("Budabit Cashu Wallet Seed.txt", backupText)
      await confirmCashuBackup()

      untrustedMintUrl = ""
      await redeemToken()
    } catch (e: any) {
      untrustedMintUrl = untrustedMintUrl || tokenInfo.mintUrl
      error = e?.message || "Failed to trust mint and redeem token"
      step = "untrusted"
    }
  }

  const recoverAndRedeem = async () => {
    if (!recoverMintUrl) return

    step = "recovering"
    error = ""

    try {
      await recoverCashuMint(recoverMintUrl)
      recoverMintUrl = ""
      await redeemToken()
    } catch (e: any) {
      error = e?.message || "Recovery failed"
      step = "recover"
    }
  }

  $effect(() => {
    if (started) return
    if (!$cashuSetupResolved) {
      step = "loading"
      return
    }

    started = true
    continueRedeem()
  })
</script>

<div class="flex min-w-0 flex-col gap-4 p-2 sm:p-4">
  <ModalHeader>
    {#snippet title()}
      <div>Redeem Cashu Token</div>
    {/snippet}
    {#snippet info()}
      <span>
        {amountLabel}{#if mintHost}
          from {mintHost}{/if}
      </span>
    {/snippet}
  </ModalHeader>

  <div class="rounded-box border border-base-300 bg-base-200/40 p-3 text-xs">
    <p class="break-all font-mono opacity-75">{tokenLabel}</p>
  </div>

  {#if step === "loading"}
    <div class="flex min-h-32 items-center justify-center text-sm opacity-70">
      Loading Cashu wallet...
    </div>
  {:else if step === "setup"}
    <CashuSeedBackup mode="setup" onconfirmed={continueRedeem} />
  {:else if step === "unlock"}
    <CashuSeedBackup mode="unlock" onconfirmed={continueRedeem} />
  {:else if step === "backup"}
    <CashuSeedBackup mode="backup" onconfirmed={continueRedeem} />
  {:else if step === "redeeming"}
    <div class="flex min-h-32 flex-col items-center justify-center gap-3 text-sm">
      <span class="loading loading-spinner loading-md"></span>
      <p class="opacity-75">Redeeming token...</p>
    </div>
  {:else if step === "untrusted"}
    <div class="flex min-w-0 flex-col gap-4">
      <div class="rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm text-warning">
        You don't yet trust the mint this token is from. You can only redeem this token if you trust
        this mint and register it in your wallet backup.
      </div>

      <CashuMintCard mintUrl={untrustedMintUrl} />

      {#if error}
        <p class="text-sm text-error">{error}</p>
      {/if}

      <Button
        class="btn btn-warning btn-lg min-h-fit w-full whitespace-normal text-center"
        onclick={trustMintBackupAndRedeem}
        disabled={!walletUnlocked}>
        Trust this mint, create new wallet backup and redeem token
      </Button>

      <p class="text-xs opacity-70">
        Budabit will download an updated backup file that includes this mint before receiving the
        token.
      </p>
    </div>
  {:else if step === "trusting"}
    <div class="flex min-h-32 flex-col items-center justify-center gap-3 text-sm">
      <span class="loading loading-spinner loading-md"></span>
      <p class="opacity-75">Trusting mint, downloading backup, and redeeming...</p>
    </div>
  {:else if step === "recover"}
    <div class="flex flex-col gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
      <p>
        The mint says these outputs were already signed. The wallet counter is out of sync with this
        mint.
      </p>
      <p class="break-all font-mono text-xs opacity-75">{recoverMintUrl}</p>
      <p class="text-xs opacity-70">
        Recovery asks the mint for proofs this wallet may have missed, advances the counter, and
        then retries receiving this token.
      </p>

      {#if error}
        <p class="text-sm text-error">{error}</p>
      {/if}

      <div class="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button
          class="btn btn-warning btn-sm inline-flex justify-center"
          onclick={recoverAndRedeem}>
          Recover and retry
        </Button>
        <Button class="btn btn-ghost btn-sm inline-flex justify-center" onclick={close}
          >Cancel</Button>
      </div>
    </div>
  {:else if step === "recovering"}
    <div class="flex min-h-32 flex-col items-center justify-center gap-3 text-sm">
      <span class="loading loading-spinner loading-md"></span>
      <p class="opacity-75">Recovering wallet counter...</p>
    </div>
  {:else if step === "success"}
    <div class="rounded-lg bg-success/10 p-4 text-center text-success">
      <p class="text-lg font-bold">
        +{formatCashuSats(received || 0)} sats received!
      </p>
      <Button class="btn btn-ghost btn-sm mt-2 inline-flex justify-center" onclick={close}>
        Close
      </Button>
    </div>
  {:else if step === "error"}
    <div class="flex flex-col gap-3 rounded-lg border border-error/40 bg-error/10 p-3 text-sm">
      <p class="text-error">{error}</p>
      <Button class="btn btn-ghost btn-sm inline-flex justify-center" onclick={close}>Close</Button>
    </div>
  {/if}
</div>
