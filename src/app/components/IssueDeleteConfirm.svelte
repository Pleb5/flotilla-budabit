<script lang="ts">
  import type {TrustedEvent} from "@welshman/util"
  import Confirm from "@lib/components/Confirm.svelte"
  import {clearModals} from "@app/util/modal"
  import {pushToast} from "@app/util/toast"
  import {deleteIssueWithLabels} from "@lib/budabit/commands"

  type Props = {
    event: TrustedEvent
    relays?: string[]
  }

  const {event, relays = []}: Props = $props()

  const confirm = async () => {
    try {
      await deleteIssueWithLabels({issue: event, relays})
      clearModals()
    } catch (error) {
      pushToast({
        theme: "error",
        message: error instanceof Error ? error.message : "Failed to delete issue",
      })
    }
  }
</script>

<Confirm
  {confirm}
  title="Delete Issue"
  subtitle="Are you sure you want to delete this issue?"
  message="This will delete the issue root and remove your labels. Replies, edits, and other related events will remain. Not all relays honor deletion requests." />
