<script lang="ts">
  import type {Profile} from "@welshman/util"
  import {loginWithNip01} from "@welshman/app"
  import {preventDefault} from "@lib/html"
  import AltArrowLeft from "@assets/icons/alt-arrow-left.svg?dataurl"
  import HomeSmile from "@assets/icons/home-smile.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import ModalHeader from "@lib/components/ModalHeader.svelte"
  import ModalFooter from "@lib/components/ModalFooter.svelte"
  import {clearModals} from "@app/util/modal"
  import {pushToast} from "@app/util/toast"
  import {PROFILE_PUBLISH_RETRY_MESSAGE, updateProfile} from "@app/core/commands"

  type Props = {
    secret: string
    profile: Profile
  }

  const {secret, profile}: Props = $props()

  const back = () => history.back()

  let saving = $state(false)

  const next = async () => {
    if (saving) return

    saving = true
    loginWithNip01(secret)

    try {
      await updateProfile({profile})
    } catch (error) {
      pushToast({
        theme: "error",
        message: `${error instanceof Error ? error.message : "Profile publish failed."} ${PROFILE_PUBLISH_RETRY_MESSAGE}`,
      })
    } finally {
      saving = false
    }

    clearModals()
  }
</script>

<form class="column gap-4" onsubmit={preventDefault(next)}>
  <ModalHeader>
    {#snippet title()}
      <div>You're all set!</div>
    {/snippet}
  </ModalHeader>
  <p>
    You've created your profile, saved your keys, and now you're ready to start chatting — all
    without asking permission!
  </p>
  <p>
    From your dashboard, you can access communities, join conversations, and keep up-to-date on the
    work happening there. Click below to get started!
  </p>
  <ModalFooter>
    <Button class="btn btn-link" onclick={back}>
      <Icon icon={AltArrowLeft} />
      Go back
    </Button>
    <Button class="btn btn-primary" type="submit" disabled={saving}>
      <Icon icon={HomeSmile} />
      {saving ? "Publishing Profile..." : "Go to Dashboard"}
    </Button>
  </ModalFooter>
</form>
