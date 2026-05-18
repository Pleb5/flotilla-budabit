<script lang="ts">
  import {addSession} from "@welshman/app"
  import {preventDefault} from "@lib/html"
  import Spinner from "@lib/components/Spinner.svelte"
  import Button from "@lib/components/Button.svelte"
  import Field from "@lib/components/Field.svelte"
  import ModalHeader from "@lib/components/ModalHeader.svelte"
  import ModalFooter from "@lib/components/ModalFooter.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import Key from "@assets/icons/key-minimalistic.svg?dataurl"
  import AltArrowLeft from "@assets/icons/alt-arrow-left.svg?dataurl"
  import AltArrowRight from "@assets/icons/alt-arrow-right.svg?dataurl"
  import Eye from "@assets/icons/eye.svg?dataurl"
  import EyeClosed from "@assets/icons/eye-closed.svg?dataurl"
  import {lockedLocalKeySessions, unlockEncryptedLocalKeySession} from "@app/core/session-storage"
  import {formatShortNpub} from "@app/util/pubkeys"
  import {clearModals} from "@app/util/modal"
  import {setChecked} from "@app/util/notifications"
  import {pushToast} from "@app/util/toast"

  type Props = {
    pubkey: string
  }

  const {pubkey}: Props = $props()
  const lockedSession = $derived($lockedLocalKeySessions[pubkey])
  const displayPubkey = $derived(formatShortNpub(pubkey) || "local key")

  const back = () => history.back()

  const unlock = async () => {
    if (!lockedSession || !passphrase.trim() || loading) return

    loading = true

    try {
      addSession(unlockEncryptedLocalKeySession(lockedSession, passphrase))
      pushToast({message: "Successfully unlocked local key!"})
      setChecked("*")
      clearModals()
    } catch {
      pushToast({theme: "error", message: "Could not unlock local key. Check the passphrase."})
    } finally {
      loading = false
    }
  }

  let passphrase = $state("")
  let showPassphrase = $state(false)
  let loading = $state(false)
</script>

<form class="column gap-4" onsubmit={preventDefault(unlock)}>
  <ModalHeader>
    {#snippet title()}
      <div>Unlock Local Key</div>
    {/snippet}
    {#snippet info()}
      <div>Enter the passphrase for {displayPubkey}.</div>
    {/snippet}
  </ModalHeader>

  {#if lockedSession}
    <Field>
      {#snippet label()}
        <p>Encryption passphrase</p>
      {/snippet}
      {#snippet input()}
        <label class="input input-bordered flex w-full items-center gap-2">
          <Icon icon={Key} />
          <input
            bind:value={passphrase}
            disabled={loading}
            type={showPassphrase ? "text" : "password"}
            class="grow"
            autocomplete="current-password" />
          <button
            type="button"
            class="btn btn-square btn-ghost btn-xs"
            disabled={loading}
            aria-label={showPassphrase ? "Hide passphrase" : "Show passphrase"}
            onclick={() => (showPassphrase = !showPassphrase)}>
            <Icon icon={showPassphrase ? EyeClosed : Eye} />
          </button>
        </label>
      {/snippet}
    </Field>
  {:else}
    <p class="rounded-box bg-base-200 p-3 text-sm opacity-80">
      This encrypted local key is no longer available on this device.
    </p>
  {/if}

  <ModalFooter>
    <Button class="btn btn-link" onclick={back} disabled={loading}>
      <Icon icon={AltArrowLeft} />
      Go back
    </Button>
    <Button
      type="submit"
      class="btn btn-primary"
      disabled={loading || !lockedSession || !passphrase.trim()}>
      <Spinner {loading}>Unlock</Spinner>
      <Icon icon={AltArrowRight} />
    </Button>
  </ModalFooter>
</form>
