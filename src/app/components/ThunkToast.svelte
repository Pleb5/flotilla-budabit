<script lang="ts">
  import type {AbstractThunk} from "@welshman/app"
  import {thunkHasStatus, thunkIsComplete} from "@welshman/app"
  import {PublishStatus} from "@welshman/net"
  import ThunkPending from "@app/components/ThunkPending.svelte"
  import ThunkFailure from "@app/components/ThunkFailure.svelte"
  import RelayPublishFeedback from "@app/components/RelayPublishFeedback.svelte"
  import type {Toast} from "@app/util/toast"
  import {popToast} from "@app/util/toast"

  type Props = {
    toast: Toast
    thunk: AbstractThunk
    retryable?: boolean
  }

  const {toast, retryable = true, ...props}: Props = $props()

  const id = toast.id
  let thunk = $state(props.thunk)
  const {Aborted, Timeout, Failure} = PublishStatus
  const isAborted = $derived(thunkHasStatus(Aborted, $thunk))
  const isFailure = $derived(thunkHasStatus([Timeout, Failure], $thunk))
  const isSuccess = $derived(thunkHasStatus(PublishStatus.Success, $thunk))
  const isComplete = $derived(thunkIsComplete($thunk))

  $effect(() => {
    if (isComplete && isAborted && !isSuccess) popToast(id)
  })

  $effect(() => {
    if (!isComplete || !isSuccess || isFailure) return

    const timeout = setTimeout(() => popToast(id), 2000)
    return () => clearTimeout(timeout)
  })
</script>

{#if !isComplete}
  <ThunkPending {thunk} />
{:else if isSuccess}
  {#if isFailure}
    <RelayPublishFeedback results={$thunk.results} />
    {#if retryable}<ThunkFailure {thunk} partial onRetry={retry => (thunk = retry)} />{/if}
  {:else}
    <p class="text-xs opacity-75">Message sent!</p>
  {/if}
{:else if isFailure}
  {#if retryable}
    <ThunkFailure {thunk} onRetry={retry => (thunk = retry)} />
  {:else}
    <RelayPublishFeedback results={$thunk.results} />
  {/if}
{/if}
