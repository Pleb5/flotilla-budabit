<script lang="ts">
  import {onDestroy} from "svelte"
  import {preventDefault} from "@lib/html"
  import type {DeleteProgress} from "@lib/budabit/commands"
  import {clearModals} from "@app/util/modal"
  import {pushToast} from "@app/util/toast"
  import ModalHeader from "@lib/components/ModalHeader.svelte"
  import ModalFooter from "@lib/components/ModalFooter.svelte"
  import Button from "@lib/components/Button.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import AltArrowLeft from "@assets/icons/alt-arrow-left.svg?dataurl"
  import AltArrowRight from "@assets/icons/alt-arrow-right.svg?dataurl"

  type DeleteRunner = (params: {
    signal: AbortSignal
    onProgress: (progress: DeleteProgress) => void
  }) => Promise<unknown>

  type Props = {
    title: string
    subtitle?: string
    message: string
    errorMessage: string
    cancelMessage: string
    confirmLabel?: string
    startDelete: DeleteRunner
    onSuccess?: (result: unknown) => void
  }

  const {
    title,
    subtitle = "",
    message,
    errorMessage,
    cancelMessage,
    confirmLabel = "Confirm",
    startDelete,
    onSuccess,
  }: Props = $props()

  let isDeleting = $state(false)
  let isCancelling = $state(false)
  let progress = $state<DeleteProgress | null>(null)
  let controller: AbortController | null = null

  const isAbortError = (error: unknown) => error instanceof Error && error.name === "AbortError"

  const back = () => history.back()

  const cancelDelete = () => {
    if (!isDeleting) {
      back()
      return
    }

    if (isCancelling) return

    isCancelling = true
    progress = progress
      ? {...progress, label: "Cancelling delete request..."}
      : {label: "Cancelling delete request...", completed: 0, total: 1}
    controller?.abort()
  }

  const confirmDelete = async () => {
    if (isDeleting) return

    controller = new AbortController()
    isDeleting = true
    isCancelling = false
    progress = {label: "Preparing delete request...", completed: 0, total: 1}

    try {
      const result = await startDelete({
        signal: controller.signal,
        onProgress: nextProgress => {
          progress = nextProgress
        },
      })

      controller = null
      onSuccess?.(result)
      clearModals()
    } catch (error) {
      const cancelled = isAbortError(error) || controller?.signal.aborted

      if (cancelled) {
        if (isCancelling) {
          pushToast({message: cancelMessage})
          clearModals()
        }
      } else {
        pushToast({
          theme: "error",
          message: error instanceof Error ? error.message : errorMessage,
        })
      }
    } finally {
      controller = null
      isDeleting = false
      isCancelling = false
      progress = null
    }
  }

  onDestroy(() => {
    if (isDeleting) {
      controller?.abort()
    }
  })
</script>

<form class="column gap-4" onsubmit={preventDefault(confirmDelete)}>
  <ModalHeader>
    {#snippet title()}
      <div>{title}</div>
    {/snippet}
    {#snippet info()}
      <div>{subtitle}</div>
    {/snippet}
  </ModalHeader>

  <div class="space-y-3 text-center">
    <p>{message}</p>

    {#if progress}
      <div class="space-y-2 rounded border border-base-300 px-4 py-3 text-left">
        <div class="text-sm font-medium">{progress.label}</div>
        {#if progress.current}
          <div class="text-xs opacity-70">Current step: {progress.current}</div>
        {/if}
        <progress
          class="progress progress-primary w-full"
          value={(progress.completed / Math.max(progress.total, 1)) * 100}
          max="100"
        ></progress>
        <div class="text-xs opacity-70">{progress.completed} of {progress.total} completed</div>
      </div>
    {/if}
  </div>

  <ModalFooter>
    <Button class="btn btn-link" onclick={cancelDelete}>
      <Icon icon={AltArrowLeft} />
      {isDeleting ? (isCancelling ? "Cancelling..." : "Cancel delete") : "Go back"}
    </Button>
    <Button type="submit" class="btn btn-primary" disabled={isDeleting}>
      <Spinner loading={isDeleting}>{confirmLabel}</Spinner>
      <Icon icon={AltArrowRight} />
    </Button>
  </ModalFooter>
</form>
