<script lang="ts">
  import cx from "classnames"
  import {tick} from "svelte"
  import {removeUndefined} from "@welshman/lib"
  import {preventDefault, stopPropagation} from "@lib/html"
  import Button from "@lib/components/Button.svelte"
  import ProfileName from "@app/components/ProfileName.svelte"
  import ProfileDetail from "@app/components/ProfileDetail.svelte"
  import {pushModal} from "@app/util/modal"

  type Props = {
    pubkey: string
    url?: string
    relays?: string[]
    class?: string
    unstyled?: boolean
    beforeOpenProfile?: () => void | Promise<void>
  }

  const {pubkey, url, relays = [], unstyled, beforeOpenProfile, ...props}: Props = $props()

  const relayHints = $derived(removeUndefined([url, ...relays]))

  const openProfile = async () => {
    await beforeOpenProfile?.()
    await tick()
    pushModal(ProfileDetail, {pubkey, url, relays: relayHints})
  }
</script>

<Button
  onclick={stopPropagation(preventDefault(openProfile))}
  class={cx(props.class, {"link-content bg-alt": !unstyled})}>
  @<ProfileName {pubkey} {url} {relays} />
</Button>
