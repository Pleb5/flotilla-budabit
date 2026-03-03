<script lang="ts">
  import {goto} from "$app/navigation"
  import {preventDefault} from "@lib/html"
  import {shouldUnwrap} from "@welshman/app"
  import AltArrowLeft from "@assets/icons/alt-arrow-left.svg?dataurl"
  import AltArrowRight from "@assets/icons/alt-arrow-right.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import ModalHeader from "@lib/components/ModalHeader.svelte"
  import ModalFooter from "@lib/components/ModalFooter.svelte"
  import {clearModals} from "@app/util/modal"
  import Link from "@lib/components/Link.svelte"

  const {next} = $props()

  const nextUrl = $state.snapshot(next)

  let loading = $state(false)

  const submit = async () => {
    loading = true

    try {
      shouldUnwrap.set(true)
      clearModals()
      goto(nextUrl)
    } finally {
      loading = false
    }
  }

  const back = () => history.back()
</script>

<form class="column gap-4" onsubmit={preventDefault(submit)}>
  <ModalHeader>
    {#snippet title()}
      <div>Enable Messages</div>
    {/snippet}
    {#snippet info()}
      <div>Do you want to enable direct messages?</div>
    {/snippet}
  </ModalHeader>
  <p>
    Direct messages are disabled by default. To use them, you must
    <Link class="link" href="/settings/relays">configure</Link>
    a DM inbox relay in your relay settings.
  </p>
  <p>
    Make sure your signer is set up to auto-approve requests to decrypt data.
  </p>
  <ModalFooter>
    <Button class="btn btn-link" onclick={back}>
      <Icon icon={AltArrowLeft} />
      Go back
    </Button>
    <Button type="submit" class="btn btn-primary" disabled={loading}>
      <Spinner {loading}>Enable Messages</Spinner>
      <Icon icon={AltArrowRight} />
    </Button>
  </ModalFooter>
</form>
