<script lang="ts">
  import {
    cashuMints,
    cashuSeedEncrypted,
    cashuSeedLocked,
    confirmCashuBackup,
    encryptCashuSeedAtRest,
    getCashuMnemonic,
  } from "@app/core/cashu"
  import {
    createCashuBackupText,
    createEncryptedCashuBackupText,
    type CashuBackupData,
  } from "@app/util/cashu-backup"
  import {downloadText} from "@lib/html"
  import {validateNewPassphrase} from "@app/util/passphrase"
  import CashuMintManager from "@app/components/CashuMintManager.svelte"
  import Button from "@lib/components/Button.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import Key from "@assets/icons/key-minimalistic.svg?dataurl"
  import ArrowDown from "@assets/icons/arrow-down.svg?dataurl"
  import Eye from "@assets/icons/eye.svg?dataurl"
  import EyeClosed from "@assets/icons/eye-closed.svg?dataurl"

  interface Props {
    onconfirmed?: () => void
    onback?: () => void
  }

  const {onconfirmed, onback}: Props = $props()

  let seedRevision = $state(0)
  let error = $state("")
  let status = $state("")

  let encryptDownload = $state(false)
  let downloadPassphrase = $state("")
  let downloadPassphraseConfirm = $state("")
  let showDownloadPassphrase = $state(false)
  let showDownloadPassphraseConfirm = $state(false)

  let localPassphrase = $state("")
  let localPassphraseConfirm = $state("")
  let showLocalPassphrase = $state(false)
  let showLocalPassphraseConfirm = $state(false)
  let localEncrypting = $state(false)

  let backupDownloadKey = $state("")

  const seedLocked = $derived($cashuSeedLocked)
  const seedEncrypted = $derived($cashuSeedEncrypted)
  const mints = $derived($cashuMints)
  const mnemonic = $derived.by(() => {
    seedRevision
    seedLocked
    seedEncrypted

    try {
      return getCashuMnemonic()
    } catch {
      return ""
    }
  })
  const words = $derived(mnemonic ? mnemonic.split(" ") : [])
  const backupData = $derived<CashuBackupData>({mnemonic, mints})
  const backupKey = $derived(JSON.stringify(backupData))
  const hasDownloadedCurrentBackup = $derived(Boolean(backupKey && backupDownloadKey === backupKey))

  const downloadBackup = async () => {
    if (!mnemonic || mints.length === 0) return

    error = ""
    status = ""

    try {
      const passphraseError = encryptDownload
        ? validateNewPassphrase(downloadPassphrase, downloadPassphraseConfirm)
        : ""

      if (passphraseError) {
        error = passphraseError
        return
      }

      const text = encryptDownload
        ? await createEncryptedCashuBackupText(backupData, downloadPassphrase)
        : createCashuBackupText(backupData)

      downloadText("Budabit Cashu Wallet Seed.txt", text)
      backupDownloadKey = backupKey
      status = encryptDownload
        ? "Encrypted Cashu backup downloaded. Keep the file and passphrase safe."
        : "Cashu backup downloaded. Keep the file private."
    } catch (e: any) {
      error = e?.message || "Could not download Cashu backup."
    }
  }

  const finishSetup = async () => {
    if (mints.length === 0) {
      error = "Add at least one trusted mint before continuing."
      return
    }
    if (!hasDownloadedCurrentBackup) {
      error =
        "Download the backup file before continuing. It includes both seed words and trusted mints."
      return
    }

    error = ""
    status = ""
    try {
      await confirmCashuBackup()
      onconfirmed?.()
    } catch (e: any) {
      error = e?.message || "Could not finish Cashu wallet setup."
    }
  }

  const storeLocalEncrypted = async () => {
    const passphraseError = validateNewPassphrase(localPassphrase, localPassphraseConfirm)
    if (passphraseError) {
      error = passphraseError
      return
    }

    localEncrypting = true
    error = ""
    status = ""
    try {
      await encryptCashuSeedAtRest(localPassphrase)
      seedRevision++
      localPassphrase = ""
      localPassphraseConfirm = ""
      status = "Cashu seed is now stored encrypted on this device."
    } catch (e: any) {
      error = e?.message || "Could not encrypt the Cashu seed on this device."
    } finally {
      localEncrypting = false
    }
  }
