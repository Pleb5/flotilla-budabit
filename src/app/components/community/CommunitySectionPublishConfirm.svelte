<script lang="ts">
  import Button from "@lib/components/Button.svelte"
  import ModalHeader from "@lib/components/ModalHeader.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import {preventDefault} from "@lib/html"
  import {pushModal} from "@app/util/modal"
  import CommunitySectionPublishWithoutMigrationConfirm from "@app/components/community/CommunitySectionPublishWithoutMigrationConfirm.svelte"

  type SummarySection = {
    title: string
    items: string[]
    tone?: "warning" | "info" | "success"
  }

  type Props = {
    sections: SummarySection[]
    onPublishAndMigrate: (setStatus: (message: string) => void) => Promise<void>
    onPublishWithoutMigration: (setStatus: (message: string) => void) => Promise<void>
  }

  const {sections, onPublishAndMigrate, onPublishWithoutMigration}: Props = $props()

  let loading = $state(false)
  let status = $state("")

  const sectionClass = (tone: SummarySection["tone"] = "info") => {
    if (tone === "warning") return "border-warning/30 bg-warning/10 text-base-content"
    if (tone === "success") return "border-success/30 bg-success/10 text-base-content"

    return "border-info/25 bg-info/10 text-base-content"
  }

  const publishAndMigrate = async () => {
    if (loading) return

    loading = true
    status = "Preparing update..."

    try {
      const setStatus = (message: string) => (status = message)

      await onPublishAndMigrate(setStatus)

      history.back()
    } catch (error) {
      status = error instanceof Error ? error.message : String(error)
    } finally {
      loading = false
    }
  }

  const confirmPublishWithoutMigration = () => {
    if (loading) return

    pushModal(CommunitySectionPublishWithoutMigrationConfirm, {
      onPublish: onPublishWithoutMigration,
    })
  }
</script>

<form
  class="column max-h-[80vh] gap-4 overflow-y-auto overflow-x-hidden"
  onsubmit={preventDefault(publishAndMigrate)}>
  <ModalHeader>
    {#snippet title()}<div>Publish community changes?</div>{/snippet}
    {#snippet info()}<div>Review the permission impact before publishing.</div>{/snippet}
  </ModalHeader>

  <div class="space-y-3">
    {#each sections as section}
      {#if section.items.length > 0}
        <section
          class={`rounded-box border p-4 text-sm leading-relaxed ${sectionClass(section.tone)}`}>
          <strong class="block text-base">{section.title}</strong>
          <ul class="mt-2 list-disc space-y-1 pl-5">
            {#each section.items as item}
              <li>{item}</li>
            {/each}
          </ul>
        </section>
      {/if}
    {/each}
  </div>

  {#if status}
    <div class="rounded-box border border-base-300 bg-base-200 p-3 text-sm" aria-live="polite">
      <Spinner loading={Boolean(loading)}>{status}</Spinner>
    </div>
  {/if}

  <div class="mt-4 flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center">
    <Button
      class="btn btn-success min-h-fit w-full whitespace-normal text-center lg:w-auto"
      type="submit"
      disabled={loading}>
      <Spinner {loading}>Publish and migrate permissions</Spinner>
    </Button>
    <Button
      class="btn btn-ghost w-full text-center lg:w-auto"
      onclick={() => history.back()}
      disabled={loading}>
      Cancel
    </Button>
    <div
      class="mt-3 border-t border-base-300 pt-4 lg:ml-auto lg:mt-0 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
      <Button
        class="btn btn-outline btn-error btn-sm min-h-fit w-full whitespace-normal text-center lg:w-auto"
        onclick={confirmPublishWithoutMigration}
        disabled={loading}>
        Publish without migration
      </Button>
    </div>
  </div>
</form>
