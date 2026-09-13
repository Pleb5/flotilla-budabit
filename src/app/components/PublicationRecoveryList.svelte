<script lang="ts">
  import {goto} from "$app/navigation"
  import {pubkey} from "@welshman/app"
  import Button from "@lib/components/Button.svelte"
  import ModalFooter from "@lib/components/ModalFooter.svelte"
  import ModalHeader from "@lib/components/ModalHeader.svelte"
  import RelayPublishFeedback from "./RelayPublishFeedback.svelte"
  import {canRetryRelayPublishResults} from "@app/core/relay-publish-outcomes"
  import RelayDeliveryNotice from "./RelayDeliveryNotice.svelte"
  import {relayDeliveryNotices} from "@app/core/relay-publish-delivery"
  import {
    cancelPublication,
    discardPublication,
    recoverablePublicationOperations,
    retryPublication,
  } from "@app/core/publication-operations"
  import {clearModals, closeTopModal} from "@app/util/modal"

  const operations = $derived($recoverablePublicationOperations)
  let retryingIds = $state(new Set<string>())
  let retryErrors = $state<Record<string, string>>({})

  const setRetrying = (operationId: string, retrying: boolean) => {
    const next = new Set(retryingIds)
    if (retrying) next.add(operationId)
    else next.delete(operationId)
    retryingIds = next
  }

  const retry = async (operationId: string) => {
    if (retryingIds.has(operationId)) return

    setRetrying(operationId, true)
    retryErrors = {...retryErrors, [operationId]: ""}
    try {
      await retryPublication(operationId)
    } catch (error) {
      retryErrors = {
        ...retryErrors,
        [operationId]: error instanceof Error ? error.message : "Failed to retry publication",
      }
    } finally {
      setRetrying(operationId, false)
    }
  }

  const view = (href: string) => {
    clearModals()
    void goto(href)
  }
</script>

<div class="flex w-full max-w-2xl flex-col gap-3">
  <ModalHeader>
    {#snippet title()}Publication recovery{/snippet}
    {#snippet info()}
      Pending and unconfirmed publications remain available during this app session.
    {/snippet}
  </ModalHeader>

  {#if operations.length === 0 && $relayDeliveryNotices.size === 0}
    <p class="rounded-box bg-base-200 p-4 text-center text-sm opacity-75">
      No publications currently need attention.
    </p>
  {:else}
    <div class="flex max-h-[60vh] flex-col gap-2 overflow-y-auto pr-1">
      {#each [...$relayDeliveryNotices.keys()] as eventId (eventId)}
        <article class="rounded-box border border-base-300 bg-base-200 p-3">
          <RelayDeliveryNotice {eventId} />
        </article>
      {/each}
      {#each operations as operation (operation.operationId)}
        {@const accountMismatch = $pubkey !== operation.ownerPubkey}
        {@const retrying = retryingIds.has(operation.operationId)}
        <article class="rounded-box border border-base-300 bg-base-200 p-3">
          <div class="flex min-w-0 items-start justify-between gap-3">
            <div class="min-w-0">
              <strong class="block text-sm [overflow-wrap:anywhere]">{operation.label}</strong>
              <span class="text-xs opacity-70">
                Attempt {operation.attempt} · {operation.phase === "publishing"
                  ? operation.stage === "target"
                    ? "Publishing community target"
                    : "Publishing"
                  : operation.stage === "target"
                    ? "Community target not confirmed"
                    : "Not confirmed"}
              </span>
            </div>
            <span
              class="badge badge-sm shrink-0"
              class:badge-info={operation.phase === "publishing"}
              class:badge-warning={operation.phase === "unconfirmed"}>
              {operation.phase === "publishing" ? "Active" : "Recovery"}
            </span>
          </div>

          {#if operation.phase === "unconfirmed"}
            <RelayPublishFeedback
              results={operation.results}
              error={operation.error}
              requiredRelay={operation.confirmationRelays?.length === 1
                ? operation.confirmationRelays[0]
                : undefined} />
            <p class="mt-2 text-xs opacity-75">
              Discard removes local recovery only. It cannot retract an event a relay may already
              have accepted.
            </p>
            {#if accountMismatch}
              <p class="mt-1 text-xs text-warning">
                Restore the account that created this publication to retry.
              </p>
            {:else if retryErrors[operation.operationId]}
              <p class="mt-1 text-xs text-error">{retryErrors[operation.operationId]}</p>
            {/if}
          {/if}

          <div class="mt-3 flex flex-wrap gap-2">
            {#if operation.phase === "publishing"}
              <Button
                class="btn btn-ghost btn-xs"
                onclick={() => cancelPublication(operation.operationId)}>Cancel</Button>
            {:else}
              <Button
                class="btn btn-primary btn-xs"
                disabled={retrying ||
                  accountMismatch ||
                  !canRetryRelayPublishResults(operation.results)}
                onclick={() => retry(operation.operationId)}>
                {retrying ? "Retrying..." : "Retry"}
              </Button>
              <Button
                class="btn btn-ghost btn-xs"
                onclick={() => discardPublication(operation.operationId)}>
                {operation.preview === "retain-on-failure" ? "Discard local copy" : "Discard retry"}
              </Button>
            {/if}
            {#if operation.href}
              <Button class="btn btn-ghost btn-xs" onclick={() => view(operation.href!)}
                >View</Button>
            {/if}
          </div>
        </article>
      {/each}
    </div>
  {/if}

  <ModalFooter>
    <span></span>
    <Button class="btn btn-primary" onclick={closeTopModal}>Close</Button>
  </ModalFooter>
</div>
