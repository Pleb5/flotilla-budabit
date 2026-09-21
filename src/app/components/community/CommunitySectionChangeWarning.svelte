<script lang="ts">
  import Button from "@lib/components/Button.svelte"
  import ModalFooter from "@lib/components/ModalFooter.svelte"
  import ModalHeader from "@lib/components/ModalHeader.svelte"
  import {preventDefault} from "@lib/html"
  import {closeTopModal} from "@app/util/modal"

  type Props = {
    title: string
    description: string
    details?: string[]
    resetLabel: string
    keepLabel?: string
    onReset: () => void
    onKeep?: () => void
    destructive?: boolean
  }

  const {
    title: modalTitle,
    description,
    details = [],
    resetLabel,
    keepLabel = "Keep change",
    onReset,
    onKeep,
    destructive = false,
  }: Props = $props()

  const reset = () => {
    onReset()
    closeTopModal()
  }

  const keep = () => {
    onKeep?.()
    closeTopModal()
  }
</script>

<form class="column gap-4" onsubmit={preventDefault(keep)}>
  <ModalHeader>
    {#snippet title()}<div>{modalTitle}</div>{/snippet}
    {#snippet info()}<div>{description}</div>{/snippet}
  </ModalHeader>

  {#if details.length > 0}
    <div class="rounded-box border border-warning/30 bg-warning/10 p-4 text-sm leading-relaxed">
      {#each details as detail}
        <p>{detail}</p>
      {/each}
    </div>
  {/if}

  <ModalFooter>
    <Button
      class="btn {destructive ? 'btn-ghost' : 'btn-primary'}"
      type="submit"
      data-modal-initial-focus>{keepLabel}</Button>
    <Button class="btn {destructive ? 'btn-error' : 'btn-ghost'}" onclick={reset}
      >{resetLabel}</Button>
  </ModalFooter>
</form>
