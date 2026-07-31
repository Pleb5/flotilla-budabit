<script lang="ts">
  import Spinner from "@lib/components/Spinner.svelte"
  import Button from "@lib/components/Button.svelte"
  import QRCode from "@app/components/QRCode.svelte"
  import {isAndroid} from "@lib/html"
  import type {Nip46Controller} from "@app/util/nip46"

  type Props = {
    controller: Nip46Controller
  }

  const {controller}: Props = $props()
  const {url, loading, resumed} = controller

  // After the tab comes back to the foreground (e.g. returning from the
  // signer app on the same device), give the reconnect cycle some time. If
  // the connection still hasn't been recognized, offer a manual retry.
  const RETRY_HINT_DELAY = 10_000

  let showRetry = $state(false)

  $effect(() => {
    if ($resumed === 0) return

    const timeout = setTimeout(() => {
      showRetry = true
    }, RETRY_HINT_DELAY)

    return () => clearTimeout(timeout)
  })
</script>

{#if $url}
  {#if $loading}
    <div class="flex flex-col items-center gap-3">
      <Spinner loading>Establishing connection...</Spinner>
      {#if showRetry}
        <Button class="btn btn-neutral btn-sm" onclick={controller.retry}>
          Approved in your signer but nothing happened? Tap to retry.
        </Button>
      {/if}
    </div>
  {:else}
    <div class="flex flex-col items-center gap-2">
      <QRCode code={$url} />
      <p class="text-sm opacity-75">Scan with your signer to log in, or click to copy.</p>
      {#if isAndroid}
        <a class="btn btn-primary btn-sm" href={$url} data-testid="login-bunker-open-signer">
          Open in signer app
        </a>
      {/if}
      {#if showRetry}
        <Button class="btn btn-neutral btn-sm" onclick={controller.retry}>
          Approved in your signer but nothing happened? Tap to retry.
        </Button>
      {/if}
    </div>
  {/if}
{/if}
