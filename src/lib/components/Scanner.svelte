<script lang="ts">
  import {onMount} from "svelte"
  // Dynamically import qr-scanner at runtime to avoid dev resolution errors
  import Spinner from "@lib/components/Spinner.svelte"

  const {onscan} = $props()

  let video: HTMLVideoElement
  let scanner: any
  let loading = $state(true)

  onMount(() => {
    let destroyed = false
    ;(async () => {
      const {default: QrScanner} = await import(/* @vite-ignore */ "qr-scanner")
      scanner = new QrScanner(video, (r: any) => onscan(r.data), {
        returnDetailedScanResult: true,
      })
      await scanner.start()
      if (!destroyed) loading = false
    })()
    return () => {
      destroyed = true
      scanner?.destroy?.()
    }
  })
</script>

<div class="bg-alt flex min-h-48 w-full flex-col items-center justify-center rounded p-px">
  {#if loading}
    <p class="py-20">
      <Spinner loading>Loading your camera...</Spinner>
    </p>
  {/if}
  <video class="m-auto rounded" class:h-0={loading} bind:this={video}>
    <track kind="captions" label="camera" />
  </video>
</div>
