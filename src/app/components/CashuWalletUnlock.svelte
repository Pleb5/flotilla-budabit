<script lang="ts">
  import {unlockEncryptedCashuSeed} from "@app/core/cashu"
  import Button from "@lib/components/Button.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import Key from "@assets/icons/key-minimalistic.svg?dataurl"
  import Eye from "@assets/icons/eye.svg?dataurl"
  import EyeClosed from "@assets/icons/eye-closed.svg?dataurl"

  interface Props {
    onunlocked?: () => void
    onrestore?: () => void
  }

  const {onunlocked, onrestore}: Props = $props()

  let passphrase = $state("")
  let showPassphrase = $state(false)
  let unlocking = $state(false)
  let error = $state("")

  const unlock = async () => {
    if (!passphrase.trim() || unlocking) return

    unlocking = true
    error = ""
    try {
      await unlockEncryptedCashuSeed(passphrase)
      passphrase = ""
      onunlocked?.()
    } catch {
      error = "Could not unlock the Cashu seed. Check the passphrase."
    } finally {
      unlocking = false
    }
  }
</script>

<div class="flex min-w-0 flex-col gap-4 p-2 sm:gap-6 sm:p-4">
  <div class="flex flex-col gap-2">
    <h3 class="text-lg font-bold">Unlock Cashu Wallet</h3>
    <p class="text-sm opacity-75">
      Your Cashu seed is stored encrypted on this device. Enter the passphrase to use the wallet.
    </p>
  </div>

  <div class="flex flex-col gap-2">
    <label class="text-sm font-medium" for="cashu-unlock-passphrase">Encryption passphrase</label>
    <label class="input input-sm input-bordered flex w-full items-center gap-2">
      <Icon icon={Key} />
      <input
        id="cashu-unlock-passphrase"
        bind:value={passphrase}
        disabled={unlocking}
        type={showPassphrase ? "text" : "password"}
        class="min-w-0 grow"
        autocomplete="current-password" />
      <button
        type="button"
        class="btn btn-square btn-ghost btn-xs"
        disabled={unlocking}
        aria-label={showPassphrase ? "Hide passphrase" : "Show passphrase"}
        onclick={() => (showPassphrase = !showPassphrase)}>
        <Icon icon={showPassphrase ? EyeClosed : Eye} />
      </button>
    </label>
  </div>

  <div class="flex flex-col gap-2 sm:flex-row sm:gap-3">
    <Button
      class="btn btn-primary btn-sm inline-flex flex-1 justify-center"
      onclick={unlock}
      disabled={unlocking || !passphrase.trim()}>
      {unlocking ? "Unlocking…" : "Unlock wallet"}
    </Button>
    <Button class="btn btn-neutral btn-sm inline-flex justify-center" onclick={onrestore}>
      Restore instead
    </Button>
  </div>

  {#if error}
    <p class="text-sm text-error">{error}</p>
  {/if}
</div>
