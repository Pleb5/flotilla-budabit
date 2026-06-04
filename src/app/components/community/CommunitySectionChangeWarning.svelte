<script lang="ts">
  import Button from "@lib/components/Button.svelte"
  import ModalFooter from "@lib/components/ModalFooter.svelte"
  import ModalHeader from "@lib/components/ModalHeader.svelte"
  import {preventDefault} from "@lib/html"

  type Props = {
    title: string
    description: string
    details?: string[]
    resetLabel: string
    keepLabel?: string
    onReset: () => void
    onKeep?: () => void
  }

  const {
    title: modalTitle,
    description,
    details = [],
    resetLabel,
    keepLabel = "Keep change",
    onReset,
    onKeep,
  }: Props = $props()

  const reset = () => {
    onReset()
    history.back()
  }

  const keep = () => {
    onKeep?.()
    history.back()
  }
</script>

<form class="column gap-4" onsubmit={preventDefault(reset)}>
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
    <Button class="btn btn-ghost" onclick={keep}>{keepLabel}</Button>
    <Button class="btn btn-primary" type="submit">{resetLabel}</Button>
  </ModalFooter>
</form>
