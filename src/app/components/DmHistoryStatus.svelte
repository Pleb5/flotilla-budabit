<script lang="ts">
  import Spinner from "@lib/components/Spinner.svelte"
  import Button from "@lib/components/Button.svelte"
  import type {DmHistorySnapshot} from "@app/core/dm-history"

  const {
    state,
    inbox = false,
    retry,
  }: {
    state: DmHistorySnapshot
    inbox?: boolean
    retry: () => void
  } = $props()
</script>

<div class="col-2 px-4 py-3 text-xs" aria-live="polite" data-dm-history-status={state.status}>
  {#if state.errors.length}
    <p>Some {inbox ? "conversations" : "message history"} could not be loaded.</p>
    <details>
      <summary class="cursor-pointer opacity-70">Relay details</summary>
      <ul class="mt-2 break-words">
        {#each state.errors as error}<li>{error}</li>{/each}
      </ul>
    </details>
    <Button class="btn btn-outline btn-sm self-start" onclick={retry}>Retry history</Button>
  {:else if state.status === "waiting"}
    <p>Waiting for DM inbox relays or signer...</p>
  {:else if state.status === "paused"}
    <p>History recovery paused. It will resume when chat is active and online.</p>
  {:else}
    <Spinner loading={state.loading}>
      {#if state.phase === "authenticating"}
        Authenticating with messaging relay...
      {:else if state.loading}
        {state.initialComplete
          ? `Checking older ${inbox ? "conversations" : "messages"}...`
          : `Loading ${inbox ? "conversations" : "messages"}...`}
      {:else if !inbox && state.exhausted}
        <span class="opacity-70">End of message history</span>
      {/if}
    </Spinner>
  {/if}
</div>
