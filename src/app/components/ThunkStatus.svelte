<script lang="ts">
  import type {AbstractThunk} from "@welshman/app"
  import {thunkIsComplete, getFailedThunkUrls, getThunkUrlsWithStatus} from "@welshman/app"
  import {PublishStatus} from "@welshman/net"
  import ThunkFailure from "@app/components/ThunkFailure.svelte"
  import ThunkPending from "@app/components/ThunkPending.svelte"

  interface Props {
    thunk: AbstractThunk
    class?: string
  }

  const {thunk, ...restProps}: Props = $props()

  const isComplete = $derived(thunkIsComplete($thunk))
  const successUrls = $derived(getThunkUrlsWithStatus(PublishStatus.Success, $thunk))
  const failedUrls = $derived(getFailedThunkUrls($thunk))
  const showFailure = $derived(isComplete && successUrls.length === 0 && failedUrls.length > 0)
  const showPartialFailure = $derived(isComplete && successUrls.length > 0 && failedUrls.length > 0)
  const showPending = $derived(!isComplete && successUrls.length === 0)
</script>

{#if showFailure}
  <ThunkFailure class={restProps.class} {thunk} />
{:else if showPartialFailure}
  <ThunkFailure class={restProps.class} {thunk} partial />
{:else if showPending}
  <ThunkPending class={restProps.class} {thunk} />
{/if}
