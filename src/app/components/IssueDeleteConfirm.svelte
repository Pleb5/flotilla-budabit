<script lang="ts">
  import type {TrustedEvent} from "@welshman/util"
  import {pushToast} from "@app/util/toast"
  import DeleteWithProgressConfirm from "@app/components/DeleteWithProgressConfirm.svelte"
  import {deleteIssueWithLabels} from "@app/core/git-commands"

  type Props = {
    event: TrustedEvent
    relays?: string[]
    repoAddress?: string
  }

  const {event, relays = [], repoAddress = ""}: Props = $props()

  const startDelete = ({
    signal,
    onProgress,
  }: {
    signal: AbortSignal
    onProgress: (progress: any) => void
  }) =>
    deleteIssueWithLabels({
      issue: event,
      relays,
      repoAddress: repoAddress || undefined,
      signal,
      onProgress,
    })

  const onSuccess = (result: unknown) => {
    const {labelsDeleted = 0} = (result || {}) as {labelsDeleted?: number}
    const totalDeleted = 1 + labelsDeleted

    pushToast({
      message: `Deletion requests acknowledged for ${totalDeleted} event${totalDeleted === 1 ? "" : "s"}`,
    })
  }
</script>

<DeleteWithProgressConfirm
  {startDelete}
  {onSuccess}
  title="Delete Issue"
  subtitle="Are you sure you want to delete this issue?"
  message="Deletion requests will be sent for this issue and related labels you authored, including title edits. Replies, description edits, statuses, reactions, and events from other authors will remain. Some relays may retain the deleted events."
  errorMessage="Failed to delete issue"
  cancelMessage="Issue deletion cancelled"
  confirmLabel="Delete issue" />
