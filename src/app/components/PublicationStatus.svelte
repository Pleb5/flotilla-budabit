<script lang="ts">
  import {pubkey} from "@welshman/app"
  import Button from "@lib/components/Button.svelte"
  import RelayPublishFeedback from "./RelayPublishFeedback.svelte"
  import {canRetryRelayPublishResults} from "@app/core/relay-publish-outcomes"
  import {
    cancelPublication,
    discardPublication,
    publicationOperations,
    retryPublication,
  } from "@app/core/publication-operations"

  type Props = {
    operationId: string
    class?: string
  }

  const {operationId, class: className = ""}: Props = $props()
  const operation = $derived($publicationOperations.get(operationId))
  const accountMismatch = $derived(Boolean(operation && $pubkey !== operation.ownerPubkey))
  let retrying = $state(false)
  let retryError = $state("")

  const retry = async (event: Event) => {
    event.stopPropagation()
    if (!operation || retrying || accountMismatch) return

    retrying = true
    retryError = ""
    try {
      await retryPublication(operationId)
    } catch (error) {
      retryError = error instanceof Error ? error.message : "Failed to retry publication"
    } finally {
      retrying = false
    }
  }

  const cancel = (event: Event) => {
    event.stopPropagation()
    cancelPublication(operationId)
  }

  const discard = (event: Event) => {
    event.stopPropagation()
    discardPublication(operationId)
  }
</script>

{#if operation?.phase === "publishing"}
  <div
    class="flex items-center justify-end gap-2 text-xs opacity-75 {className}"
    aria-live="polite">
    <span>{retrying ? "Retrying..." : "Publishing..."}</span>
    <Button class="btn btn-ghost btn-xs h-auto min-h-0 px-1 py-0" onclick={cancel}>Cancel</Button>
  </div>
{:else if operation?.phase === "unconfirmed"}
  <div class="flex flex-col items-end gap-1 text-xs {className}" aria-live="polite">
    <span class="text-error">Publication not confirmed.</span>
    <RelayPublishFeedback
      results={operation.results}
      error={operation.error}
      requiredRelay={operation.confirmationRelays?.length === 1
        ? operation.confirmationRelays[0]
        : undefined} />
    {#if accountMismatch}
      <span class="text-warning">Restore the publishing account to retry.</span>
    {:else if retryError}
      <span class="text-error">{retryError}</span>
    {/if}
    <span class="flex items-center gap-2">
      <Button
        class="btn btn-primary btn-xs h-auto min-h-0 px-2 py-1"
        onclick={retry}
        disabled={retrying || accountMismatch || !canRetryRelayPublishResults(operation.results)}>
        Retry
      </Button>
      <Button class="btn btn-ghost btn-xs h-auto min-h-0 px-2 py-1" onclick={discard}>
        Discard
      </Button>
    </span>
  </div>
{/if}
