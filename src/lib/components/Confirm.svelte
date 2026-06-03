<script lang="ts">
  import type {Readable} from "svelte/store"
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
    status?: Readable<string>
  }

  const {
    subtitle = "",
    message,
    confirm,
    confirmLabel = "Confirm",
    status,
    ...restProps
  }: Props = $props()

  let loading = $state(false)
  let statusText = $state("")

  $effect(() => {
    if (!status) {
      statusText = ""
      return
    }

    return status.subscribe(value => {
      statusText = value
    })
  })

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
  {#if statusText}
    <div
      class="rounded-box border border-info/30 bg-info/10 px-4 py-3 text-sm text-info"
      aria-live="polite">
      <Spinner loading={true}>{statusText}</Spinner>
    </div>
  {/if}
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
