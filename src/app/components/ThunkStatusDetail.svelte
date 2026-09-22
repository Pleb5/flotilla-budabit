<script lang="ts">
  import {PublishStatus} from "@welshman/net"
  import {displayRelayUrl} from "@welshman/util"
  import Button from "@lib/components/Button.svelte"
  import type {PublishResultsByRelay} from "@welshman/net"
  import RelayPublishFeedback from "./RelayPublishFeedback.svelte"
  import {
    canRetryRelayPublishResults,
    summarizeRelayPublishResults,
  } from "@app/core/relay-publish-outcomes"

  interface Props {
    url: string
    status: string
    message: string
    retry: () => Promise<void> | void
    retrying?: boolean
    partial?: boolean
    successCount?: number
    relayCount?: number
    results?: PublishResultsByRelay
    retryError?: string
  }

  let {
    url,
    status,
    message = $bindable(),
    retry,
    retrying = false,
    partial = false,
    successCount = 0,
    relayCount = 0,
    results,
    retryError = "",
  }: Props = $props()

  $effect(() => {
    if (!message && status === PublishStatus.Timeout) {
      message = "request timed out"
    }

    if (!message) {
      message = "no details received"
    }
  })

  const signingFailed = $derived(/signing|nip-46/i.test(message))
</script>

<div class="card2 bg-alt col-2 shadow-lg">
  {#if partial}
    <p>
      {results
        ? summarizeRelayPublishResults(results)
        : `Published to ${successCount}/${relayCount} relays.`}
    </p>
  {:else if signingFailed}
    <p>Failed to sign the event: {message}.</p>
  {:else}
    <p>
      Failed to publish to {displayRelayUrl(url)}: {message}.
    </p>
  {/if}
  <RelayPublishFeedback
    results={results || {[url]: {relay: url, status: status as PublishStatus, detail: message}}} />
  {#if retryError}<p class="text-xs text-error">{retryError}</p>{/if}
  <Button
    class="link"
    onclick={retry}
    disabled={retrying ||
      !canRetryRelayPublishResults(results || {[url]: {status, detail: message}})}>
    {retrying ? "Retrying..." : "Retry"}
  </Button>
</div>
