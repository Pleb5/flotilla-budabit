<script lang="ts">
  import Danger from "@assets/icons/danger-triangle.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"

  type Props = {
    reason?: "event" | "person"
    compact?: boolean
    class?: string
  }

  const {reason = "event", compact = false, class: className = ""}: Props = $props()

  const title = $derived(reason === "person" ? "Moderated person" : "Moderated event")
  const detail = $derived(
    reason === "person"
      ? "This person's content was hidden by community moderation."
      : "This content was hidden by community moderation.",
  )
</script>

<div
  class={`flex w-full items-start gap-2 rounded-box border border-base-300 bg-base-200/70 text-sm text-base-content/75 ${compact ? "p-2" : "p-4"} ${className}`}
  role="status"
  aria-label={title}>
  <Icon icon={Danger} size={compact ? 4 : 5} class="mt-0.5 opacity-70" />
  <div class="min-w-0">
    <strong class="block text-base-content/80">{title}</strong>
    {#if !compact}
      <p class="mt-1 text-xs opacity-80">{detail}</p>
    {/if}
  </div>
</div>
