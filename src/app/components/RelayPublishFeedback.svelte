<script lang="ts">
  import type {PublishResultsByRelay} from "@welshman/net"
  import {
    getRelayPublishOutcomes,
    summarizeRelayPublishResults,
  } from "@app/core/relay-publish-outcomes"

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
    outcomes.filter(outcome => !["accepted", "pending", "skipped"].includes(outcome.reason)),
  )
  const skipped = $derived(outcomes.filter(outcome => outcome.reason === "skipped"))
  const unaccepted = $derived(
    outcomes.filter(outcome => !["accepted", "pending"].includes(outcome.reason)),
  )
</script>

<div
  class="flex min-w-0 max-w-full flex-col gap-1 text-xs [overflow-wrap:anywhere]"
  data-relay-publish-feedback>
  {#if error && unaccepted.length === 0}
    <p class="whitespace-pre-wrap text-error">{error}</p>
  {/if}
  {#if unaccepted.length > 0}
    <p class:text-warning={failures.length > 0 || accepted.length === 0}>
      {summarizeRelayPublishResults(results, expectedRelays)}
      {#if failures.length > 0 && accepted.length > 0}Other destinations did not accept it.{/if}
    </p>
  {/if}
  {#if requiredRelay && outcomes.some(outcome => outcome.relay === requiredRelay && outcome.reason !== "accepted")}
    <p class="text-warning">Acceptance by {requiredRelay} is required for this step.</p>
  {/if}
  {#each unaccepted as outcome (outcome.relay)}
    <div class="rounded border border-base-300 p-2">
      <p class="font-semibold">{outcome.relay} — {outcome.title}</p>
      <p class="whitespace-pre-wrap">{outcome.detail || "No reason supplied by the relay."}</p>
      <p class="mt-1 opacity-80">{outcome.guidance}</p>
    </div>
  {/each}
  {#if accepted.length > 0 && (failures.length > 0 || skipped.length > 0)}
    <details>
      <summary class="cursor-pointer">Accepted destinations ({accepted.length})</summary>
      {#each accepted as outcome (outcome.relay)}
        <p>{outcome.relay}: accepted{outcome.detail ? ` — ${outcome.detail}` : ""}</p>
      {/each}
    </details>
  {/if}
</div>
