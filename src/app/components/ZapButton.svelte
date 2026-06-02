<script lang="ts">
  import type {Snippet} from "svelte"
  import type {TrustedEvent} from "@welshman/util"
  import {session, loadZapperForPubkey} from "@welshman/app"
  import Button from "@lib/components/Button.svelte"
  import Zap from "@app/components/Zap.svelte"
  import InfoZapperError from "@app/components/InfoZapperError.svelte"
  import WalletConnect from "@app/components/WalletConnect.svelte"
  import {pushModal} from "@app/util/modal"

  type Props = {
    event: TrustedEvent
    children: Snippet
    relayHints?: string[]
    scopeH?: string
    replaceState?: boolean
    class?: string
  }

  const {
    event,
    children,
    relayHints = [],
    scopeH = "",
    replaceState,
    ...props
  }: Props = $props()

  const onClick = async () => {
    loading = true

    try {
      const zapper = await loadZapperForPubkey(event.pubkey, relayHints)

      if (!zapper?.allowsNostr) {
        pushModal(InfoZapperError, {pubkey: event.pubkey}, {replaceState})
      } else if ($session?.wallet) {
        pushModal(Zap, {event, relayHints, scopeH}, {replaceState})
      } else {
        pushModal(WalletConnect, {}, {replaceState})
      }
    } finally {
      loading = false
    }
  }

  let loading = $state(false)
</script>

<Button onclick={onClick} disabled={loading} {...props}>
  {@render children?.()}
</Button>
