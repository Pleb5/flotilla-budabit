<script lang="ts">
  import {stopPropagation} from "svelte/legacy"
  import {noop} from "@welshman/lib"
  import {MergedThunk, publishThunk, isMergedThunk, thunkIsComplete} from "@welshman/app"
  import {PublishStatus} from "@welshman/net"
  import type {Thunk} from "@welshman/app"
  import Icon from "@lib/components/Icon.svelte"
  import Tippy from "@lib/components/Tippy.svelte"
  import ThunkToast from "@app/components/ThunkToast.svelte"
  import ThunkStatusDetail from "@app/components/ThunkStatusDetail.svelte"
  import {pushToast} from "@app/util/toast"

  interface Props {
    thunk: Thunk | MergedThunk
    showToastOnRetry?: boolean
    class?: string
  }

  let {thunk, showToastOnRetry, ...restProps}: Props = $props()

  const retry = () => {
    thunk = isMergedThunk(thunk)
      ? new MergedThunk(thunk.thunks.map(t => publishThunk(t.options)))
      : publishThunk(thunk.options)

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

  const failedUrls = $derived(
    Object.entries(($thunk as any).status || {})
      .filter(([_, s]) =>
        [PublishStatus.Aborted, PublishStatus.Timeout, PublishStatus.Failure].includes(s as any),
      )
      .map(([url]) => url),
  )
  const showFailure = $derived(thunkIsComplete($thunk as any) && failedUrls.length > 0)
</script>

{#if showFailure}
  {@const url = failedUrls[0]}
  {@const status = $thunk.status[url]}
  {@const message = $thunk.details[url]}
  <button
    class="flex w-full justify-end px-1 text-xs {restProps.class}"
    onclick={stopPropagation(noop)}>
    <Tippy
      class="flex items-center"
      component={ThunkStatusDetail}
      props={{url, message, status, retry}}
      params={{interactive: true}}>
      {#snippet children()}
        <span class="flex cursor-pointer items-center gap-1 text-error">
          <Icon icon="danger" size={3} />
          <span>Failed to send!</span>
        </span>
      {/snippet}
    </Tippy>
  </button>
{/if}
