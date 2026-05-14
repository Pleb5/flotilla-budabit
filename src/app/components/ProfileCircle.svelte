<script lang="ts">
  import cx from "classnames"
  import {removeUndefined} from "@welshman/lib"
  import {deriveProfile} from "@welshman/app"
  import UserRounded from "@assets/icons/user-rounded.svg?dataurl"
  import ImageIcon from "@lib/components/ImageIcon.svelte"

  type Props = {
    pubkey: string
    class?: string
    size?: number
    url?: string
    relays?: string[]
  }

  const {pubkey, url, relays = [], size = 7, ...props}: Props = $props()

  const profile = $derived(deriveProfile(pubkey, removeUndefined([url, ...relays])))
</script>

<ImageIcon
  {size}
  alt=""
  class={cx(props.class, "rounded-full")}
  src={$profile?.picture || UserRounded} />
