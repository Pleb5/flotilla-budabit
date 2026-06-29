<script lang="ts">
  import {cashuMints, confirmCashuBackup, restoreCashuSeedBackup} from "@app/core/cashu"
  import {
    createCashuBackupText,
    createEncryptedCashuBackupText,
    decryptCashuBackupData,
    parseCashuBackupText,
    type CashuBackupData,
    type ParsedCashuBackup,
  } from "@app/util/cashu-backup"
  import {
    cashuMintRecommendations,
    loadCashuMintRecommendations,
    normalizeCashuMintUrls,
  } from "@app/core/cashu-mint-recommendations"
  import CashuMintRecommendationEvidence from "@app/components/CashuMintRecommendationEvidence.svelte"
  import {
    activeUserCommunityRefs,
    communityMemberProfileListEvents,
    communityMemberReportStates,
    communityModeratorProfileListEvents,
  } from "@app/core/community-state"
  import {pubkey} from "@welshman/app"
  import {
    SECRET_FILE_ACCEPT,
    SECRET_FILE_MAX_BYTES,
    isSupportedSecretFile,
  } from "@app/util/secret-file"
  import {validateNewPassphrase} from "@app/util/passphrase"
  import {downloadText} from "@lib/html"
  import Button from "@lib/components/Button.svelte"
  import CashuRecoveryLoader from "@app/components/CashuRecoveryLoader.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import Key from "@assets/icons/key-minimalistic.svg?dataurl"
  import UploadMinimalistic from "@assets/icons/upload-minimalistic.svg?dataurl"
  import Eye from "@assets/icons/eye.svg?dataurl"
  import EyeClosed from "@assets/icons/eye-closed.svg?dataurl"

  interface Props {
    onconfirmed?: () => void
    oncreate?: () => void
  }

  const {onconfirmed, oncreate}: Props = $props()

  type RecoveryInputSource = "file" | "manual"

  let source = $state<"choice" | RecoveryInputSource | "restored">("choice")
  let lastRecoverySource = $state<RecoveryInputSource>("file")
  let selectedFileName = $state("")
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
  let selectedRecommendationMints = $state<string[]>([])
  let includeTrustedRecoveryMints = $state(true)
  let restoreExtraMintLines = $state("")
  let manualMnemonic = $state("")
  let manualMintLines = $state("")
  let recoveredBackup = $state<CashuBackupData | null>(null)
  let recoveredBackupEncrypt = $state(false)
  let recoveredBackupPassphrase = $state("")
  let recoveredBackupPassphraseConfirm = $state("")
  let showRecoveredBackupPassphrase = $state(false)
  let showRecoveredBackupPassphraseConfirm = $state(false)
  let recoveredBackupDownloading = $state(false)
  let recoveredBackupDownloaded = $state(false)
  let recoveredBackupRequired = $state(false)
  let error = $state("")
  let status = $state("")
  let recommendationLoadKey = $state("")

  const trustedMints = $derived($cashuMints)
  const profileListEvents = $derived([
    ...$communityMemberProfileListEvents,
    ...$communityModeratorProfileListEvents,
  ])
  const recommendationMints = $derived.by(() => new Set(selectedRecommendationMints))

  function splitLines(value: string) {
    return value
      .split("\n")
      .map(line => line.trim())
      .filter(Boolean)
  }

  const restoreExtraMints = $derived.by(() =>
    normalizeCashuMintUrls(splitLines(restoreExtraMintLines)),
  )
  const manualMints = $derived.by(() => normalizeCashuMintUrls(splitLines(manualMintLines)))
  const recoveryRecommendations = $derived.by(() => {
    const manual = new Set([...restoreExtraMints, ...manualMints])
    const saved = new Set(
      parsedBackup?.type === "plain" ? normalizeCashuMintUrls(parsedBackup.data.mints) : [],
    )

    return $cashuMintRecommendations
      .filter(recommendation => !manual.has(recommendation.mintUrl))
      .filter(recommendation => !saved.has(recommendation.mintUrl))
      .slice(0, 6)
  })

  const showError = (message: string) => {
    error = message
    status = ""
  }

  const handleBackupFile = async (file: File | undefined) => {
    if (!file || restoring) return

    selectedFileName = file.name
    parsedBackup = null
    restoreFilePassphrase = ""
    error = ""
    status = ""

    if (!isSupportedSecretFile(file)) {
      showError("Choose a text backup file, such as Budabit Cashu Wallet Seed.txt.")
      return
    }

    if (file.size > SECRET_FILE_MAX_BYTES) {
      showError("Choose a backup file smaller than 1 MB.")
      return
    }

    let text = ""
    try {
      text = await file.text()
    } catch {
      showError("Could not read the selected backup file.")
      return
    }

    const parsed = parseCashuBackupText(text)
    if (parsed.type === "none") {
      showError(parsed.reason)
      return
    }

    parsedBackup = parsed
  }

  const onFileChange = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement
    await handleBackupFile(input.files?.[0])
    input.value = ""
  }

  const getRestoreData = async () => {
    if (!parsedBackup || parsedBackup.type === "none") {
      throw new Error("Choose a Cashu backup file.")
    }
    if (parsedBackup.type === "plain") return parsedBackup.data

    if (!restoreFilePassphrase.trim()) throw new Error("Enter the backup file passphrase.")

    return decryptCashuBackupData(parsedBackup.encrypted, restoreFilePassphrase)
  }

  const toggleRecommendationMint = (mintUrl: string) => {
    selectedRecommendationMints = recommendationMints.has(mintUrl)
      ? selectedRecommendationMints.filter(mint => mint !== mintUrl)
      : [...selectedRecommendationMints, mintUrl]
  }

  const getSelectedRecoveryMints = (baseMints: string[] = [], extraMints: string[] = []) =>
    normalizeCashuMintUrls([
      ...(includeTrustedRecoveryMints ? trustedMints : []),
      ...baseMints,
      ...extraMints,
      ...selectedRecommendationMints,
    ])

  const haveSameMints = (left: string[] = [], right: string[] = []) => {
    const leftMints = normalizeCashuMintUrls(left)
    const rightMints = normalizeCashuMintUrls(right)

    return (
      leftMints.length === rightMints.length && leftMints.every(mint => rightMints.includes(mint))
    )
  }

  const completeRestore = async () => {
    await confirmCashuBackup()
    if (onconfirmed) onconfirmed()
    else if (location.hash) history.back()
  }

  const setRecoveryComplete = async (
    data: CashuBackupData,
    recoverySource: RecoveryInputSource,
    requiresUpdatedBackup: boolean,
  ) => {
    recoveredBackup = {
      mnemonic: data.mnemonic,
      mints: normalizeCashuMintUrls(data.mints),
    }
    lastRecoverySource = recoverySource
    recoveredBackupPassphrase = ""
    recoveredBackupPassphraseConfirm = ""
    recoveredBackupEncrypt = false
    recoveredBackupDownloaded = false
    recoveredBackupRequired = requiresUpdatedBackup

    if (!requiresUpdatedBackup) {
      await completeRestore()
      return
    }

    source = "restored"
  }

  const finishRestore = async () => {
    if (recoveredBackupRequired && !recoveredBackupDownloaded) {
      showError(
        "Download the updated backup before continuing. It includes the mint list used for recovery.",
      )
      return
    }

    try {
      await completeRestore()
    } catch (e: any) {
      showError(e?.message || "Could not finish wallet restore.")
    }
  }

  const backToRecoveryInput = () => {
    source = lastRecoverySource
    error = ""
    status = ""
  }

  const restoreFromFile = async () => {
    if (!parsedBackup || restoring) return

    const passphraseError = encryptRestoredSeed
      ? validateNewPassphrase(restorePassphrase, restorePassphraseConfirm)
      : ""

    if (passphraseError) {
      showError(passphraseError)
      return
    }

    restoring = true
    error = ""
    status = ""
    restoreResult = null
    try {
      const data = await getRestoreData()
      const recoveryData = {
        mnemonic: data.mnemonic,
        mints: getSelectedRecoveryMints(data.mints, restoreExtraMints),
      }
      if (recoveryData.mints.length === 0) {
        throw new Error("Add at least one mint to check. A Cashu seed alone cannot find funds.")
      }
      restoreResult = await restoreCashuSeedBackup(recoveryData, {
        encryptPassphrase: encryptRestoredSeed ? restorePassphrase : undefined,
      })
      await setRecoveryComplete(
        recoveryData,
        "file",
        !haveSameMints(data.mints, recoveryData.mints),
      )
      status = "Cashu seed restored."
    } catch (e: any) {
      showError(e?.message || "Could not restore the selected Cashu backup.")
    } finally {
      restoring = false
    }
  }

  const restoreManualSeed = async () => {
    if (restoring) return

    const recoveryMints = getSelectedRecoveryMints([], manualMints)
    if (recoveryMints.length === 0) {
      showError("Add at least one mint to check. A Cashu seed alone cannot find funds.")
      return
    }

    const passphraseError = encryptRestoredSeed
      ? validateNewPassphrase(restorePassphrase, restorePassphraseConfirm)
      : ""

    if (passphraseError) {
      showError(passphraseError)
      return
    }

    restoring = true
    error = ""
    status = ""
    restoreResult = null
    try {
      const recoveryData = {mnemonic: manualMnemonic, mints: recoveryMints}
      restoreResult = await restoreCashuSeedBackup(recoveryData, {
        encryptPassphrase: encryptRestoredSeed ? restorePassphrase : undefined,
      })
      await setRecoveryComplete(recoveryData, "manual", true)
      status = "Cashu seed restored."
    } catch (e: any) {
      showError(e?.message || "Could not restore the Cashu seed.")
    } finally {
      restoring = false
    }
  }

  const downloadRecoveredBackup = async () => {
    if (!recoveredBackup || recoveredBackupDownloading) return

    const passphraseError = recoveredBackupEncrypt
      ? validateNewPassphrase(recoveredBackupPassphrase, recoveredBackupPassphraseConfirm)
      : ""

    if (passphraseError) {
      showError(passphraseError)
      return
    }

    recoveredBackupDownloading = true
    error = ""
    status = ""
    try {
      const text = recoveredBackupEncrypt
        ? await createEncryptedCashuBackupText(recoveredBackup, recoveredBackupPassphrase)
        : createCashuBackupText(recoveredBackup)

      downloadText("Budabit Cashu Wallet Seed.txt", text)
      recoveredBackupDownloaded = true
      status = "Updated Cashu backup downloaded. Keep the file safe."
    } catch (e: any) {
      showError(e?.message || "Could not download the updated Cashu backup.")
    } finally {
      recoveredBackupDownloading = false
    }
  }

  $effect(() => {
    const key = JSON.stringify({
      pubkey: $pubkey || "",
      mints: trustedMints,
      communities: $activeUserCommunityRefs.map(
        ref => `${ref.communityPubkey}:${ref.definition.event.id}`,
      ),
      profileLists: profileListEvents.map(event => `${event.id}:${event.created_at}`),
      reports: Array.from($communityMemberReportStates.entries()).map(([community, state]) => [
        community,
        state.personReports.length,
        state.eventReports.length,
      ]),
    })

    if (key === recommendationLoadKey) return

    recommendationLoadKey = key
    loadCashuMintRecommendations({
      trustedMints,
      communityRefs: $activeUserCommunityRefs,
      profileListEvents,
      reportStates: $communityMemberReportStates,
    }).catch(() => undefined)
  })
