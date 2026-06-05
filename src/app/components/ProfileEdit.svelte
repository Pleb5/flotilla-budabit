<script lang="ts">
  import type {Profile} from "@welshman/util"
  import {makeProfile} from "@welshman/util"
  import {pubkey, profilesByPubkey} from "@welshman/app"
  import Button from "@lib/components/Button.svelte"
  import ProfileEditForm from "@app/components/ProfileEditForm.svelte"
  import {clearModals} from "@app/util/modal"
  import {pushToast} from "@app/util/toast"
  import {updateProfile} from "@app/core/commands"

  const profile = $profilesByPubkey.get($pubkey!) || makeProfile()
  const shouldBroadcast = true
  const initialValues = {profile, shouldBroadcast}

  let saving = $state(false)

  const back = () => history.back()

  const onsubmit = async ({profile, shouldBroadcast}: {profile: Profile; shouldBroadcast: boolean}) => {
    if (saving) return

    saving = true

    try {
      await updateProfile({profile, shouldBroadcast})
      pushToast({message: "Your profile has been updated!"})
      clearModals()
    } catch (error) {
      pushToast({
        theme: "error",
        message: error instanceof Error ? error.message : "Failed to update profile",
      })
    } finally {
      saving = false
    }
  }
</script>

<ProfileEditForm {initialValues} {onsubmit} pubkey={$pubkey!}>
  {#snippet footer()}
    <div class="mt-4 flex flex-row items-center justify-between gap-4">
      <Button class="btn btn-neutral" onclick={back} disabled={saving}>Discard Changes</Button>
      <Button type="submit" class="btn btn-primary" disabled={saving}>
        {saving ? "Saving..." : "Save Changes"}
      </Button>
    </div>
  {/snippet}
</ProfileEditForm>
