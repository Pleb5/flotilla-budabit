<script lang="ts">
  import {Check, X, LoaderCircle, CircleHelp} from "@lucide/svelte"
  import type {IdentityVerification} from "@app/util/profile-identity"
  const {
    result,
    loading = false,
    showTitle = true,
  }: {result?: IdentityVerification; loading?: boolean; showTitle?: boolean} = $props()
</script>

{#if loading}
  <span
    class="inline-flex shrink-0"
    role="status"
    aria-label="Checking identity"
    title={showTitle ? "Checking identity" : undefined}>
    <LoaderCircle class="h-4 w-4 animate-spin opacity-60" />
  </span>
{:else if result}
  <span
    class="inline-flex shrink-0"
    role="img"
    aria-label={result?.message}
    title={showTitle ? result?.message : undefined}>
    {#if result?.status === "valid"}
      <Check class="h-4 w-4 text-success" />
    {:else if result?.status === "invalid"}
      <X class="h-4 w-4 text-error" />
    {:else}
      <CircleHelp class="h-4 w-4 text-warning" />
    {/if}
  </span>
{/if}
