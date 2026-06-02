<script lang="ts">
  import {preventDefault} from "@lib/html"
  import AltArrowLeft from "@assets/icons/alt-arrow-left.svg?dataurl"
  import AltArrowRight from "@assets/icons/alt-arrow-right.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import ModalHeader from "@lib/components/ModalHeader.svelte"

  interface Props {
    title?: string
    subtitle?: string
    message: any
    confirm: any
    confirmLabel?: string
  }

  const {subtitle = "", message, confirm, confirmLabel = "Confirm", ...restProps}: Props = $props()

  let loading = $state(false)

  const tryConfirm = async () => {
    loading = true

    try {
      await confirm()
    } finally {
      loading = false
    }
  }

  const back = () => history.back()
</script>

<form class="column gap-4" onsubmit={preventDefault(tryConfirm)}>
  <ModalHeader>
    {#snippet title()}
      <div>{restProps.title || "Are you sure?"}</div>
    {/snippet}
    {#snippet info()}
      <div>{subtitle}</div>
    {/snippet}
  </ModalHeader>
  <p class="text-center">{message}</p>
  <div class="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <Button class="btn btn-link inline-flex justify-center sm:justify-start" onclick={back}>
      <Icon icon={AltArrowLeft} />
      Go back
    </Button>
    <Button
      type="submit"
      class="btn btn-primary min-h-fit whitespace-normal text-center sm:text-left"
      disabled={loading}>
      <Spinner {loading}>{confirmLabel}</Spinner>
      <Icon icon={AltArrowRight} />
    </Button>
  </div>
</form>
