<script lang="ts">
  import type {TrustedEvent} from "@welshman/util"
  import {abortThunk, repository, retryThunk, waitForAnyRelayAck} from "@welshman/app"
  import DeleteWithProgressConfirm from "@app/components/DeleteWithProgressConfirm.svelte"
  import {publishSocialDelete} from "@app/core/commands"
  import {pushToast} from "@app/util/toast"
  import type {DeleteProgress} from "@app/core/git-commands"

  type Props = {
    url?: string
    relays?: string[]
    event: TrustedEvent
    noun?: string
    repoAddress?: string
  }

  const {url, relays = undefined, event, noun = "Message", repoAddress = ""}: Props = $props()

  type DeleteThunk = ReturnType<typeof publishSocialDelete>

  const failedDeleteThunks = new Map<string, DeleteThunk>()

  const waitForDeleteAck = (thunk: DeleteThunk, signal: AbortSignal) => {
    const acknowledgement = waitForAnyRelayAck(thunk, thunk.options.relays)

    return new Promise<void>((resolve, reject) => {
      const abort = () => {
        abortThunk(thunk)
        reject(new DOMException("Delete operation cancelled", "AbortError"))
      }

      signal.addEventListener("abort", abort, {once: true})
      acknowledgement
        .then(() => resolve(), reject)
        .finally(() => {
          signal.removeEventListener("abort", abort)
        })
    })
  }

  const startDelete = async ({
    signal,
    onProgress,
  }: {
    signal: AbortSignal
    onProgress: (progress: DeleteProgress) => void
  }) => {
    if (signal.aborted) {
      throw new DOMException("Delete operation cancelled", "AbortError")
    }

    onProgress({
      label: "Waiting for relay acknowledgements...",
      completed: 0,
      total: 1,
      current: noun.toLowerCase(),
    })

    const deleteKey = JSON.stringify({eventId: event.id, url, relays, repoAddress})
    let thunk = failedDeleteThunks.get(deleteKey)

    if (thunk) {
      thunk = retryThunk(thunk) as DeleteThunk
    } else {
      thunk = publishSocialDelete({
        url,
        ...(relays !== undefined ? {relays} : {}),
        event,
        repoAddress: repoAddress || undefined,
        optimistic: false,
      })
    }

    try {
      await waitForDeleteAck(thunk, signal)
    } catch (error) {
      if (!signal.aborted) failedDeleteThunks.set(deleteKey, thunk)
      throw error
    }

    failedDeleteThunks.clear()
    repository.publish(thunk.event as TrustedEvent)

    return thunk
  }

  const lowerNoun = noun.toLowerCase()

  const onSuccess = () => {
    pushToast({message: `${noun} deletion request acknowledged by a relay`})
  }
</script>

<DeleteWithProgressConfirm
  {startDelete}
  {onSuccess}
  title={`Delete ${noun}`}
  subtitle={`Are you sure you want to delete this ${lowerNoun}?`}
  message={`A deletion request will be sent for this ${lowerNoun}. Replies, reactions, and other related events will remain. Some relays may retain it.`}
  errorMessage={`Failed to delete this ${lowerNoun}`}
  cancelMessage={`${noun} deletion cancelled`}
  confirmLabel={`Delete ${noun}`} />
