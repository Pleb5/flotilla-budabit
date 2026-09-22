<script lang="ts">
  import {pubkey} from "@welshman/app"
  import Button from "@lib/components/Button.svelte"
  import RelayPublishFeedback from "./RelayPublishFeedback.svelte"
  import {
    dismissRelayDelivery,
    relayDeliveryNotices,
    retryRelayDelivery,
  } from "@app/core/relay-publish-delivery"
  import {getRelayPublishOutcomes} from "@app/core/relay-publish-outcomes"

  const {eventId}: {eventId: string} = $props()
  const notice = $derived($relayDeliveryNotices.get(eventId))
  const outcomes = $derived(getRelayPublishOutcomes(notice?.results || {}))
  const retryable = $derived(outcomes.some(outcome => outcome.retry !== "none"))
  const pending = $derived(outcomes.some(outcome => outcome.reason === "pending"))
  const onlySkipped = $derived(
    outcomes.every(outcome => ["accepted", "skipped"].includes(outcome.reason)),
  )
  const accountMismatch = $derived($pubkey !== notice?.ownerPubkey)
  let retryError = $state("")
  const retry = async () => {
    retryError = ""
    try {
      await retryRelayDelivery(eventId, () => $pubkey)
    } catch (error) {
      retryError = error instanceof Error ? error.message : String(error)
    }
  }
</script>

{#if notice}
  <div class="flex min-w-0 max-w-full flex-col gap-2" aria-live="polite">
    <strong class="text-sm [overflow-wrap:anywhere]">{notice.label} — relay delivery</strong>
    <RelayPublishFeedback results={notice.results} requiredRelay={notice.requiredRelay} />
    {#if accountMismatch && retryable && notice.canRetry}<p class="text-xs text-warning">
        Restore the publishing account to retry.
      </p>{/if}
    {#if retryError || notice.error}<p class="text-xs text-error">
        {retryError || notice.error}
      </p>{/if}
    {#if retryable && notice.canRetry}<p class="text-xs opacity-75">
        Retry resends the same signed event only to unsuccessful, retryable destinations. It does
        not resume a multi-step operation; refresh to verify the updated state. Dismiss does not
        retract accepted copies.
      </p>{:else}<p class="text-xs opacity-75">
        Dismiss removes this local report, not any copies already accepted by relays.
      </p>{/if}
    <div class="flex flex-wrap gap-2">
      {#if notice.canRetry && retryable}
        <Button
          class="btn btn-primary btn-xs"
          onclick={retry}
          disabled={notice.retrying || pending || accountMismatch}>
          {notice.retrying
            ? "Retrying..."
            : onlySkipped
              ? "Retry skipped relays"
              : "Retry failed relays"}
        </Button>
      {/if}
      <Button
        class="btn btn-ghost btn-xs"
        onclick={() => dismissRelayDelivery(eventId)}
        disabled={notice.retrying}>Dismiss delivery report</Button>
    </div>
  </div>
{/if}
