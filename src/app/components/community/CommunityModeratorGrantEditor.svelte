<script lang="ts">
  import type {Readable} from "svelte/store"
  import Button from "@lib/components/Button.svelte"
  import ModalHeader from "@lib/components/ModalHeader.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import ProfileCircle from "@app/components/ProfileCircle.svelte"
  import ProfileLink from "@app/components/ProfileLink.svelte"

  type SectionOption = {
    name: string
    displayName: string
  }

  type Props = {
    pubkey: string
    relays?: string[]
    sections: SectionOption[]
    selectedSectionNames: string[]
    onSave: (sectionNames: string[]) => void | Promise<void>
    status?: Readable<string>
  }

  const {pubkey, relays = [], sections, selectedSectionNames, onSave, status}: Props = $props()
  const initialSelection = sections
    .map(section => section.name)
    .filter(sectionName => selectedSectionNames.includes(sectionName))

  let selected = $state<string[]>(initialSelection)
  let loading = $state(false)
  let statusText = $state("")

  const selectedSet = $derived(new Set(selected))
  const hasChanges = $derived(
    selected.length !== initialSelection.length ||
      selected.some((sectionName, index) => sectionName !== initialSelection[index]),
  )

  const toggleSection = (sectionName: string, checked: boolean) => {
    const next = new Set(selected)
    if (checked) next.add(sectionName)
    else next.delete(sectionName)

    selected = sections.map(section => section.name).filter(name => next.has(name))
  }

  const save = async (event: Event) => {
    event.preventDefault()
    if (!hasChanges) return

    loading = true

    try {
      await onSave(selected)
      history.back()
    } finally {
      loading = false
    }
  }

  const cancel = () => history.back()

  $effect(() => {
    if (!status) {
      statusText = ""
      return
    }

    return status.subscribe(value => {
      statusText = value
    })
  })
</script>

<form class="column gap-4" onsubmit={save}>
  <ModalHeader>
    {#snippet title()}
      <div>Edit moderator grants</div>
    {/snippet}
    {#snippet info()}
      <div>Select sections this moderator can manage.</div>
    {/snippet}
  </ModalHeader>

  <div class="rounded-box border border-base-300 bg-base-100 p-3">
    <div class="flex min-w-0 items-center gap-3">
      <ProfileCircle {pubkey} {relays} size={9} />
      <div class="min-w-0">
        <p class="text-xs font-medium uppercase tracking-wide opacity-60">Moderator</p>
        <strong class="block min-w-0 truncate"><ProfileLink {pubkey} {relays} /></strong>
      </div>
    </div>
  </div>

  <p class="rounded-box border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
    Removing an existing moderator grant revokes access of members that came through this person!
  </p>

  <div class="grid gap-2 sm:grid-cols-2">
    {#each sections as section (section.name)}
      <label
        class="flex cursor-pointer items-start gap-3 rounded-box border border-base-300 bg-base-200/50 p-3 hover:border-primary/60">
        <input
          type="checkbox"
          class="checkbox-primary checkbox mt-1"
          checked={selectedSet.has(section.name)}
          onchange={event => toggleSection(section.name, event.currentTarget.checked)} />
        <span class="min-w-0">
          <strong class="block">{section.displayName}</strong>
        </span>
      </label>
    {:else}
      <p class="rounded-box bg-base-200 p-4 text-center text-sm opacity-70 sm:col-span-2">
        This community has no sections to grant.
      </p>
    {/each}
  </div>

  <p class="text-sm opacity-70">Saving with no selected sections removes all moderator grants.</p>

  {#if statusText}
    <div
      class="rounded-box border border-info/30 bg-info/10 px-4 py-3 text-sm text-info"
      aria-live="polite">
      <Spinner loading={true}>{statusText}</Spinner>
    </div>
  {/if}

  <div class="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <Button class="btn btn-link inline-flex justify-center sm:justify-start" onclick={cancel}>
      Cancel
    </Button>
    <Button type="submit" class="btn btn-primary" disabled={loading || !hasChanges}>
      <Spinner {loading}>Save grants</Spinner>
    </Button>
  </div>
</form>
