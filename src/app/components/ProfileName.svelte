<script lang="ts">
  import {removeUndefined} from "@welshman/lib"
  import {deriveProfileDisplay} from "@welshman/app"

  type Props = {
    pubkey: string
    url?: string
  }

  const {pubkey, url}: Props = $props()

  const profileDisplay = $derived(deriveProfileDisplay(pubkey, removeUndefined([url])))
</script>

{$profileDisplay}