</script>

<div class="flex min-w-0 flex-col gap-4 p-2 sm:gap-6 sm:p-4">
  {#if !mnemonic}
    <div class="flex flex-col gap-2">
      <h3 class="text-lg font-bold">Cashu Backup</h3>
      <p class="text-sm text-error">No Cashu seed is available to back up.</p>
    </div>
  {:else if mints.length === 0}
    <div class="flex flex-col gap-2">
      <h3 class="text-lg font-bold">Add A Trusted Mint</h3>
      <p class="text-sm opacity-75">
        Add at least one mint before backing up. The backup file must include both seed words and
        trusted mints so recovery can find funds later.
      </p>
    </div>
    <CashuMintManager />
    {#if onback}
      <Button class="btn btn-neutral btn-sm inline-flex justify-center" onclick={onback}
        >← Back</Button>
    {/if}
  {:else}
    <div class="flex flex-col gap-2">
      <h3 class="text-lg font-bold">Back Up Your Cashu Wallet</h3>
      <p class="text-sm opacity-75">
        The backup file includes your seed words and trusted mints. You need both to recover Cashu
        funds on another device. Anyone with the seed words may be able to recover and spend ecash
        from this wallet, so keep the file private.
      </p>
    </div>

    <div class="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2 sm:grid-cols-3">
      {#each words as word, i}
        <div class="card2 bg-alt flex min-w-0 items-center gap-2 px-3 py-2 text-sm">
          <span class="w-5 text-right opacity-50">{i + 1}.</span>
          <span class="min-w-0 break-all font-mono font-semibold">{word}</span>
        </div>
      {/each}
    </div>

    <div class="rounded-box border border-base-300 bg-base-200/40 p-3 text-sm">
      <p class="font-medium">Trusted mints included in the backup</p>
      <div class="mt-2 flex flex-col gap-1">
        {#each mints as mint (mint)}
          <p class="break-all font-mono text-xs opacity-80">{mint}</p>
        {/each}
      </div>
    </div>

    <label
      class="flex cursor-pointer gap-3 rounded-box border border-base-content/10 bg-base-200/50 p-3 text-sm">
      <input bind:checked={encryptDownload} type="checkbox" class="checkbox mt-0.5" />
      <span>
        <span class="block font-semibold">Encrypt downloaded backup with a passphrase</span>
        <span class="block opacity-70">
          Use this if the file may live in downloads, cloud storage, or a shared computer.
        </span>
      </span>
    </label>

    {#if encryptDownload}
      <div class="grid gap-2 sm:grid-cols-2">
        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium" for="cashu-download-passphrase">Passphrase</label>
          <label class="input input-sm input-bordered flex w-full items-center gap-2">
            <Icon icon={Key} />
            <input
              id="cashu-download-passphrase"
              bind:value={downloadPassphrase}
              type={showDownloadPassphrase ? "text" : "password"}
              class="min-w-0 grow"
              autocomplete="new-password" />
            <button
              type="button"
              class="btn btn-square btn-ghost btn-xs"
              aria-label={showDownloadPassphrase ? "Hide passphrase" : "Show passphrase"}
              onclick={() => (showDownloadPassphrase = !showDownloadPassphrase)}>
              <Icon icon={showDownloadPassphrase ? EyeClosed : Eye} />
            </button>
          </label>
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium" for="cashu-download-passphrase-confirm">Confirm</label>
          <label class="input input-sm input-bordered flex w-full items-center gap-2">
            <Icon icon={Key} />
            <input
              id="cashu-download-passphrase-confirm"
              bind:value={downloadPassphraseConfirm}
              type={showDownloadPassphraseConfirm ? "text" : "password"}
              class="min-w-0 grow"
              autocomplete="new-password" />
            <button
              type="button"
              class="btn btn-square btn-ghost btn-xs"
              aria-label={showDownloadPassphraseConfirm ? "Hide passphrase" : "Show passphrase"}
              onclick={() => (showDownloadPassphraseConfirm = !showDownloadPassphraseConfirm)}>
              <Icon icon={showDownloadPassphraseConfirm ? EyeClosed : Eye} />
            </button>
          </label>
        </div>
      </div>
    {/if}

    <div class="flex flex-col-reverse gap-2 sm:flex-row sm:gap-3">
      {#if onback}
        <Button class="btn btn-neutral btn-sm inline-flex justify-center" onclick={onback}
          >← Back</Button>
      {/if}
      <Button
        class="btn btn-neutral btn-sm inline-flex flex-1 justify-center"
        onclick={downloadBackup}>
        Download backup file
        <Icon icon={ArrowDown} />
      </Button>
      <Button
        class="btn btn-primary btn-sm inline-flex flex-1 justify-center"
        onclick={finishSetup}
        disabled={!hasDownloadedCurrentBackup}>
        Finish setup
      </Button>
    </div>

    {#if !hasDownloadedCurrentBackup}
      <p class="text-xs opacity-70">
        Download the backup file before continuing. It contains the trusted mint list as well as the
        seed words.
      </p>
    {/if}

    <div class="rounded-box border border-base-300 bg-base-200/40 p-3 text-sm">
      {#if seedEncrypted}
        <p class="font-medium">Stored encrypted on this device</p>
        <p class="mt-1 opacity-70">
          The seed is encrypted in browser storage and remains unlocked for this browser session.
        </p>
      {:else}
        <details>
          <summary class="cursor-pointer select-none font-medium"
            >Store encrypted on this device</summary>
          <p class="mt-2 opacity-70">
            This replaces the plain seed in browser storage with a passphrase-encrypted copy. You
            will need this passphrase after the browser session expires.
          </p>
          <div class="mt-3 grid gap-2 sm:grid-cols-2">
            <label class="input input-sm input-bordered flex w-full items-center gap-2">
              <Icon icon={Key} />
              <input
                bind:value={localPassphrase}
                disabled={localEncrypting}
                type={showLocalPassphrase ? "text" : "password"}
                class="min-w-0 grow"
                placeholder="passphrase"
                autocomplete="new-password" />
              <button
                type="button"
                class="btn btn-square btn-ghost btn-xs"
                disabled={localEncrypting}
                aria-label={showLocalPassphrase ? "Hide passphrase" : "Show passphrase"}
                onclick={() => (showLocalPassphrase = !showLocalPassphrase)}>
                <Icon icon={showLocalPassphrase ? EyeClosed : Eye} />
              </button>
            </label>
            <label class="input input-sm input-bordered flex w-full items-center gap-2">
              <Icon icon={Key} />
              <input
                bind:value={localPassphraseConfirm}
                disabled={localEncrypting}
                type={showLocalPassphraseConfirm ? "text" : "password"}
                class="min-w-0 grow"
                placeholder="confirm passphrase"
                autocomplete="new-password" />
              <button
                type="button"
                class="btn btn-square btn-ghost btn-xs"
                disabled={localEncrypting}
                aria-label={showLocalPassphraseConfirm ? "Hide passphrase" : "Show passphrase"}
                onclick={() => (showLocalPassphraseConfirm = !showLocalPassphraseConfirm)}>
                <Icon icon={showLocalPassphraseConfirm ? EyeClosed : Eye} />
              </button>
            </label>
          </div>
          <Button
            class="btn btn-neutral btn-sm mt-3 inline-flex w-full justify-center"
            onclick={storeLocalEncrypted}
            disabled={localEncrypting}>
            {localEncrypting ? "Encrypting…" : "Encrypt local seed"}
          </Button>
        </details>
      {/if}
    </div>
  {/if}

  {#if error}
    <p class="text-sm text-error">{error}</p>
  {/if}
  {#if status}
    <p class="text-sm text-success">{status}</p>
  {/if}
</div>
