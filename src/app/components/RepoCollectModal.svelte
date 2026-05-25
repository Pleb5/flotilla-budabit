<script lang="ts">
  import Button from "@lib/components/Button.svelte"
  import type {RepoCommunityOption} from "@nostr-git/ui"

  type CollectSelection = {
    personal: boolean
    communityPubkeys: string[]
  }

  const {
    title = "Collect repository",
    description = "Choose where this repository should be starred or curated.",
    personalLabel = "Personal",
    submitLabel = "Collect",
    submittingLabel = "Collecting...",
    defaultPersonal = true,
    communityOptions = [],
    defaultCommunityPubkey = "",
    onCollect,
    onCancel,
  }: {
    title?: string
    description?: string
    personalLabel?: string
    submitLabel?: string
    submittingLabel?: string
    defaultPersonal?: boolean
    communityOptions?: RepoCommunityOption[]
    defaultCommunityPubkey?: string
    onCollect: (selection: CollectSelection) => Promise<void> | void
    onCancel?: () => void
  } = $props()

  let personal = $state(defaultPersonal)
  let selectedCommunities = $state<string[]>(
    defaultCommunityPubkey && communityOptions.some(option => option.pubkey === defaultCommunityPubkey)
      ? [defaultCommunityPubkey]
      : [],
  )
  let submitting = $state(false)

  const canSubmit = $derived(personal || selectedCommunities.length > 0)

  const toggleCommunity = (pubkey: string, checked: boolean) => {
    selectedCommunities = checked
      ? Array.from(new Set([...selectedCommunities, pubkey]))
      : selectedCommunities.filter(value => value !== pubkey)
  }

  const collect = async () => {
    if (!canSubmit || submitting) return
    submitting = true
    try {
      await onCollect({personal, communityPubkeys: selectedCommunities})
    } finally {
      submitting = false
    }
  }
</script>

<div class="flex max-w-lg flex-col gap-4 p-5">
  <div>
    <h2 class="text-lg font-semibold">{title}</h2>
    <p class="mt-1 text-sm text-muted-foreground">
      {description}
    </p>
  </div>

  <div class="space-y-3">
    <label class="flex items-center gap-3 rounded-md border border-border p-3">
      <input type="checkbox" bind:checked={personal} />
      <span class="font-medium">{personalLabel}</span>
    </label>

    {#each communityOptions as option (option.pubkey)}
      <label class="flex items-center gap-3 rounded-md border border-border p-3">
        <input
          type="checkbox"
          checked={selectedCommunities.includes(option.pubkey)}
          onchange={event => toggleCommunity(option.pubkey, event.currentTarget.checked)} />
        <span class="min-w-0 flex-1 truncate">{option.label || option.pubkey}</span>
      </label>
    {/each}
  </div>

  {#if !canSubmit}
    <p class="text-sm text-error">Select at least one destination.</p>
  {/if}

  <div class="flex justify-end gap-2">
    <Button class="btn btn-ghost" onclick={onCancel} disabled={submitting}>Cancel</Button>
    <Button class="btn btn-primary" onclick={collect} disabled={!canSubmit || submitting}>
      {submitting ? submittingLabel : submitLabel}
    </Button>
  </div>
</div>
