<script lang="ts">
  import type {TrustedEvent} from "@welshman/util"
  import {pushToast} from "@app/util/toast"
  import DeleteWithProgressConfirm from "@app/components/DeleteWithProgressConfirm.svelte"
  import {deletePatchOrPullRequestWithRelated} from "../../lib/budabit/commands"

  type Props = {
    event: TrustedEvent
    relays?: string[]
  }

  const {event, relays = []}: Props = $props()

  const isPullRequest = event.kind === 1618
  const noun = isPullRequest ? "pull request" : "patch"
  const title = isPullRequest ? "Delete Pull Request" : "Delete Patch"

  const startDelete = ({signal, onProgress}: {signal: AbortSignal; onProgress: (progress: any) => void}) =>
    deletePatchOrPullRequestWithRelated({root: event, relays, signal, onProgress})

  const onSuccess = (result: unknown) => {
    const {deletedEvents = 0} = (result || {}) as {deletedEvents?: number}

    pushToast({
      message: `Delete requests sent for ${deletedEvents} event${deletedEvents === 1 ? "" : "s"}`,
    })
  }
</script>

<DeleteWithProgressConfirm
  {startDelete}
  {onSuccess}
  {title}
  subtitle={`Are you sure you want to delete this ${noun}?`}
  message="This sends Nostr delete events for the root and your related updates, statuses, comments, and labels. Events from other authors are not deleted. The modal stays open while relay acknowledgements come back, and you can cancel while it is waiting."
  errorMessage={`Failed to delete ${noun}`}
  cancelMessage={`${isPullRequest ? "Pull request" : "Patch"} deletion cancelled`}
  confirmLabel={title} />
