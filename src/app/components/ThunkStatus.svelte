<script lang="ts">
  import {MergedThunk, thunkIsComplete} from "@welshman/app"
  import type {Thunk} from "@welshman/app"
  import {PublishStatus} from "@welshman/net"
  import ThunkFailure from "@app/components/ThunkFailure.svelte"
  import ThunkPending from "@app/components/ThunkPending.svelte"

  interface Props {
    thunk: Thunk | MergedThunk
    class?: string
  }

  const {thunk, ...restProps}: Props = $props()

  const showFailure = $derived(
    thunkIsComplete($thunk as any) &&
      Object.values((($thunk as any)?.status || {})).some(s =>
        [PublishStatus.Aborted, PublishStatus.Timeout, PublishStatus.Failure].includes(s as any),
      ),
  )
  const showPending = $derived(!thunkIsComplete($thunk))
</script>

{#if showFailure}
  <ThunkFailure class={restProps.class} {thunk} />
{:else if showPending}
  <ThunkPending class={restProps.class} {thunk} />
{/if}
