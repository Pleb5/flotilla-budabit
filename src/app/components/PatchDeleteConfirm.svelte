<script lang="ts">
  import type {TrustedEvent} from "@welshman/util"
  import Confirm from "@lib/components/Confirm.svelte"
  import {clearModals} from "@app/util/modal"
  import {pushToast} from "@app/util/toast"
  import {deletePatchOrPullRequestWithRelated} from "../../lib/budabit/commands"

  type Props = {
    event: TrustedEvent
    relays?: string[]
  }

  const {event, relays = []}: Props = $props()

  const isPullRequest = event.kind === 1618
  const noun = isPullRequest ? "pull request" : "patch"
  const title = isPullRequest ? "Delete Pull Request" : "Delete Patch"

  const confirm = async () => {
    try {
      const result = await deletePatchOrPullRequestWithRelated({root: event, relays})
      pushToast({
        message: `Delete requests sent for ${result.deletedEvents} event${result.deletedEvents === 1 ? "" : "s"}`,
      })
      clearModals()
    } catch (error) {
      pushToast({
        theme: "error",
        message: error instanceof Error ? error.message : `Failed to delete ${noun}`,
      })
    }
  }
</script>

<Confirm
  {confirm}
  {title}
  subtitle={`Are you sure you want to delete this ${noun}?`}
  message="This sends Nostr delete events for the root and your related updates/status/comments/labels. Events from other authors are not deleted. Not all relays honor deletion requests." />
