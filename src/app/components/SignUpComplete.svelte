<script lang="ts">
  import {goto} from "$app/navigation"
  import {preventDefault} from "@lib/html"
  import AltArrowLeft from "@assets/icons/alt-arrow-left.svg?dataurl"
  import AltArrowRight from "@assets/icons/alt-arrow-right.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import ModalHeader from "@lib/components/ModalHeader.svelte"
  import ModalFooter from "@lib/components/ModalFooter.svelte"
  import {clearModals} from "@app/util/modal"

  const back = () => history.back()

  const next = async () => {
    clearModals()
    await goto("/explore")
  }
</script>

<form class="column gap-4" onsubmit={preventDefault(next)}>
  <ModalHeader>
    {#snippet title()}
      <div>You're all set!</div>
    {/snippet}
  </ModalHeader>
  <p>
    You've created your profile, saved your keys, and now you can start your open-source journey on
    fully open protocols!
  </p>
  <ModalFooter>
    <Button class="btn btn-link" onclick={back}>
      <Icon icon={AltArrowLeft} />
      Go back
    </Button>
    <Button class="btn btn-primary" type="submit">
      Explore Communities
      <Icon icon={AltArrowRight} />
    </Button>
  </ModalFooter>
</form>
