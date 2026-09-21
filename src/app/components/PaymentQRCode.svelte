<script lang="ts">
  import {onMount} from "svelte"

  const {value, label}: {value: string; label: string} = $props()
  let image = $state("")
  let error = $state("")

  onMount(() => {
    let cancelled = false
    void import("qrcode")
      .then(async ({default: QRCode}) => {
        try {
          const data = await QRCode.toDataURL(value, {
            errorCorrectionLevel: "M",
            margin: 4,
            scale: 6,
            color: {dark: "#000000", light: "#ffffff"},
          })
          if (!cancelled) image = data
        } catch {
          if (!cancelled)
            error = "This payload is too large for a single QR code. Use Copy instead."
        }
      })
      .catch(() => {
        if (!cancelled) error = "Could not create the QR code. You can still copy the full value."
      })
    return () => {
      cancelled = true
    }
  })
</script>

<span class="flex flex-col items-center gap-2 border-t border-base-content/10 pt-4" role="status">
  {#if error}
    <span class="text-sm text-error">{error}</span>
  {:else if image}
    <img src={image} alt={label} class="h-auto w-full max-w-72 rounded-xl bg-white" />
    <span class="text-xs text-base-content/60">Scan with a wallet on another device</span>
  {:else}
    <span class="loading loading-spinner loading-sm" aria-label="Generating QR code"></span>
  {/if}
</span>
