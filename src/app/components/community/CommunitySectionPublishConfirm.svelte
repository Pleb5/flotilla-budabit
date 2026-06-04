<script lang="ts">
  import Button from "@lib/components/Button.svelte"
  import ModalFooter from "@lib/components/ModalFooter.svelte"
  import ModalHeader from "@lib/components/ModalHeader.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import {preventDefault} from "@lib/html"

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

  let loading = $state<"migrate" | "plain" | "">("")
  let status = $state("")

  const sectionClass = (tone: SummarySection["tone"] = "info") => {
    if (tone === "warning") return "border-warning/30 bg-warning/10 text-base-content"
    if (tone === "success") return "border-success/30 bg-success/10 text-base-content"

    return "border-info/25 bg-info/10 text-base-content"
  }

  const run = async (mode: "migrate" | "plain") => {
    if (loading) return

    loading = mode
    status = "Preparing update..."

    try {
      const setStatus = (message: string) => (status = message)

      if (mode === "migrate") await onPublishAndMigrate(setStatus)
      else await onPublishWithoutMigration(setStatus)

      history.back()
    } catch (error) {
      status = error instanceof Error ? error.message : String(error)
    } finally {
      loading = ""
    }
  }
</script>

<form class="column max-h-[80vh] gap-4 overflow-y-auto" onsubmit={preventDefault(() => run("migrate"))}>
  <ModalHeader>
    {#snippet title()}<div>Publish community changes?</div>{/snippet}
    {#snippet info()}<div>Review the permission impact before publishing.</div>{/snippet}
  </ModalHeader>

  <div class="space-y-3">
    {#each sections as section}
      {#if section.items.length > 0}
        <section class={`rounded-box border p-4 text-sm leading-relaxed ${sectionClass(section.tone)}`}>
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

  <ModalFooter>
    <Button class="btn btn-ghost" onclick={() => history.back()} disabled={Boolean(loading)}>
      Cancel
    </Button>
    <Button class="btn btn-outline" onclick={() => run("plain")} disabled={Boolean(loading)}>
      <Spinner loading={loading === "plain"}>Publish without migration</Spinner>
    </Button>
    <Button class="btn btn-success" type="submit" disabled={Boolean(loading)}>
      <Spinner loading={loading === "migrate"}>Publish and migrate permissions</Spinner>
    </Button>
  </ModalFooter>
</form>
