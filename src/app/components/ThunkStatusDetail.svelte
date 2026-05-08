<script lang="ts">
  import {PublishStatus} from "@welshman/net"
  import {displayRelayUrl} from "@welshman/util"
  import Button from "@lib/components/Button.svelte"

  interface Props {
    url: string
    status: string
    message: string
    retry: () => void
    partial?: boolean
    successCount?: number
    relayCount?: number
  }

  let {
    url,
    status,
    message = $bindable(),
    retry,
    partial = false,
    successCount = 0,
    relayCount = 0,
  }: Props = $props()

  $effect(() => {
    if (!message && status === PublishStatus.Timeout) {
      message = "request timed out"
    }

    if (!message) {
      message = "no details received"
    }
  })
</script>

<div class="card2 bg-alt col-2 shadow-lg">
  {#if partial}
    <p>
      Published to {successCount}/{relayCount} relays. {displayRelayUrl(url)} did not confirm: {message}.
    </p>
  {:else}
    <p>
      Failed to publish to {displayRelayUrl(url)}: {message}.
    </p>
  {/if}
  <Button class="link" onclick={retry}>Retry</Button>
</div>
