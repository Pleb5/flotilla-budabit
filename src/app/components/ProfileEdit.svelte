<script lang="ts">
  import type {Profile} from "@welshman/util"
  import {makeProfile} from "@welshman/util"
  import {pubkey, profilesByPubkey} from "@welshman/app"
  import Button from "@lib/components/Button.svelte"
  import ProfileEditForm from "@app/components/ProfileEditForm.svelte"
  import {clearModals} from "@app/util/modal"
  import {pushToast} from "@app/util/toast"
  import {updateProfile} from "../core/commands"

  const profile = $profilesByPubkey.get($pubkey!) || makeProfile()
  const shouldBroadcast = true
  const initialValues = {profile, shouldBroadcast}

  const back = () => history.back()

  const onsubmit = ({profile, shouldBroadcast}: {profile: Profile; shouldBroadcast: boolean}) => {
    updateProfile({profile, shouldBroadcast})
    pushToast({message: "Your profile has been updated!"})
    clearModals()
  }
</script>

<ProfileEditForm {initialValues} {onsubmit}>
  {#snippet footer()}
    <div class="mt-4 flex flex-row items-center justify-between gap-4">
      <Button class="btn btn-neutral" onclick={back}>Discard Changes</Button>
      <Button type="submit" class="btn btn-primary">Save Changes</Button>
    </div>
  {/snippet}
</ProfileEditForm>
