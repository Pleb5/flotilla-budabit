<script lang="ts">
  import Button from "@lib/components/Button.svelte"
  import ModalHeader from "@lib/components/ModalHeader.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import {preventDefault} from "@lib/html"
  import {clearModals} from "@app/util/modal"

  type Props = {
    onPublish: (setStatus: (message: string) => void) => Promise<void>
  }

  const {onPublish}: Props = $props()

  let loading = $state(false)
  let status = $state("")

  const publish = async () => {
    if (loading) return

    loading = true
    status = "Publishing without migration..."

    try {
      await onPublish(message => (status = message))
      clearModals()
    } catch (error) {
      status = error instanceof Error ? error.message : String(error)
    } finally {
      loading = false
    }
  }
</script>

<form class="column gap-4" onsubmit={preventDefault(publish)}>
  <ModalHeader>
    {#snippet title()}<div>Are you really sure?</div>{/snippet}
    {#snippet info()}<div>
        This publishes the community update without migrating permissions.
      </div>{/snippet}
  </ModalHeader>

  <div class="rounded-box border border-error/30 bg-error/10 p-4 text-sm leading-relaxed">
    <p>
      People tied to removed sections or moved publish types can lose publishing access, and pending
      requests will not be migrated.
    </p>
  </div>

  {#if status}
    <div class="rounded-box border border-base-300 bg-base-200 p-3 text-sm" aria-live="polite">
      <Spinner {loading}>{status}</Spinner>
    </div>
  {/if}

  <div class="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <Button
      class="btn btn-ghost w-full sm:w-auto"
      onclick={() => history.back()}
      disabled={loading}>
      Go back
    </Button>
    <Button class="btn btn-error w-full sm:w-auto" type="submit" disabled={loading}>
      <Spinner {loading}>Publish without migration</Spinner>
    </Button>
  </div>
</form>
