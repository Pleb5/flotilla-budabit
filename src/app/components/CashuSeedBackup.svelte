<script lang="ts">
  import {
    cashuBackupConfirmed,
    cashuMints,
    cashuSeedLocked,
    cashuSetupResolved,
    cashuSetupRequired,
  } from "@app/core/cashu"
  import Button from "@lib/components/Button.svelte"
  import CashuWalletBackup from "@app/components/CashuWalletBackup.svelte"
  import CashuWalletCreate from "@app/components/CashuWalletCreate.svelte"
  import CashuWalletRestore from "@app/components/CashuWalletRestore.svelte"
  import CashuWalletUnlock from "@app/components/CashuWalletUnlock.svelte"

  export type CashuSeedBackupMode = "auto" | "setup" | "backup" | "restore" | "unlock"
  type Screen = "choice" | "create" | "backup" | "restore" | "unlock"

  interface Props {
    onconfirmed?: () => void
    mode?: CashuSeedBackupMode
  }

  const {onconfirmed, mode = "auto"}: Props = $props()

  let screen = $state<Screen>("choice")
  let initialized = $state(false)

  const setupRequired = $derived($cashuSetupRequired)
  const setupResolved = $derived($cashuSetupResolved)
  const seedLocked = $derived($cashuSeedLocked)
  const backupConfirmed = $derived($cashuBackupConfirmed)
  const mints = $derived($cashuMints)

  const getInitialScreen = (): Screen => {
    if (mode === "restore") return "restore"
    if (mode === "unlock") return "unlock"
    if (seedLocked) return "unlock"
    if (mode === "backup") return setupRequired ? "choice" : "backup"
    if (mode === "setup") return "choice"
    if (setupRequired) return "choice"
    if (!backupConfirmed && mints.length === 0) return "create"
    return "backup"
  }

  const handleUnlocked = () => {
    if (backupConfirmed) {
      onconfirmed?.()
      return
    }

    screen = mints.length === 0 ? "create" : "backup"
  }

  $effect(() => {
    if (initialized) return
    if (!setupResolved && mode !== "restore") return

    screen = getInitialScreen()
    initialized = true
  })
</script>

{#if !initialized}
  <div class="flex min-h-[320px] items-center justify-center p-4 text-sm opacity-70">
    Loading Cashu wallet…
  </div>
{:else if screen === "choice"}
  <div class="flex min-w-0 flex-col gap-4 p-2 sm:gap-6 sm:p-4">
    <div class="flex flex-col gap-2">
      <h3 class="text-lg font-bold">Set Up Cashu Wallet</h3>
      <p class="text-sm opacity-75">
        Create a new ecash wallet or restore one you already used. Budabit will not create seed
        words until you choose to create a new wallet.
      </p>
    </div>

    <div class="grid gap-3 sm:grid-cols-2">
      <button
        type="button"
        class="rounded-box border border-base-300 bg-base-200/50 p-4 text-left hover:bg-base-300"
        onclick={() => (screen = "create")}>
        <p class="font-semibold">Create new wallet</p>
        <p class="mt-1 text-sm opacity-70">Generate new seed words, add mints, then back up.</p>
      </button>
      <button
        type="button"
        class="rounded-box border border-base-300 bg-base-200/50 p-4 text-left hover:bg-base-300"
        onclick={() => (screen = "restore")}>
        <p class="font-semibold">Restore existing wallet</p>
        <p class="mt-1 text-sm opacity-70">Use a backup file or seed words plus mint URLs.</p>
      </button>
    </div>
  </div>
{:else if screen === "unlock"}
  <CashuWalletUnlock onunlocked={handleUnlocked} onrestore={() => (screen = "restore")} />
{:else if screen === "create"}
  <CashuWalletCreate onbackup={() => (screen = "backup")} onrestore={() => (screen = "restore")} />
{:else if screen === "restore"}
  <CashuWalletRestore
    {onconfirmed}
    oncreate={setupRequired ? () => (screen = "create") : undefined} />
{:else}
  <CashuWalletBackup
    {onconfirmed}
    onback={mode === "backup" || mode === "unlock" ? undefined : () => (screen = "create")} />
{/if}

{#if screen !== "choice" && screen !== "backup" && mode !== "backup" && mode !== "unlock"}
  <div class="px-2 pb-2 sm:px-4 sm:pb-4">
    <Button
      class="btn btn-ghost btn-xs inline-flex justify-center"
      onclick={() => (screen = "choice")}>
      Start over
    </Button>
  </div>
{/if}
