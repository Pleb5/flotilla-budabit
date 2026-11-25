<script lang="ts">
  type Props = {
    readyBuildId?: string
    recoveryMessage?: string
    busy?: boolean
    activationDelayed?: boolean
    // Auto update mode: status while this document is held for an activation.
    holdMessage?: string
    holdSlow?: boolean
    // Auto update mode: Retry/Reset can force other open windows to reload, so the only action
    // offered is reloading this tab.
    tabReloadOnly?: boolean
    onReload: () => void
    onRetry: () => void
    onReset: () => void
    onReloadTab?: () => void
  }

  const {
    readyBuildId = "",
    recoveryMessage = "",
    busy = false,
    activationDelayed = false,
    holdMessage = "",
    holdSlow = false,
    tabReloadOnly = false,
    onReload,
    onRetry,
    onReset,
    onReloadTab,
  }: Props = $props()

  const warning = $derived(Boolean(recoveryMessage || (holdMessage && holdSlow)))
</script>

{#if holdMessage || readyBuildId || recoveryMessage}
  <div class="top-sai fixed inset-x-3 z-toast flex justify-center" aria-live="polite">
    <section
      class="alert mt-3 flex w-full max-w-xl flex-col items-stretch justify-between gap-3 shadow-xl sm:flex-row sm:items-center"
      class:bg-base-100={!warning}
      class:text-base-content={!warning}
      class:bg-warning={warning}
      class:text-warning-content={warning}
      class:alert-warning={warning}
      role="alert">
      <p class="min-w-0 text-sm">
        {holdMessage ||
          recoveryMessage ||
          (activationDelayed ? "App update is still activating" : "App update ready")}
      </p>
      <div class="flex shrink-0 justify-end gap-2">
        {#if tabReloadOnly}
          {#if onReloadTab && (holdMessage ? holdSlow : Boolean(recoveryMessage))}
            <button type="button" class="btn btn-sm" onclick={onReloadTab}>Reload this tab</button>
          {/if}
        {:else if recoveryMessage}
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
