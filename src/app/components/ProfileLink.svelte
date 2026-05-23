<script lang="ts">
  import cx from "classnames"
  import {tick} from "svelte"
  import {preventDefault, stopPropagation} from "@lib/html"
  import Button from "@lib/components/Button.svelte"
  import ProfileName from "@app/components/ProfileName.svelte"
  import ProfileDetail from "@app/components/ProfileDetail.svelte"
  import {pushModal} from "@app/util/modal"

  type Props = {
    pubkey: string
    url?: string
    class?: string
    unstyled?: boolean
    beforeOpenProfile?: () => void | Promise<void>
  }

  const {pubkey, url, unstyled, beforeOpenProfile, ...props}: Props = $props()

  const openProfile = async () => {
    await beforeOpenProfile?.()
    await tick()
    pushModal(ProfileDetail, {pubkey, url})
  }
</script>

<Button
  onclick={stopPropagation(preventDefault(openProfile))}
  class={cx(props.class, {"link-content bg-alt": !unstyled})}>
  @<ProfileName {pubkey} {url} />
</Button>
