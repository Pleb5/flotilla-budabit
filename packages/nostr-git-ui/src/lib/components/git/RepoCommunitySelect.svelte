<script lang="ts">
  import { ChevronDown } from "@lucide/svelte";
  import type { RepoCommunityOption } from "./repo-community-options.js";
  import { getRepoCommunityOptionLabel } from "./repo-community-options.js";

  interface Props {
    options?: RepoCommunityOption[];
    value?: string;
    label?: string;
    description?: string;
    disabled?: boolean;
  }

  let {
    options = [],
    value = $bindable(""),
    label = "Community",
    description = "Bind this repository to one community, or leave it personal.",
    disabled = false,
  }: Props = $props();
</script>

<div class="space-y-2 rounded-lg border border-border bg-card p-4">
  <div>
    <label class="text-sm font-medium text-foreground" for="repo-community-select">{label}</label>
    {#if description}
      <p class="mt-1 text-sm text-muted-foreground">{description}</p>
    {/if}
  </div>

  <div class="relative">
    <select
      id="repo-community-select"
      class="w-full appearance-none rounded-md border border-input bg-background py-2 pl-3 pr-10 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-60"
      bind:value
      {disabled}
    >
      <option value="">No community</option>
      {#each options as option (option.pubkey)}
        <option value={option.pubkey}>{getRepoCommunityOptionLabel(option)}</option>
      {/each}
    </select>
    <ChevronDown
      class="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
    />
  </div>

  {#if options.length === 0}
    <p class="text-xs text-muted-foreground">
      No writable repository communities are available for this account.
    </p>
  {/if}
</div>
