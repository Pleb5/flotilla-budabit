<script lang="ts">
  import type {TrustedEvent} from "@welshman/util"
  import {getPlaintext, pubkey} from "@welshman/app"
  import Content from "@app/components/Content.svelte"
  import {ensureDmPlaintext} from "@app/core/dm"

  const {event}: {event: TrustedEvent} = $props()

  let plaintext = $state<string | undefined>(getPlaintext(event))
  let decrypting = $state(false)
  let decryptFailed = $state(false)

  const displayEvent = $derived(plaintext !== undefined ? {...event, content: plaintext} : event)
  const showDecrypting = $derived(
    decrypting || Boolean($pubkey && event.content && plaintext === undefined && !decryptFailed),
  )

  $effect(() => {
    let cancelled = false
    const eventId = event.id
    const existing = getPlaintext(event)

    plaintext = existing
    decryptFailed = false

    if (!$pubkey || !event.content) {
      decrypting = false
      return () => {
        cancelled = true
      }
    }

    if (existing !== undefined) {
      decrypting = false
      return () => {
        cancelled = true
      }
    }

    decrypting = true
    ensureDmPlaintext(event, $pubkey)
      .then(result => {
        if (cancelled || event.id !== eventId) return

        if (result !== undefined) {
          plaintext = result
          decryptFailed = false
        } else {
          decryptFailed = true
        }
      })
      .catch(() => {
        if (!cancelled) decryptFailed = true
      })
      .finally(() => {
        if (!cancelled) decrypting = false
      })

    return () => {
      cancelled = true
    }
  })
</script>

{#if showDecrypting}
  <div class="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
    <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
    <span>Decrypting message...</span>
  </div>
{:else if decryptFailed || plaintext === undefined}
  <span class="text-xs text-muted-foreground">Encrypted message</span>
{:else}
  <Content showEntire event={displayEvent} />
{/if}
