<script lang="ts">
  import {nsecEncode} from "nostr-tools/nip19"
  import {encrypt} from "nostr-tools/nip49"
  import {loginWithNip01} from "@welshman/app"
  import {hexToBytes} from "@welshman/lib"
  import {makeSecret} from "@welshman/util"
  import type {Profile} from "@welshman/util"
  import {preventDefault, downloadText} from "@lib/html"
  import Key from "@assets/icons/key-minimalistic.svg?dataurl"
  import ArrowDown from "@assets/icons/arrow-down.svg?dataurl"
  import AltArrowLeft from "@assets/icons/alt-arrow-left.svg?dataurl"
  import AltArrowRight from "@assets/icons/alt-arrow-right.svg?dataurl"
  import Eye from "@assets/icons/eye.svg?dataurl"
  import EyeClosed from "@assets/icons/eye-closed.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Field from "@lib/components/Field.svelte"
  import Button from "@lib/components/Button.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import ModalHeader from "@lib/components/ModalHeader.svelte"
  import ModalFooter from "@lib/components/ModalFooter.svelte"
  import SignUpComplete from "@app/components/SignUpComplete.svelte"
  import {pushToast} from "@app/util/toast"
  import {pushModal} from "@app/util/modal"
  import {cleanupBackupCopy} from "@app/util/secret-file"
  import {validateNewPassphrase} from "@app/util/passphrase"
  import {PROFILE_PUBLISH_RETRY_MESSAGE, updateProfile} from "@app/core/commands"

  type Props = {
    profile: Profile
  }

  const {profile}: Props = $props()

  const secret = makeSecret()

  const back = () => history.back()

  const downloadKey = () => {
    const sharedCopy = `
    Most online services keep track of users by giving them a username and password. This gives the
    service total control over their users, allowing them to ban them at any time, or sell their activity.

    On Nostr, you control your own identity and social data, through the magic of cryptography. The basic
    idea is that you have a public key, which acts as your user ID, and a private key which allows you to
    prove your identity.

    It's very important to keep your private key secret because it grants permanent and complete access to your
    account.
    `

    if (usePassword) {
      const passphraseError = validateNewPassphrase(passphrase, passphraseConfirm)

      if (passphraseError) {
        return pushToast({
          theme: "error",
          message: passphraseError,
        })
      }

      const ncryptsec = encrypt(hexToBytes(secret), passphrase)
      const instructions = `
      This file contains a backup of your Nostr secret key, encrypted using
      a passphrase you chose when you signed up.

      ${sharedCopy}

      Your encrypted private key is:

      ${ncryptsec}

      To use it to log in to other Nostr apps, find a Nostr Signer app (https://nostrapps.com/#signers is a good
      place to look), and import your key.
      `

      downloadText("Nostr Secret Key.txt", cleanupBackupCopy(instructions))
    } else {
      const nsec = nsecEncode(hexToBytes(secret))
      const instructions = `
      This file contains a backup of your Nostr secret key.

      ${sharedCopy}

      Your private key is:

      ${nsec}

      To use it to log in to other Nostr apps, find a Nostr Signer app (https://nostrapps.com/#signers is a good
      place to look), and import your key.
      `

      downloadText("Nostr Secret Key.txt", cleanupBackupCopy(instructions))
    }

    didDownload = true
  }

  const publishProfile = async () => {
    if (publishing || !didDownload) return

    publishing = true
    loginWithNip01(secret)

    try {
      await updateProfile({profile})
      pushToast({theme: "success", message: "Profile published."})
      pushModal(SignUpComplete)
    } catch (error) {
      pushToast({
        theme: "error",
        message: `${error instanceof Error ? error.message : "Profile publish failed."} ${PROFILE_PUBLISH_RETRY_MESSAGE}`,
      })
    } finally {
      publishing = false
    }
  }

  const onPasswordChange = () => {
    didDownload = false
  }

  const toggleUsePassword = () => {
    usePassword = !usePassword
    didDownload = false
  }

  let passphrase = $state("")
  let passphraseConfirm = $state("")
  let showPassphrase = $state(false)
  let showPassphraseConfirm = $state(false)
  let usePassword = $state(false)
  let didDownload = $state(false)
  let publishing = $state(false)
</script>

<form class="column gap-4" onsubmit={preventDefault(publishProfile)}>
  <ModalHeader>
    {#snippet title()}
      <div>Your Keys are Ready!</div>
    {/snippet}
  </ModalHeader>
  <p>
    A cryptographic key pair has two parts: your <strong>public key</strong> identifies your
    account, while your <strong>private key</strong> acts sort of like a master password.
  </p>
  <p>
    Securing your private key is very important, so make sure to take the time to save your key in a
    secure place (like a password manager).
  </p>
  {#if usePassword}
    <Field>
      {#snippet label()}
        Encryption passphrase*
      {/snippet}
      {#snippet input()}
        <label class="input input-bordered flex w-full items-center gap-2">
          <Icon icon={Key} />
          <input
            bind:value={passphrase}
            oninput={onPasswordChange}
            class="grow"
            type={showPassphrase ? "text" : "password"}
            autocomplete="new-password" />
          <button
            type="button"
            class="btn btn-square btn-ghost btn-xs"
            aria-label={showPassphrase ? "Hide passphrase" : "Show passphrase"}
            onclick={() => (showPassphrase = !showPassphrase)}>
            <Icon icon={showPassphrase ? EyeClosed : Eye} />
          </button>
        </label>
      {/snippet}
      {#snippet info()}
        <p>Use at least 12 characters. This passphrase is not recoverable.</p>
      {/snippet}
    </Field>
    <Field>
      {#snippet label()}
        Confirm passphrase*
      {/snippet}
      {#snippet input()}
        <label class="input input-bordered flex w-full items-center gap-2">
          <Icon icon={Key} />
          <input
            bind:value={passphraseConfirm}
            oninput={onPasswordChange}
            class="grow"
            type={showPassphraseConfirm ? "text" : "password"}
            autocomplete="new-password" />
          <button
            type="button"
            class="btn btn-square btn-ghost btn-xs"
            aria-label={showPassphraseConfirm ? "Hide passphrase" : "Show passphrase"}
            onclick={() => (showPassphraseConfirm = !showPassphraseConfirm)}>
            <Icon icon={showPassphraseConfirm ? EyeClosed : Eye} />
          </button>
        </label>
      {/snippet}
    </Field>
  {/if}
  <div class="flex flex-col">
    <Button class="btn {didDownload ? 'btn-neutral' : 'btn-primary'}" onclick={downloadKey}>
      Download my key
      <Icon icon={ArrowDown} />
    </Button>
    <Button class="btn btn-link no-underline" onclick={toggleUsePassword}>
      {#if usePassword}
        Nevermind, I want to download the plain version
      {:else}
        I want to download an encrypted version
      {/if}
    </Button>
  </div>
  <ModalFooter>
    <Button class="btn btn-link" onclick={back}>
      <Icon icon={AltArrowLeft} />
      Go back
    </Button>
    <Button disabled={!didDownload || publishing} class="btn btn-primary" type="submit">
      <Spinner loading={publishing}>Publish Profile</Spinner>
      <Icon icon={AltArrowRight} />
    </Button>
  </ModalFooter>
</form>
