<script lang="ts">
  import {getBlossomUploadStageMessage, type BlossomUploadStage} from "@app/core/blossom"

  type Props = {
    stage?: BlossomUploadStage
  }

  let {stage = "idle"}: Props = $props()

  const message = $derived(getBlossomUploadStageMessage(stage))
  const active = $derived(stage !== "idle")
  const spinning = $derived(!["idle", "ready", "failed"].includes(stage))
  const themeClass = $derived(
    stage === "failed"
      ? "border-error/30 bg-error/10 text-error"
      : stage === "ready"
        ? "border-success/30 bg-success/10 text-success"
        : "border-primary/30 bg-primary/10 text-primary",
  )
</script>

{#if active}
  <div
    class={`flex items-center gap-2 rounded-box border px-3 py-2 text-xs ${themeClass}`}
    title="Budabit creates one canonical Blossom URL first. Media may be optimized when safe; mirroring runs separately and does not block publishing.">
    {#if spinning}
      <span class="loading loading-spinner loading-xs"></span>
    {/if}
    <span>{message}</span>
  </div>
{/if}
