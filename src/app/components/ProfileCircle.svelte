<script lang="ts">
  import cx from "classnames"
  import {getContext} from "svelte"
  import {readable} from "svelte/store"
  import UserRounded from "@assets/icons/user-rounded.svg?dataurl"
  import ImageIcon from "@lib/components/ImageIcon.svelte"
  import {deriveBudabitProfile} from "@app/core/profile-resolver"
  import {
    REPO_VERIFIED_MAINTAINERS_KEY,
    type RepoVerifiedMaintainersContext,
  } from "@app/core/git-state"

  type Props = {
    pubkey: string
    class?: string
    size?: number
    url?: string
    relays?: string[]
    verifiedMaintainerForRepo?: boolean
  }

  const {pubkey, url, relays = [], size = 7, verifiedMaintainerForRepo, ...props}: Props = $props()

  const profile = $derived(deriveBudabitProfile(pubkey, {url, relays}))
  const repoVerifiedMaintainersContext = getContext<RepoVerifiedMaintainersContext | undefined>(
    REPO_VERIFIED_MAINTAINERS_KEY,
  )
  const emptyVerifiedMaintainers = readable(new Set<string>())
  const repoVerifiedMaintainersStore =
    repoVerifiedMaintainersContext?.maintainers ?? emptyVerifiedMaintainers
  const isRepoVerifiedMaintainer = $derived.by(() =>
    Boolean(verifiedMaintainerForRepo || (pubkey && $repoVerifiedMaintainersStore.has(pubkey))),
  )
</script>

<ImageIcon
  {size}
  alt=""
  class={cx(props.class, "rounded-full", {
    "ring-2 ring-emerald-400/70 ring-offset-1 ring-offset-background": isRepoVerifiedMaintainer,
  })}
  fallbackSrc={UserRounded}
  src={$profile?.picture} />
