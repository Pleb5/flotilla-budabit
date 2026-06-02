<script lang="ts">
  import AltArrowLeft from "@assets/icons/alt-arrow-left.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import ModalHeader from "@lib/components/ModalHeader.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import {formatCashuSats} from "@app/util/cashu-format"

  type MintChangeAction = "add" | "remove"
  type ConfirmResult = boolean | string | void

  interface Props {
    action: MintChangeAction
    mintUrl: string
    balance?: number
    addLabel?: string
    addRecoveryLabel?: string
    removeLabel?: string
    confirm: (options: {recover: boolean}) => Promise<ConfirmResult>
  }

  const {
    action,
    mintUrl,
    balance = 0,
    addLabel = "Add only",
    addRecoveryLabel = "Add and try recovery",
    removeLabel = "Remove and download backup",
    confirm,
  }: Props = $props()

  let loading = $state<"confirm" | "recover" | "">("")
  let error = $state("")

  const back = () => history.back()

  const tryConfirm = async (recover: boolean) => {
    if (loading) return

    loading = recover ? "recover" : "confirm"
    error = ""

    try {
      const result = await confirm({recover})
      if (typeof result === "string") {
        error = result
        return
      }
      if (result === false) {
        error = "Failed to update mint"
        return
      }
      back()
    } catch (e: any) {
      error = e?.message || "Failed to update mint"
    } finally {
      loading = ""
    }
  }
</script>

<div class="column gap-4">
  <ModalHeader>
    {#snippet title()}
      <div>{action === "add" ? "Add Trusted Mint" : "Remove Trusted Mint"}</div>
    {/snippet}
  </ModalHeader>

  <div class="flex flex-col gap-3 text-sm">
    {#if action === "remove"}
      <div class="rounded-lg border border-warning/50 bg-warning/10 p-3 text-warning">
        <p class="font-semibold">You have {formatCashuSats(balance)} sats in this mint.</p>
        <p class="mt-1 break-all font-mono text-xs">{mintUrl}</p>
      </div>
      <p class="opacity-75">
        Removing a trusted mint changes what your Cashu backup can recover, so Budabit will
        download an updated backup file after removing it.
      </p>
    {:else}
      <p>Budabit cannot know whether this mint has funds for your wallet seed until it asks the mint.</p>
      <p class="break-all font-mono text-xs opacity-75">{mintUrl}</p>
      <p class="opacity-75">
        Adding a trusted mint changes what your Cashu backup can recover, so Budabit will download
        an updated backup file after adding it.
      </p>
      <div class="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
        You can add it normally, or add it and try recovery to ask this mint for any proofs that
        belong to your wallet seed.
      </div>
    {/if}
  </div>

  {#if error}
    <p class="text-sm text-error">{error}</p>
  {/if}

  {#if action === "add"}
    <div class="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <Button class="btn btn-link inline-flex justify-center sm:justify-start" onclick={back} disabled={Boolean(loading)}>
        <Icon icon={AltArrowLeft} />
        Go back
      </Button>
      <div class="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button
          class="btn btn-ghost min-h-fit whitespace-normal text-center"
          onclick={() => tryConfirm(false)}
          disabled={Boolean(loading)}>
          <Spinner loading={loading === "confirm"}>{addLabel}</Spinner>
        </Button>
        <Button
          class="btn btn-primary min-h-fit whitespace-normal text-center"
          onclick={() => tryConfirm(true)}
          disabled={Boolean(loading)}>
          <Spinner loading={loading === "recover"}>{addRecoveryLabel}</Spinner>
        </Button>
      </div>
    </div>
  {:else}
    <div class="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <Button class="btn btn-link inline-flex justify-center sm:justify-start" onclick={back} disabled={Boolean(loading)}>
        <Icon icon={AltArrowLeft} />
        Go back
      </Button>
      <Button
        class="btn btn-primary min-h-fit whitespace-normal text-center sm:text-left"
        onclick={() => tryConfirm(false)}
        disabled={Boolean(loading)}>
        <Spinner loading={loading === "confirm"}>{removeLabel}</Spinner>
      </Button>
    </div>
  {/if}
</div>