</script>

<div class="flex min-w-0 flex-col gap-4 p-2 sm:gap-6 sm:p-4">
  {#if restoring}
    <CashuRecoveryLoader />
  {:else if source === "choice"}
    <div class="flex flex-col gap-2">
      <h3 class="text-lg font-bold">Restore Cashu Wallet</h3>
      <p class="text-sm opacity-75">
        Restore from a Budabit backup file, or enter seed words manually if you also know which
        mints to check.
      </p>
    </div>

    <div class="grid gap-3 sm:grid-cols-2">
      <button
        type="button"
        class="rounded-box border border-base-300 bg-base-200/50 p-4 text-left hover:bg-base-300"
        onclick={() => (source = "file")}>
        <p class="font-semibold">Use backup file</p>
        <p class="mt-1 text-sm opacity-70">Best option. Includes seed words and saved mints.</p>
      </button>
      <button
        type="button"
        class="rounded-box border border-base-300 bg-base-200/50 p-4 text-left hover:bg-base-300"
        onclick={() => (source = "manual")}>
        <p class="font-semibold">Enter seed words</p>
        <p class="mt-1 text-sm opacity-70">Requires adding every mint this seed may have used.</p>
      </button>
    </div>

    {#if oncreate}
      <Button class="btn btn-neutral btn-sm inline-flex w-full justify-center" onclick={oncreate}>
        Create new wallet instead
      </Button>
    {/if}
  {:else if source === "file"}
    <div class="flex flex-col gap-2">
      <h3 class="text-lg font-bold">Restore From Backup File</h3>
      <p class="text-sm opacity-75">
        Upload a Budabit Cashu backup file. Budabit will restore the seed, trust the saved mints,
        and recover proofs from selected mints.
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
      class="flex cursor-pointer flex-col items-center gap-2 rounded-box border border-dashed border-base-content/20 p-4 text-center transition-all hover:border-primary hover:bg-base-300/30">
      <Icon icon={UploadMinimalistic} />
      <div class="font-medium">{selectedFileName || "Choose a Cashu backup file"}</div>
      <p class="text-xs opacity-60">
        Text files only. Encrypted Budabit backups need a passphrase.
      </p>
    </label>

    {#if parsedBackup}
      <div class="flex flex-col gap-3 rounded-box bg-base-100/50 p-3 text-sm">
        {#if parsedBackup.type === "plain"}
          <p class="text-success">
            Backup ready: {parsedBackup.data.mints.length} saved mint{parsedBackup.data.mints
              .length === 1
              ? ""
              : "s"}.
          </p>
          {#if parsedBackup.data.mints.length > 0}
            <div class="flex flex-col gap-1 rounded-box bg-base-200/60 p-2">
              {#each parsedBackup.data.mints as mint (mint)}
                <p class="break-all font-mono text-xs opacity-80">{mint}</p>
              {/each}
            </div>
          {/if}
        {:else}
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
      </div>
    {/if}

    <div class="flex flex-col gap-2">
      <label class="text-sm font-medium" for="cashu-extra-restore-mints"
        >Extra mints to check</label>
      <textarea
        id="cashu-extra-restore-mints"
        class="textarea textarea-bordered min-w-0 font-mono text-xs"
        rows={3}
        placeholder="https://mint.example.com"
        bind:value={restoreExtraMintLines}></textarea>
      <p class="text-xs opacity-70">
        Add one mint URL per line if this seed may have used mints that are not in the backup.
      </p>
    </div>

    {#if recoveryRecommendations.length > 0}
      <div class="flex flex-col gap-2">
        <p class="text-sm font-medium">Recommended extra mints</p>
        <div class="flex flex-col gap-2">
          {#each recoveryRecommendations as recommendation (recommendation.mintUrl)}
            <label
              class="card2 bg-alt flex min-w-0 cursor-pointer flex-col gap-2 px-3 py-2 text-sm sm:flex-row sm:items-start">
              <input
                type="checkbox"
                class="checkbox checkbox-sm mt-0.5"
                checked={recommendationMints.has(recommendation.mintUrl)}
                onchange={() => toggleRecommendationMint(recommendation.mintUrl)} />
              <span class="flex min-w-0 flex-1 flex-col gap-1">
                <span class="break-all font-mono text-xs">{recommendation.mintUrl}</span>
                <CashuMintRecommendationEvidence {recommendation} />
              </span>
            </label>
          {/each}
        </div>
      </div>
    {/if}
  {:else if source === "manual"}
    <div class="flex flex-col gap-2">
      <h3 class="text-lg font-bold">Restore From Seed Words</h3>
      <p class="text-sm opacity-75">
        Enter the Cashu seed words and add every mint this wallet may have used. A seed alone cannot
        find Cashu funds.
      </p>
    </div>

    <textarea
      class="textarea textarea-bordered min-w-0 font-mono text-xs"
      rows={4}
      placeholder="twelve or twenty-four seed words"
      bind:value={manualMnemonic}></textarea>

    <div class="flex flex-col gap-2">
      <label class="text-sm font-medium" for="cashu-manual-restore-mints">Mints to check</label>
      <textarea
        id="cashu-manual-restore-mints"
        class="textarea textarea-bordered min-w-0 font-mono text-xs"
        rows={3}
        placeholder="https://mint.example.com"
        bind:value={manualMintLines}></textarea>
    </div>

    {#if recoveryRecommendations.length > 0}
      <div class="flex flex-col gap-2">
        <p class="text-sm font-medium">Recommended mints</p>
        <div class="flex flex-col gap-2">
          {#each recoveryRecommendations as recommendation (recommendation.mintUrl)}
            <label
              class="card2 bg-alt flex min-w-0 cursor-pointer flex-col gap-2 px-3 py-2 text-sm sm:flex-row sm:items-start">
              <input
                type="checkbox"
                class="checkbox checkbox-sm mt-0.5"
                checked={recommendationMints.has(recommendation.mintUrl)}
                onchange={() => toggleRecommendationMint(recommendation.mintUrl)} />
              <span class="flex min-w-0 flex-1 flex-col gap-1">
                <span class="break-all font-mono text-xs">{recommendation.mintUrl}</span>
                <CashuMintRecommendationEvidence {recommendation} />
              </span>
            </label>
          {/each}
        </div>
      </div>
    {/if}
  {:else if recoveredBackup}
    <div class="flex flex-col gap-2">
      <h3 class="text-lg font-bold">Save Updated Backup</h3>
      <p class="text-sm opacity-75">
        Your wallet was restored with a mint list that is not in your existing backup. Download an
        updated backup before continuing so future recovery can find these funds.
      </p>
    </div>

    {#if restoreResult}
      <div class="flex flex-col gap-1 rounded-box bg-base-200/50 p-3 text-xs">
        {#if restoreResult.succeeded.length > 0}
          <p class="text-success">
            Recovered {restoreResult.succeeded.length} mint{restoreResult.succeeded.length === 1
              ? ""
              : "s"}.
          </p>
        {/if}
        {#if restoreResult.failed.length > 0}
          <p class="text-error">
            {restoreResult.failed.length} mint{restoreResult.failed.length === 1 ? "" : "s"} failed during
            recovery.
          </p>
        {/if}
      </div>
    {/if}

    <div class="rounded-box bg-base-100/50 p-2">
      <p class="text-xs font-medium">Mints included</p>
      <div class="mt-1 flex flex-col gap-1">
        {#each recoveredBackup.mints as mint (mint)}
          <p class="break-all font-mono text-xs opacity-80">{mint}</p>
        {/each}
      </div>
    </div>

    <label
      class="flex cursor-pointer gap-3 rounded-box border border-base-content/10 bg-base-200/50 p-3 text-sm">
      <input bind:checked={recoveredBackupEncrypt} type="checkbox" class="checkbox mt-0.5" />
      <span>
        <span class="block font-semibold">Encrypt updated backup with a passphrase</span>
        <span class="block text-xs opacity-70">
          Use this if the file may be stored in downloads, cloud storage, or a shared device.
        </span>
      </span>
    </label>

    {#if recoveredBackupEncrypt}
      <div class="grid gap-2 sm:grid-cols-2">
        <label class="input input-sm input-bordered flex w-full items-center gap-2">
          <Icon icon={Key} />
          <input
            bind:value={recoveredBackupPassphrase}
            type={showRecoveredBackupPassphrase ? "text" : "password"}
            class="min-w-0 grow"
            placeholder="passphrase"
            autocomplete="new-password" />
          <button
            type="button"
            class="btn btn-square btn-ghost btn-xs"
            aria-label={showRecoveredBackupPassphrase ? "Hide passphrase" : "Show passphrase"}
            onclick={() => (showRecoveredBackupPassphrase = !showRecoveredBackupPassphrase)}>
            <Icon icon={showRecoveredBackupPassphrase ? EyeClosed : Eye} />
          </button>
        </label>
        <label class="input input-sm input-bordered flex w-full items-center gap-2">
          <Icon icon={Key} />
          <input
            bind:value={recoveredBackupPassphraseConfirm}
            type={showRecoveredBackupPassphraseConfirm ? "text" : "password"}
            class="min-w-0 grow"
            placeholder="confirm passphrase"
            autocomplete="new-password" />
          <button
            type="button"
            class="btn btn-square btn-ghost btn-xs"
            aria-label={showRecoveredBackupPassphraseConfirm
              ? "Hide passphrase"
              : "Show passphrase"}
            onclick={() =>
              (showRecoveredBackupPassphraseConfirm = !showRecoveredBackupPassphraseConfirm)}>
            <Icon icon={showRecoveredBackupPassphraseConfirm ? EyeClosed : Eye} />
          </button>
        </label>
      </div>
    {/if}

    <div class="flex flex-col-reverse gap-2 sm:flex-row sm:gap-3">
      <Button
        class="btn btn-neutral btn-sm inline-flex justify-center"
        onclick={backToRecoveryInput}>← Back</Button>
      <Button
        class="btn btn-neutral btn-sm inline-flex flex-1 justify-center"
        onclick={downloadRecoveredBackup}
        disabled={recoveredBackupDownloading}>
        {recoveredBackupDownloading ? "Downloading…" : "Download updated backup"}
      </Button>
      <Button
        class="btn btn-primary btn-sm inline-flex flex-1 justify-center"
        onclick={finishRestore}
        disabled={recoveredBackupRequired && !recoveredBackupDownloaded}>
        {recoveredBackupDownloaded ? "Continue" : "Continue after download"}
      </Button>
    </div>
  {/if}

  {#if !restoring && trustedMints.length > 0 && (source === "file" || source === "manual")}
    <label
      class="flex cursor-pointer gap-3 rounded-box border border-base-content/10 bg-base-100/50 p-3 text-sm">
      <input bind:checked={includeTrustedRecoveryMints} type="checkbox" class="checkbox mt-0.5" />
      <span class="min-w-0">
        <span class="block font-semibold">Check already trusted mints on this device</span>
        <span class="block opacity-70">
          Budabit will add these mints to the recovery run and updated backup file.
        </span>
        <span class="mt-2 flex flex-col gap-1">
          {#each trustedMints as mint (mint)}
            <span class="break-all font-mono text-xs opacity-80">{mint}</span>
          {/each}
        </span>
      </span>
    </label>
  {/if}

  {#if !restoring && (source === "file" || source === "manual")}
    <label
      class="flex cursor-pointer gap-3 rounded-box border border-base-content/10 bg-base-200/50 p-3 text-sm">
      <input bind:checked={encryptRestoredSeed} type="checkbox" class="checkbox mt-0.5" />
      <span>
        <span class="block font-semibold">Store restored seed encrypted on this device</span>
        <span class="block opacity-70">
          Recommended for shared devices. You will need this passphrase after the browser session
          expires.
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
  {/if}

  {#if !restoring && source === "file"}
    <div class="flex flex-col-reverse gap-2 sm:flex-row sm:gap-3">
      <Button
        class="btn btn-neutral btn-sm inline-flex justify-center"
        onclick={() => (source = "choice")}>← Back</Button>
      <Button
        class="btn btn-warning btn-sm inline-flex flex-1 justify-center"
        onclick={restoreFromFile}
        disabled={restoring || !parsedBackup}>
        {restoring ? "Restoring…" : "Restore and recover"}
      </Button>
    </div>
  {:else if !restoring && source === "manual"}
    <div class="flex flex-col-reverse gap-2 sm:flex-row sm:gap-3">
      <Button
        class="btn btn-neutral btn-sm inline-flex justify-center"
        onclick={() => (source = "choice")}>← Back</Button>
      <Button
        class="btn btn-warning btn-sm inline-flex flex-1 justify-center"
        onclick={restoreManualSeed}
        disabled={restoring || !manualMnemonic.trim()}>
        {restoring ? "Restoring…" : "Trust selected mints and recover"}
      </Button>
    </div>
  {/if}

  {#if error}
    <p class="text-sm text-error">{error}</p>
  {/if}
  {#if status}
    <p class="text-sm text-success">{status}</p>
  {/if}
</div>
