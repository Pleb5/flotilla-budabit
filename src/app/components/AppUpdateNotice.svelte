<script lang="ts">
  type Props = {
    readyBuildId?: string
    recoveryMessage?: string
    busy?: boolean
    activationDelayed?: boolean
    onReload: () => void
    onRetry: () => void
    onReset: () => void
  }

  const {
    readyBuildId = "",
    recoveryMessage = "",
    busy = false,
    activationDelayed = false,
    onReload,
    onRetry,
    onReset,
  }: Props = $props()
</script>

{#if readyBuildId || recoveryMessage}
  <div class="top-sai fixed inset-x-3 z-toast flex justify-center" aria-live="polite">
    <section
      class="alert mt-3 flex w-full max-w-xl flex-col items-stretch justify-between gap-3 shadow-xl sm:flex-row sm:items-center"
      class:bg-base-100={!recoveryMessage}
      class:text-base-content={!recoveryMessage}
      class:bg-warning={Boolean(recoveryMessage)}
      class:text-warning-content={Boolean(recoveryMessage)}
      class:alert-warning={Boolean(recoveryMessage)}
      role="alert">
      <p class="min-w-0 text-sm">
        {recoveryMessage ||
          (activationDelayed ? "App update is still activating" : "App update ready")}
      </p>
      <div class="flex shrink-0 justify-end gap-2">
        {#if recoveryMessage}
          <button type="button" class="btn btn-sm" disabled={busy} onclick={onRetry}>Retry</button>
          <button type="button" class="btn btn-ghost btn-sm" disabled={busy} onclick={onReset}>
            Reset cache
          </button>
        {:else if activationDelayed}
          <button type="button" class="btn btn-primary btn-sm" disabled={busy} onclick={onRetry}>
            Retry
          </button>
        {:else}
          <button type="button" class="btn btn-primary btn-sm" disabled={busy} onclick={onReload}>
            {busy ? "Activating..." : "Reload"}
          </button>
        {/if}
      </div>
    </section>
  </div>
{/if}
