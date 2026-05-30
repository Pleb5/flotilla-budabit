<script lang="ts">
  import {
    cashuMints,
    cashuSeedEncrypted,
    cashuSeedLocked,
    confirmCashuBackup,
    encryptCashuSeedAtRest,
    getCashuMnemonic,
    restoreCashuSeedBackup,
    unlockEncryptedCashuSeed,
  } from "@app/core/cashu"
  import {
    createCashuBackupText,
    createEncryptedCashuBackupText,
    decryptCashuBackupData,
    parseCashuBackupText,
  } from "@app/util/cashu-backup"
  import type {CashuBackupData, ParsedCashuBackup} from "@app/util/cashu-backup"
  import {
    SECRET_FILE_ACCEPT,
    SECRET_FILE_MAX_BYTES,
    isSupportedSecretFile,
  } from "@app/util/secret-file"
  import {downloadText} from "@lib/html"
  import Button from "@lib/components/Button.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import Key from "@assets/icons/key-minimalistic.svg?dataurl"
  import UploadMinimalistic from "@assets/icons/upload-minimalistic.svg?dataurl"
  import ArrowDown from "@assets/icons/arrow-down.svg?dataurl"
  import Eye from "@assets/icons/eye.svg?dataurl"
  import EyeClosed from "@assets/icons/eye-closed.svg?dataurl"

  interface Props {
    onconfirmed?: () => void
  }

  const {onconfirmed}: Props = $props()

  let seedRevision = $state(0)
  const seedLocked = $derived($cashuSeedLocked)
  const seedEncrypted = $derived($cashuSeedEncrypted)
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

  let copied = $state(false)
  let quizIndices = $state<number[]>([])
  let quizAnswers = $state<string[]>(["", "", ""])
  let error = $state("")
  let status = $state("")
  let step = $state<"display" | "quiz">("display")

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

  let unlockPassphrase = $state("")
  let showUnlockPassphrase = $state(false)
  let unlocking = $state(false)

  let selectedFileName = $state("")
  let fileError = $state("")
  let dragActive = $state(false)
  let parsedBackup = $state<ParsedCashuBackup | null>(null)
  let restoreFilePassphrase = $state("")
  let showRestoreFilePassphrase = $state(false)
  let encryptRestoredSeed = $state(false)
  let restorePassphrase = $state("")
  let restorePassphraseConfirm = $state("")
  let showRestorePassphrase = $state(false)
  let showRestorePassphraseConfirm = $state(false)
  let restoring = $state(false)
  let restoreResult = $state<{
    succeeded: string[]
    failed: {mintUrl: string; error: string}[]
  } | null>(null)

  const backupData = $derived<CashuBackupData>({mnemonic, mints: $cashuMints})

  const validateNewPassphrase = (passphrase: string, confirm: string) => {
    if (passphrase.length < 12) return "Use an encryption passphrase of at least 12 characters."
    if (passphrase !== confirm) return "Encryption passphrases do not match."
    return ""
  }

  const copyAll = async () => {
    if (!words.length) return

    await navigator.clipboard.writeText(words.join(" "))
    copied = true
    setTimeout(() => (copied = false), 2000)
  }

  const downloadWords = async () => {
    if (!mnemonic) return

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
      status = encryptDownload
        ? "Encrypted Cashu backup downloaded. Keep the file and passphrase safe."
        : "Cashu backup downloaded. Keep the file private."
    } catch (e: any) {
      error = e?.message || "Could not download Cashu backup."
    }
  }

  const startQuiz = () => {
    if (words.length < 3) return

    const indices: number[] = []
    while (indices.length < 3) {
      const i = Math.floor(Math.random() * words.length)
      if (!indices.includes(i)) indices.push(i)
    }
    quizIndices = indices.sort((a, b) => a - b)
    quizAnswers = ["", "", ""]
    error = ""
    status = ""
    step = "quiz"
  }

  const verify = async () => {
    const allCorrect = quizIndices.every(
      (idx, i) => quizAnswers[i].trim().toLowerCase() === words[idx].toLowerCase(),
    )
    if (!allCorrect) {
      error = "One or more words are incorrect. Please check your backup and try again."
      return
    }
    await confirmCashuBackup()
    onconfirmed?.()
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

  const unlockSeed = async () => {
    if (!unlockPassphrase.trim() || unlocking) return

    unlocking = true
    error = ""
    status = ""
    try {
      await unlockEncryptedCashuSeed(unlockPassphrase)
      seedRevision++
      unlockPassphrase = ""
      status = "Cashu wallet unlocked for this browser session."
      onconfirmed?.()
    } catch {
      error = "Could not unlock the Cashu seed. Check the passphrase."
    } finally {
      unlocking = false
    }
  }

  const showFileError = (message: string) => {
    fileError = message
    parsedBackup = null
    restoreResult = null
  }

  const handleBackupFile = async (file: File | undefined) => {
    if (!file || restoring) return

    selectedFileName = file.name
    fileError = ""
    status = ""
    restoreResult = null
    parsedBackup = null
    restoreFilePassphrase = ""
    encryptRestoredSeed = seedEncrypted

    if (!isSupportedSecretFile(file)) {
      showFileError("Choose a text backup file, such as Budabit Cashu Wallet Seed.txt.")
      return
    }

    if (file.size > SECRET_FILE_MAX_BYTES) {
      showFileError("Choose a backup file smaller than 1 MB.")
      return
    }

    let text = ""
    try {
      text = await file.text()
    } catch {
      showFileError("Could not read the selected backup file.")
      return
    }

    const parsed = parseCashuBackupText(text)
    if (parsed.type === "none") {
      showFileError(parsed.reason)
      return
    }

    parsedBackup = parsed
    fileError = ""
  }

  const handleFiles = async (files: FileList | null | undefined) => {
    if (!files?.length) return

    if (files.length > 1) {
      showFileError("Choose one Cashu backup file at a time.")
      return
    }

    await handleBackupFile(files[0])
  }

  const onFileChange = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement

    await handleFiles(input.files)

    input.value = ""
  }

  const preventFileEvent = (event: DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }

  const onDragEnter = (event: DragEvent) => {
    preventFileEvent(event)
    if (!restoring) dragActive = true
  }

  const onDragOver = (event: DragEvent) => {
    preventFileEvent(event)
    if (restoring) return

    dragActive = true
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"
  }

  const onDragLeave = (event: DragEvent) => {
    preventFileEvent(event)

    const current = event.currentTarget as HTMLElement
    const next = event.relatedTarget as Node | null

    if (next && current.contains(next)) return

    dragActive = false
  }

  const onDrop = async (event: DragEvent) => {
    preventFileEvent(event)
    dragActive = false

    if (restoring) return

    await handleFiles(event.dataTransfer?.files)
  }

  const getRestoreData = async () => {
    if (!parsedBackup || parsedBackup.type === "none")
      throw new Error("Choose a Cashu backup file.")
    if (parsedBackup.type === "plain") return parsedBackup.data

    if (!restoreFilePassphrase.trim()) throw new Error("Enter the backup file passphrase.")

    return decryptCashuBackupData(parsedBackup.encrypted, restoreFilePassphrase)
  }

  const restoreFromFile = async () => {
    if (!parsedBackup || restoring) return

    const passphraseError = encryptRestoredSeed
      ? validateNewPassphrase(restorePassphrase, restorePassphraseConfirm)
      : ""

    if (passphraseError) {
      fileError = passphraseError
      return
    }

    restoring = true
    fileError = ""
    error = ""
    status = ""
    restoreResult = null
    try {
      const data = await getRestoreData()
      restoreResult = await restoreCashuSeedBackup(data, {
        encryptPassphrase: encryptRestoredSeed ? restorePassphrase : undefined,
      })
      seedRevision++
      status = "Cashu seed restored. Recovery has checked the mints saved in the backup."
      onconfirmed?.()
    } catch (e: any) {
      fileError = e?.message || "Could not restore the selected Cashu backup."
    } finally {
      restoring = false
    }
  }
