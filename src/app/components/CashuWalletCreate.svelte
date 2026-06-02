<script lang="ts">
  import {cashuMints, cashuSetupRequired, createCashuWallet} from "@app/core/cashu"
  import CashuMintManager from "@app/components/CashuMintManager.svelte"
  import Button from "@lib/components/Button.svelte"

  interface Props {
    onbackup?: () => void
    onrestore?: () => void
  }

  const {onbackup, onrestore}: Props = $props()

  let creating = $state(false)
  let error = $state("")
  let status = $state("")

  const setupRequired = $derived($cashuSetupRequired)
  const mints = $derived($cashuMints)

  const create = async () => {
    if (creating) return

    creating = true
    error = ""
    status = ""
    try {
      await createCashuWallet()
      status = "Cashu seed created. Add at least one trusted mint before backing it up."
    } catch (e: any) {
      error = e?.message || "Could not create a Cashu wallet."
    } finally {
      creating = false
    }
  }
</script>

<div class="flex min-w-0 flex-col gap-4 p-2 sm:gap-6 sm:p-4">
  {#if setupRequired}
    <div class="flex flex-col gap-2">
      <h3 class="text-lg font-bold">Create Cashu Wallet</h3>
    </div>

    <div class="rounded-box border border-warning/30 bg-warning/10 p-3 text-sm">
      A Cashu seed only recovers funds from mints you check. After creating the seed, add at least
      one trusted mint and download the backup file.
    </div>

    <div class="flex flex-col gap-2 sm:flex-row sm:gap-3">
      <Button
        class="btn btn-primary btn-sm inline-flex flex-1 justify-center"
        onclick={create}
        disabled={creating}>
        {creating ? "Creating…" : "Create new wallet"}
      </Button>
      <Button class="btn btn-neutral btn-sm inline-flex justify-center" onclick={onrestore}>
        Restore existing wallet
      </Button>
    </div>
  {:else}
    <div class="flex flex-col gap-2">
      <h3 class="text-lg font-bold">Add Trusted Mints</h3>
      <p class="text-sm opacity-75">
        Add at least one mint before backing up. Your backup file will include the seed words and
        trusted mint list.
      </p>
    </div>

    <CashuMintManager />

    <Button
      class="btn btn-primary btn-sm inline-flex w-full justify-center"
      onclick={onbackup}
      disabled={mints.length === 0}>
      Continue to backup
    </Button>
  {/if}

  {#if error}
    <p class="text-sm text-error">{error}</p>
  {/if}
  {#if status}
    <p class="text-sm text-success">{status}</p>
  {/if}
</div>
