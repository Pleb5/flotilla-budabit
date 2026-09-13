<script lang="ts">
  import type {PublishResultsByRelay} from "@welshman/net"
  import {getRelayPublishOutcomes} from "@app/core/relay-publish-outcomes"

  const {
    results,
    error,
    expectedRelays = [],
    requiredRelay,
  }: {
    results: PublishResultsByRelay
    error?: string
    expectedRelays?: readonly string[]
    requiredRelay?: string
  } = $props()
  const outcomes = $derived(getRelayPublishOutcomes(results, expectedRelays))
  const accepted = $derived(outcomes.filter(outcome => outcome.reason === "accepted"))
  const failures = $derived(
    outcomes.filter(outcome => !["accepted", "pending"].includes(outcome.reason)),
  )
</script>

<div
  class="flex min-w-0 max-w-full flex-col gap-1 text-xs [overflow-wrap:anywhere]"
  data-relay-publish-feedback>
  {#if error && failures.length === 0}
    <p class="whitespace-pre-wrap text-error">{error}</p>
  {/if}
  {#if failures.length > 0}
    <p class="text-warning">
      {accepted.length > 0
        ? `Accepted by ${accepted.length}/${outcomes.length} relays. Other destinations did not accept it.`
        : "No acceptance confirmed by these relays."}
    </p>
  {/if}
  {#if requiredRelay && outcomes.some(outcome => outcome.relay === requiredRelay && outcome.reason !== "accepted")}
    <p class="text-warning">Acceptance by {requiredRelay} is required for this step.</p>
  {/if}
  {#each failures as outcome (outcome.relay)}
    <div class="rounded border border-base-300 p-2">
      <p class="font-semibold">{outcome.relay} — {outcome.title}</p>
      <p class="whitespace-pre-wrap">{outcome.detail || "No reason supplied by the relay."}</p>
      <p class="mt-1 opacity-80">{outcome.guidance}</p>
    </div>
  {/each}
  {#if accepted.length > 0 && failures.length > 0}
    <details>
      <summary class="cursor-pointer">Accepted destinations ({accepted.length})</summary>
      {#each accepted as outcome (outcome.relay)}
        <p>{outcome.relay}: accepted{outcome.detail ? ` — ${outcome.detail}` : ""}</p>
      {/each}
    </details>
  {/if}
</div>
