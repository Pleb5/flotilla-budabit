<script lang="ts">
  import cx from "classnames"
  import {tick} from "svelte"
  import {getContext} from "svelte"
  import {readable} from "svelte/store"
  import {removeUndefined} from "@welshman/lib"
  import {preventDefault, stopPropagation} from "@lib/html"
  import Button from "@lib/components/Button.svelte"
  import ProfileName from "@app/components/ProfileName.svelte"
  import ProfileDetail from "@app/components/ProfileDetail.svelte"
  import {pushModal} from "@app/util/modal"
  import {
    REPO_VERIFIED_MAINTAINERS_KEY,
    type RepoVerifiedMaintainersContext,
    type VerifiedMaintainerForRepo,
  } from "@app/core/git-state"

  type Props = {
    pubkey: string
    url?: string
    relays?: string[]
    class?: string
    unstyled?: boolean
    beforeOpenProfile?: () => void | Promise<void>
    verifiedMaintainerForRepo?: VerifiedMaintainerForRepo | false
  }

  const {
    pubkey,
    url,
    relays = [],
    unstyled,
    beforeOpenProfile,
    verifiedMaintainerForRepo,
    ...props
  }: Props = $props()

  const relayHints = $derived(removeUndefined([url, ...relays]))
  const repoVerifiedMaintainersContext = getContext<RepoVerifiedMaintainersContext | undefined>(
    REPO_VERIFIED_MAINTAINERS_KEY,
  )
  const emptyVerifiedMaintainers = readable(new Set<string>())
  const repoVerifiedMaintainersStore =
    repoVerifiedMaintainersContext?.maintainers ?? emptyVerifiedMaintainers
  const contextVerifiedMaintainerForRepo = $derived.by(() =>
    pubkey && $repoVerifiedMaintainersStore.has(pubkey)
      ? repoVerifiedMaintainersContext?.getProfileContext()
      : undefined,
  )
  const activeVerifiedMaintainerForRepo = $derived(
    verifiedMaintainerForRepo ?? contextVerifiedMaintainerForRepo,
  )

  const openProfile = async () => {
    await beforeOpenProfile?.()
    await tick()
    pushModal(ProfileDetail, {
      pubkey,
      url,
      relays: relayHints,
      verifiedMaintainerForRepo: activeVerifiedMaintainerForRepo || undefined,
    })
  }
</script>

<Button
  onclick={stopPropagation(preventDefault(openProfile))}
  class={cx(props.class, {"link-content bg-alt": !unstyled}, {
    "rounded-full border border-emerald-300/60 bg-emerald-50/70 px-1.5 text-emerald-800 dark:border-emerald-500/35 dark:bg-emerald-950/30 dark:text-emerald-200": activeVerifiedMaintainerForRepo,
  })}>
  @<ProfileName {pubkey} {url} {relays} />
</Button>
