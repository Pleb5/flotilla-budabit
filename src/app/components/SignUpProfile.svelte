<script lang="ts">
  import {makeProfile, makeSecret} from "@welshman/util"
  import {getPublicKey} from "nostr-tools"
  import {hexToBytes} from "@welshman/lib"
  import type {ProfileValues} from "@app/util/profile-identity"
  import AltArrowLeft from "@assets/icons/alt-arrow-left.svg?dataurl"
  import AltArrowRight from "@assets/icons/alt-arrow-right.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import ModalFooter from "@lib/components/ModalFooter.svelte"
  import ProfileEditForm from "@app/components/ProfileEditForm.svelte"
  import SignUpKey from "@app/components/SignUpKey.svelte"
  import {pushModal} from "@app/util/modal"

  const initialValues = {
    profile: makeProfile(),
  }
  const secret = makeSecret()
  const pubkey = getPublicKey(hexToBytes(secret))

  const back = () => history.back()

  const onsubmit = (values: ProfileValues) => pushModal(SignUpKey, {...values, secret})
</script>

<div class="flex flex-col gap-4">
  <ProfileEditForm isSignup {initialValues} {onsubmit} {pubkey}>
    {#snippet footer()}
      <ModalFooter>
        <Button class="btn btn-link" onclick={back}>
          <Icon icon={AltArrowLeft} />
          Go back
        </Button>
        <Button class="btn btn-primary" type="submit">
          Create Account
          <Icon icon={AltArrowRight} />
        </Button>
      </ModalFooter>
    {/snippet}
  </ProfileEditForm>
</div>