</script>

<div class="flex min-w-0 flex-col gap-4 p-2 sm:gap-6 sm:p-4">
  {#if seedLocked}
    <div class="flex flex-col gap-2">
      <h3 class="text-lg font-bold">Unlock Cashu Wallet</h3>
      <p class="text-sm opacity-75">
        Your Cashu seed is stored encrypted on this device. Enter the passphrase to use the wallet,
        or restore from a backup file below.
      </p>
    </div>

    <div class="flex flex-col gap-2">
      <label class="text-sm font-medium" for="cashu-unlock-passphrase">Encryption passphrase</label>
      <label class="input input-sm input-bordered flex w-full items-center gap-2">
        <Icon icon={Key} />
        <input
          id="cashu-unlock-passphrase"
          bind:value={unlockPassphrase}
          disabled={unlocking}
          type={showUnlockPassphrase ? "text" : "password"}
          class="min-w-0 grow"
          autocomplete="current-password" />
        <button
          type="button"
          class="btn btn-square btn-ghost btn-xs"
          disabled={unlocking}
          aria-label={showUnlockPassphrase ? "Hide passphrase" : "Show passphrase"}
          onclick={() => (showUnlockPassphrase = !showUnlockPassphrase)}>
          <Icon icon={showUnlockPassphrase ? EyeClosed : Eye} />
        </button>
      </label>
      <Button
        class="btn btn-primary btn-sm inline-flex w-full justify-center"
        onclick={unlockSeed}
        disabled={unlocking || !unlockPassphrase.trim()}>
        {unlocking ? "Unlocking…" : "Unlock wallet"}
      </Button>
    </div>
  {:else if step === "display"}
    <div class="flex flex-col gap-2">
      <h3 class="text-lg font-bold">Back Up Your Cashu Seed</h3>
      <p class="text-sm opacity-75">
        These words recreate the seed Budabit uses to recover your Cashu wallet from trusted mints.
        Anyone with these words may be able to recover and spend ecash from this wallet, so keep
        them private.
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

    <div class="flex flex-col gap-2 sm:flex-row sm:gap-3">
      <div class="flex flex-1 flex-col gap-2">
        <Button class="btn btn-neutral btn-sm inline-flex justify-center" onclick={copyAll}>
          {copied ? "Copied!" : "Copy All Words"}
        </Button>
        <Button class="btn btn-neutral btn-sm inline-flex justify-center" onclick={downloadWords}>
          Download words
          <Icon icon={ArrowDown} />
        </Button>
      </div>
      <Button class="btn btn-primary btn-sm inline-flex flex-1 justify-center" onclick={startQuiz}>
        I've Written It Down →
      </Button>
    </div>

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
  {:else}
    <div class="flex flex-col gap-2">
      <h3 class="text-lg font-bold">Confirm Your Backup</h3>
      <p class="text-sm opacity-75">
        Enter the words at the positions below to confirm you've saved your seed phrase.
      </p>
    </div>

    <div class="flex flex-col gap-3">
      {#each quizIndices as idx, i}
        <div class="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
          <span class="text-sm opacity-75 sm:w-16 sm:text-right">Word #{idx + 1}</span>
          <input
            class="input input-sm input-bordered min-w-0 flex-1 font-mono"
            type="text"
            placeholder="enter word"
            bind:value={quizAnswers[i]} />
        </div>
      {/each}
    </div>

    <div class="flex flex-col-reverse gap-2 sm:flex-row sm:gap-3">
      <Button
        class="btn btn-neutral btn-sm inline-flex justify-center"
        onclick={() => (step = "display")}>← Back</Button>
      <Button class="btn btn-primary btn-sm inline-flex flex-1 justify-center" onclick={verify}
        >Confirm Backup</Button>
    </div>
  {/if}

  {#if step === "display"}
    <div class="rounded-box border border-base-300 bg-base-200/40 p-3 text-sm">
      <div class="flex flex-col gap-1">
        <p class="font-medium">Restore from backup file</p>
        <p class="opacity-70">
          Upload a Budabit Cashu backup or any text file containing one valid BIP39 seed phrase.
          Budabit will restore the seed, trust saved mints, and recover proofs from those mints.
        </p>
      </div>

      <input
        id="cashu-backup-file"
        type="file"
        accept={SECRET_FILE_ACCEPT}
        disabled={restoring}
        class="hidden"
        onchange={onFileChange} />
      <label
        for="cashu-backup-file"
        aria-disabled={restoring}
        class="mt-3 flex cursor-pointer flex-col items-center gap-2 rounded-box border border-dashed border-base-content/20 p-4 text-center transition-all hover:border-primary hover:bg-base-300/30"
        class:border-primary={dragActive}
        class:bg-base-300={dragActive}
        class:cursor-not-allowed={restoring}
        class:opacity-60={restoring}
        ondragenter={onDragEnter}
        ondragover={onDragOver}
        ondragleave={onDragLeave}
        ondrop={onDrop}>
        <Icon icon={UploadMinimalistic} />
        <div class="font-medium">
          {selectedFileName || "Choose a Cashu backup file or drop it here"}
        </div>
        <p class="text-xs opacity-60">
          Text files only. Encrypted Budabit backups need a passphrase.
        </p>
      </label>

      {#if parsedBackup}
        <div class="mt-3 flex flex-col gap-3 rounded-box bg-base-100/50 p-3">
          {#if parsedBackup.type === "plain"}
            <p class="text-success">
              Backup ready: {parsedBackup.data.mints.length} saved mint{parsedBackup.data.mints
                .length === 1
                ? ""
                : "s"}.
            </p>
          {:else if parsedBackup.type === "encrypted"}
            <div class="flex flex-col gap-1">
              <label class="font-medium" for="cashu-restore-file-passphrase">
                Backup file passphrase
              </label>
              <label class="input input-sm input-bordered flex w-full items-center gap-2">
                <Icon icon={Key} />
                <input
                  id="cashu-restore-file-passphrase"
                  bind:value={restoreFilePassphrase}
                  disabled={restoring}
                  type={showRestoreFilePassphrase ? "text" : "password"}
                  class="min-w-0 grow"
                  autocomplete="current-password" />
                <button
                  type="button"
                  class="btn btn-square btn-ghost btn-xs"
                  disabled={restoring}
                  aria-label={showRestoreFilePassphrase ? "Hide passphrase" : "Show passphrase"}
                  onclick={() => (showRestoreFilePassphrase = !showRestoreFilePassphrase)}>
                  <Icon icon={showRestoreFilePassphrase ? EyeClosed : Eye} />
                </button>
              </label>
            </div>
          {/if}

          <label
            class="flex cursor-pointer gap-3 rounded-box border border-base-content/10 bg-base-200/50 p-3">
            <input bind:checked={encryptRestoredSeed} type="checkbox" class="checkbox mt-0.5" />
            <span>
              <span class="block font-semibold">Store restored seed encrypted on this device</span>
              <span class="block opacity-70">
                Recommended for shared devices. You will need this passphrase after the browser
                session expires.
              </span>
            </span>
          </label>

          {#if encryptRestoredSeed}
            <div class="grid gap-2 sm:grid-cols-2">
              <label class="input input-sm input-bordered flex w-full items-center gap-2">
                <Icon icon={Key} />
                <input
                  bind:value={restorePassphrase}
                  disabled={restoring}
                  type={showRestorePassphrase ? "text" : "password"}
                  class="min-w-0 grow"
                  placeholder="passphrase"
                  autocomplete="new-password" />
                <button
                  type="button"
                  class="btn btn-square btn-ghost btn-xs"
                  disabled={restoring}
                  aria-label={showRestorePassphrase ? "Hide passphrase" : "Show passphrase"}
                  onclick={() => (showRestorePassphrase = !showRestorePassphrase)}>
                  <Icon icon={showRestorePassphrase ? EyeClosed : Eye} />
                </button>
              </label>
              <label class="input input-sm input-bordered flex w-full items-center gap-2">
                <Icon icon={Key} />
                <input
                  bind:value={restorePassphraseConfirm}
                  disabled={restoring}
                  type={showRestorePassphraseConfirm ? "text" : "password"}
                  class="min-w-0 grow"
                  placeholder="confirm passphrase"
                  autocomplete="new-password" />
                <button
                  type="button"
                  class="btn btn-square btn-ghost btn-xs"
                  disabled={restoring}
                  aria-label={showRestorePassphraseConfirm ? "Hide passphrase" : "Show passphrase"}
                  onclick={() => (showRestorePassphraseConfirm = !showRestorePassphraseConfirm)}>
                  <Icon icon={showRestorePassphraseConfirm ? EyeClosed : Eye} />
                </button>
              </label>
            </div>
          {/if}

          <Button
            class="btn btn-warning btn-sm inline-flex w-full justify-center"
            onclick={restoreFromFile}
            disabled={restoring}>
            {restoring ? "Restoring…" : "Restore and recover wallet"}
          </Button>
        </div>
      {/if}

      {#if restoreResult}
        <div class="mt-3 flex flex-col gap-1 text-xs">
          {#if restoreResult.succeeded.length > 0}
            <p class="text-success">
              Recovered {restoreResult.succeeded.length} mint{restoreResult.succeeded.length === 1
                ? ""
                : "s"}.
            </p>
          {/if}
          {#if restoreResult.failed.length > 0}
            <p class="text-error">
              {restoreResult.failed.length} mint{restoreResult.failed.length === 1 ? "" : "s"} failed
              during recovery.
            </p>
          {/if}
          {#if restoreResult.succeeded.length === 0 && restoreResult.failed.length === 0}
            <p class="opacity-70">No saved mints were included in the backup.</p>
          {/if}
        </div>
      {/if}

      {#if fileError}
        <p class="mt-3 text-sm text-error">{fileError}</p>
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
