<script lang="ts">
  import cx from "classnames"
  import {preventDefault} from "@lib/html"
  import Button from "@lib/components/Button.svelte"
  import ProfileName from "@app/components/ProfileName.svelte"
  import ProfileDetail from "@app/components/ProfileDetail.svelte"
  import {pushModal} from "@app/util/modal"

  type Props = {
    pubkey: string
    url?: string
    unstyled?: boolean
    class?: string
  }

  const {pubkey, url, unstyled, class: klass}: Props = $props()

  const openProfile = () => pushModal(ProfileDetail, {pubkey, url})
</script>

<Button onclick={preventDefault(openProfile)} class={cx({"link-content": !unstyled}, klass)}>
  @<ProfileName {pubkey} {url} />
</Button>
