<script lang="ts">
  import {onMount} from "svelte"
  import {CashuReceiptLookupIncomplete} from "@app/core/cashu-operation-lookup"
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
    loadCashuTokenStatus,
    CashuReceiveError,
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
  import ClickHelp from "@lib/components/ClickHelp.svelte"

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
    | "spent"
    | "partial"
    | "pending"
    | "receipt-check"
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
  let alreadyReceived = $state(false)
  let receivedAt = $state<number | undefined>()
  let untrustedMintUrl = $state("")
  let recoverMintUrl = $state("")
  let receiptController = new AbortController()
  onMount(() => {
    const pause = () => {
      if (document.hidden) receiptController.abort()
    }
    document.addEventListener("visibilitychange", pause)
    return () => {
      receiptController.abort()
      document.removeEventListener("visibilitychange", pause)
    }
  })

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

    try {
      const known = await loadCashuTokenStatus(tokenInfo.token, {
        explicit: true,
        signal: receiptController.signal,
      })
      if (known?.received) {
        received = known.received.amount
        receivedAt = known.received.at
        alreadyReceived = true
        step = "success"
        return
      }
      // A cached spend observation cannot rule out an older local receipt whose
      // index is missing. The explicit receive path reconciles that receipt first.
    } catch {
      setError("Couldn't read this token's receipt. Reopen your wallet and try again.")
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
      receiptController = new AbortController()
      const amount = await receiveCashuToken(tokenInfo.token, receiptController.signal)
      received = amount
      step = "success"
      onredeemed?.({amount, mintUrl: tokenInfo.mintUrl})
    } catch (e: any) {
      if (e instanceof CashuReceiptLookupIncomplete || e?.name === "AbortError") {
        step = "receipt-check"
        return
      }
      if (e instanceof CashuReceiveError && e.code !== "failed") {
        step = e.code
        return
      }

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

      setError("Couldn't redeem this token. Please try again.")
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
      error = "Couldn't add this mint. Please try again."
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
      error = "Couldn't finish recovery. Please try again."
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
      <div>{alreadyReceived ? "Cashu receipt" : "Redeem Cashu Token"}</div>
    {/snippet}
    {#snippet info()}
      <span>
        {amountLabel}{#if mintHost}{" from "}{mintHost}{/if}
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
      <div class="text-warning">
        <ClickHelp
          label="New mint"
          text="This token comes from a mint you haven't added yet. Only continue if you trust it to hold your sats." />
      </div>

      <CashuMintCard mintUrl={untrustedMintUrl} />

      {#if error}
        <p class="text-sm text-error">{error}</p>
      {/if}

      <Button
        class="btn btn-warning btn-lg min-h-fit w-full whitespace-normal text-center"
        onclick={trustMintBackupAndRedeem}
        disabled={!walletUnlocked}>
        Trust mint & redeem
      </Button>

      <ClickHelp
        label="Backup included"
        text="Before receiving the token, Budabit downloads an updated wallet backup that includes this mint. Keep it with your other wallet backups." />
    </div>
  {:else if step === "trusting"}
    <div class="flex min-h-32 flex-col items-center justify-center gap-3 text-sm">
      <span class="loading loading-spinner loading-md"></span>
      <p class="opacity-75">Trusting mint, downloading backup, and redeeming...</p>
    </div>
  {:else if step === "recover"}
    <div class="flex flex-col gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
      <ClickHelp
        label="Wallet needs recovery"
        text="A previous swap may not have finished on this device. Recover the wallet with this mint, then try redeeming again." />

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
      <p class="opacity-75">Recovering wallet...</p>
    </div>
  {:else if step === "success"}
    <div class="rounded-lg bg-success/10 p-4 text-center text-success">
      <p class="text-lg font-bold">
        {alreadyReceived ? "Already received" : "Received"} · {formatCashuSats(received || 0)} sats
      </p>
      {#if alreadyReceived}<ClickHelp
          label="In this wallet"
          text={`This token was added to this wallet${receivedAt ? ` on ${new Date(receivedAt).toLocaleString()}` : ""}. You don't need to redeem it again.`} />{/if}
      <Button class="btn btn-ghost btn-sm mt-2 inline-flex justify-center" onclick={close}>
        Close
      </Button>
    </div>
  {:else if step === "spent" || step === "partial"}
    <div class="flex flex-col items-center gap-3 rounded-lg bg-base-200 p-4 text-center">
      <ClickHelp
        label={step === "spent" ? "Already redeemed" : "Partly redeemed"}
        text={step === "spent"
          ? "The mint confirmed this token has been used, so it can't be received again. This wallet doesn't have a receipt for it."
          : "Part of this token has already been used. Ask the sender about the remaining amount."} />
      <Button class="btn btn-ghost btn-sm" onclick={close}>Close</Button>
    </div>
  {:else if step === "receipt-check"}
    <div class="flex flex-col gap-3">
      <p>More wallet history to check for a saved receipt. No new redemption has been started.</p>
      <Button onclick={redeemToken}>Continue checking</Button>
    </div>
  {:else if step === "pending"}
    <div class="flex flex-col items-center gap-3 rounded-lg bg-warning/10 p-4 text-center">
      <ClickHelp
        label="Receipt not yet confirmed"
        text="The receive attempt is saved. Check the receipt to let the wallet finish with the mint; you won't start a second receive attempt." />
      <Button class="btn btn-primary btn-sm" onclick={redeemToken}>Check receipt</Button>
      <Button class="btn btn-ghost btn-sm" onclick={close}>Close</Button>
    </div>
  {:else if step === "error"}
    <div class="flex flex-col gap-3 rounded-lg border border-error/40 bg-error/10 p-3 text-sm">
      <p class="text-error">{error}</p>
      <Button class="btn btn-ghost btn-sm inline-flex justify-center" onclick={close}>Close</Button>
    </div>
  {/if}
</div>
