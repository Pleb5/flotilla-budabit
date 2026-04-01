<script lang="ts">
  import type {TrustedEvent} from "@welshman/util"
  import {pushToast} from "@app/util/toast"
  import DeleteWithProgressConfirm from "@app/components/DeleteWithProgressConfirm.svelte"
  import {deleteIssueWithLabels} from "@lib/budabit/commands"

  type Props = {
    event: TrustedEvent
    relays?: string[]
  }

  const {event, relays = []}: Props = $props()

  const startDelete = ({signal, onProgress}: {signal: AbortSignal; onProgress: (progress: any) => void}) =>
    deleteIssueWithLabels({issue: event, relays, signal, onProgress})

  const onSuccess = (result: unknown) => {
    const {labelsDeleted = 0} = (result || {}) as {labelsDeleted?: number}
    const totalDeleted = 1 + labelsDeleted

    pushToast({
      message: `Delete requests sent for ${totalDeleted} event${totalDeleted === 1 ? "" : "s"}`,
    })
  }
</script>

<DeleteWithProgressConfirm
  {startDelete}
  {onSuccess}
  title="Delete Issue"
  subtitle="Are you sure you want to delete this issue?"
  message="This will delete the issue root and remove your author labels. Replies, edits, and other related events will remain. The modal stays open while relay acknowledgements come back, and you can cancel while it is waiting."
  errorMessage="Failed to delete issue"
  cancelMessage="Issue deletion cancelled"
  confirmLabel="Delete issue" />
