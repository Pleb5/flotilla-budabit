<script lang="ts">
  import {stopPropagation} from "svelte/legacy"
  import {noop} from "@welshman/lib"
  import type {AbstractThunk} from "@welshman/app"
  import {
    retryThunk,
    thunkIsComplete,
    getFailedThunkUrls,
    getThunkUrlsWithStatus,
  } from "@welshman/app"
  import {PublishStatus} from "@welshman/net"
  import Danger from "@assets/icons/danger-triangle.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Tippy from "@lib/components/Tippy.svelte"
  import ThunkToast from "@app/components/ThunkToast.svelte"
  import ThunkStatusDetail from "@app/components/ThunkStatusDetail.svelte"
  import {pushToast} from "@app/util/toast"

  interface Props {
    thunk: AbstractThunk
    partial?: boolean
    showToastOnRetry?: boolean
    class?: string
  }

  let {thunk, partial = false, showToastOnRetry, ...restProps}: Props = $props()

  const retry = () => {
    thunk = retryThunk(thunk)

    if (showToastOnRetry) {
      pushToast({
        timeout: 30_000,
        children: {
          component: ThunkToast,
          props: {thunk},
        },
      })
    }
  }

  const failedUrls = $derived(getFailedThunkUrls($thunk))
  const successUrls = $derived(getThunkUrlsWithStatus(PublishStatus.Success, $thunk))
  const relayCount = $derived(Object.keys($thunk.results).length)
  const showFailure = $derived(thunkIsComplete($thunk) && failedUrls.length > 0)
  const label = $derived(
    partial ? `Sent to ${successUrls.length}/${relayCount} relays` : "Failed to send!",
  )
</script>

{#if showFailure}
  {@const url = failedUrls[0]}
  {@const {status, detail: message} = $thunk.results[url]}
  <button
    type="button"
    class="flex w-full justify-end px-1 text-xs {restProps.class}"
    onclick={stopPropagation(noop)}>
    <Tippy
      class="flex items-center"
      component={ThunkStatusDetail}
      props={{url, message, status, retry, partial, successCount: successUrls.length, relayCount}}
      params={{interactive: true}}>
      {#snippet children()}
        {#if partial}
          <span
            class="inline-flex h-4 w-4 cursor-pointer items-center justify-center rounded-full border border-muted-foreground/40 text-[10px] font-semibold leading-none text-muted-foreground"
            aria-label={label}
            title={label}>
            i
          </span>
        {:else}
          <span class="flex cursor-pointer items-center gap-1 text-error">
            <Icon icon={Danger} size={3} />
            <span>{label}</span>
          </span>
        {/if}
      {/snippet}
    </Tippy>
  </button>
{/if}
