<script lang="ts">
  import {addSession, makeNip01Session} from "@welshman/app"
  import {preventDefault} from "@lib/html"
  import {nsecDecode} from "@lib/util"
  import Spinner from "@lib/components/Spinner.svelte"
  import Button from "@lib/components/Button.svelte"
  import Field from "@lib/components/Field.svelte"
  import ModalHeader from "@lib/components/ModalHeader.svelte"
  import ModalFooter from "@lib/components/ModalFooter.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import ShieldWarning from "@assets/icons/shield-warning.svg?dataurl"
  import Key from "@assets/icons/key-minimalistic.svg?dataurl"
  import AltArrowLeft from "@assets/icons/alt-arrow-left.svg?dataurl"
  import AltArrowRight from "@assets/icons/alt-arrow-right.svg?dataurl"
  import {clearModals} from "@app/util/modal"
  import {setChecked} from "@app/util/notifications"
  import {pushToast} from "@app/util/toast"

  const back = () => history.back()

  const submit = async () => {
    if (loading) return

    const value = nsec.trim()
    if (!value) return

    loading = true

    try {
      const secret = nsecDecode(value)
      addSession(makeNip01Session(secret))
      pushToast({message: "Successfully logged in!"})
      setChecked("*")
      clearModals()
    } catch (e) {
      pushToast({theme: "error", message: "Enter a valid nsec private key."})
    } finally {
      loading = false
    }
  }

  let nsec = $state("")
  let loading = $state(false)
</script>

<form class="column gap-4" onsubmit={preventDefault(submit)}>
  <ModalHeader>
    {#snippet title()}
      <div>Log In with Local Key</div>
    {/snippet}
    {#snippet info()}
      <div>Use an nsec private key stored on this device.</div>
    {/snippet}
  </ModalHeader>

  <div class="rounded-box border border-warning/40 bg-warning/10 p-3 text-sm">
    <div class="flex items-center gap-2 font-semibold">
      <Icon icon={ShieldWarning} />
      least secure
    </div>
    <p class="mt-1 opacity-80">
      Prefer an extension or remote signer when possible. A local key grants full account access
      from this browser profile.
    </p>
  </div>

  <Field>
    {#snippet label()}
      <p>Private key</p>
    {/snippet}
    {#snippet input()}
      <label class="input input-bordered flex w-full items-center gap-2">
        <Icon icon={Key} />
        <input
          bind:value={nsec}
          disabled={loading}
          type="password"
          class="grow"
          autocomplete="off"
          spellcheck="false"
          placeholder="nsec1..." />
      </label>
    {/snippet}
    {#snippet info()}
      <p>The key is stored encrypted at rest using NIP-44 encryption to self.</p>
    {/snippet}
  </Field>

  <ModalFooter>
    <Button class="btn btn-link" onclick={back} disabled={loading}>
      <Icon icon={AltArrowLeft} />
      Go back
    </Button>
    <Button type="submit" class="btn btn-primary" disabled={loading || !nsec.trim()}>
      <Spinner {loading}>Log in</Spinner>
      <Icon icon={AltArrowRight} />
    </Button>
  </ModalFooter>
</form>
