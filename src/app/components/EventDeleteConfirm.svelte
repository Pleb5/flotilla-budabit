<script lang="ts">
  import type {TrustedEvent} from "@welshman/util"
  import {abortThunk} from "@welshman/app"
  import DeleteWithProgressConfirm from "@app/components/DeleteWithProgressConfirm.svelte"
  import {publishSocialDelete} from "@app/core/commands"
  import {pushToast} from "@app/util/toast"
  import type {DeleteProgress} from "@app/core/git-commands"

  type Props = {
    url?: string
    relays?: string[]
    event: TrustedEvent
    noun?: string
  }

  const {url, relays = [], event, noun = "Message"}: Props = $props()

  const waitForDeletePublish = async (
    thunk: {complete?: Promise<unknown>} | undefined,
    signal: AbortSignal,
  ) => {
    const completion = thunk?.complete
    if (!completion) return

    await new Promise((resolve, reject) => {
      const abort = () => {
        abortThunk(thunk as any)
        reject(new DOMException("Delete operation cancelled", "AbortError"))
      }

      signal.addEventListener("abort", abort, {once: true})
      completion.then(resolve, reject).finally(() => {
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

    const thunk = publishSocialDelete({url, relays, event})
    await waitForDeletePublish(thunk, signal)

    return thunk
  }

  const lowerNoun = noun.toLowerCase()

  const onSuccess = () => {
    pushToast({message: `${noun} delete request sent`})
  }
</script>

<DeleteWithProgressConfirm
  {startDelete}
  {onSuccess}
  title={`Delete ${noun}`}
  subtitle={`Are you sure you want to delete this ${lowerNoun}?`}
  message="Not all relays may honor this request."
  errorMessage={`Failed to delete this ${lowerNoun}`}
  cancelMessage={`${noun} deletion cancelled`}
  confirmLabel={`Delete ${noun}`} />
