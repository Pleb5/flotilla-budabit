<script lang="ts">
  import type {TrustedEvent} from "@welshman/util"
  import {pushToast} from "@app/util/toast"
  import DeleteWithProgressConfirm from "@app/components/DeleteWithProgressConfirm.svelte"
  import {deletePullRequestWithRelated} from "@app/core/git-commands"

  type Props = {
    event: TrustedEvent
    relays?: string[]
    repoAddress?: string
  }

  const {event, relays = [], repoAddress = ""}: Props = $props()

  const noun = "pull request"
  const title = "Delete Pull Request"

  const startDelete = ({
    signal,
    onProgress,
  }: {
    signal: AbortSignal
    onProgress: (progress: any) => void
  }) =>
    deletePullRequestWithRelated({
      root: event,
      relays,
      repoAddress: repoAddress || undefined,
      signal,
      onProgress,
    })

  const onSuccess = (result: unknown) => {
    const {deletedEvents = 0} = (result || {}) as {deletedEvents?: number}

    pushToast({
      message: `Deletion requests acknowledged for ${deletedEvents} event${deletedEvents === 1 ? "" : "s"}`,
    })
  }
</script>

<DeleteWithProgressConfirm
  {startDelete}
  {onSuccess}
  {title}
  subtitle={`Are you sure you want to delete this ${noun}?`}
  message="Deletion requests will be sent for this pull request and related updates, statuses, labels, and comments you authored. Events from other authors and other related events will remain. Some relays may retain the deleted events."
  errorMessage={`Failed to delete ${noun}`}
  cancelMessage="Pull request deletion cancelled"
  confirmLabel={title} />
