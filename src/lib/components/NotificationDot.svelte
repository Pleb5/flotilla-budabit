<style>
  /* The accent alone has too little contrast against the light theme's surfaces. */
  .outlined {
    box-shadow: 0 0 0 1px var(--base-content);
  }
</style>

<script lang="ts">
  const {
    class: className = "",
    contrast = false,
    label = "Unread updates",
  }: {class?: string; contrast?: boolean; label?: string} = $props()
</script>

<span
  data-notification-indicator
  aria-hidden="true"
  title={label}
  class="inline-block h-2 w-2 shrink-0 rounded-full {contrast
    ? 'bg-current'
    : 'bg-primary'} {className}"
  class:outlined={!contrast}></span>
