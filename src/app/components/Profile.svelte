<script lang="ts">
  import * as nip19 from "nostr-tools/nip19"
  import {getContext} from "svelte"
  import {readable} from "svelte/store"
  import {removeUndefined} from "@welshman/lib"
  import {displayPubkey} from "@welshman/util"
  import {deriveHandleForPubkey, displayHandle} from "@welshman/app"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import ProfileCircle from "@app/components/ProfileCircle.svelte"
  import ProfileDetail from "@app/components/ProfileDetail.svelte"
  import {deriveBudabitProfileDisplay} from "@app/core/profile-resolver"
  import {pushModal} from "@app/util/modal"
  import {clip} from "@app/util/toast"
  import {
    REPO_VERIFIED_MAINTAINERS_KEY,
    type RepoVerifiedMaintainersContext,
    type VerifiedMaintainerForRepo,
  } from "@app/core/git-state"
  import Copy from "@assets/icons/copy.svg?dataurl"

  type Props = {
    pubkey: string
    url?: string
    relays?: string[]
    showPubkey?: boolean
    avatarSize?: number
    hideDetails?: boolean
    verifiedMaintainerForRepo?: VerifiedMaintainerForRepo | false
  }

  const {
    pubkey,
    url,
    relays = [],
    showPubkey,
    avatarSize = 10,
    hideDetails = false,
    verifiedMaintainerForRepo,
  }: Props = $props()

  const relayHints = $derived(removeUndefined([url, ...relays]))
  const profileDisplay = $derived(deriveBudabitProfileDisplay(pubkey, {url, relays}))
  const handle = $derived(deriveHandleForPubkey(pubkey))
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

  const openProfile = () =>
    pushModal(ProfileDetail, {
      pubkey,
      url: relayHints[0],
      relays: relayHints,
      verifiedMaintainerForRepo: activeVerifiedMaintainerForRepo || undefined,
    })

  const copyPubkey = () => clip(nip19.npubEncode(pubkey))
</script>

<div class="flex max-w-full items-start gap-3">
  <Button onclick={openProfile} class="py-1">
    <ProfileCircle
      {pubkey}
      {url}
      {relays}
      size={avatarSize}
      verifiedMaintainerForRepo={Boolean(activeVerifiedMaintainerForRepo)} />
  </Button>
  {#if !hideDetails}
    <div class="flex min-w-0 flex-col">
      <div class="flex items-center gap-2">
        <Button
          onclick={openProfile}
          class="text-bold overflow-hidden text-ellipsis whitespace-nowrap">
          {$profileDisplay}
        </Button>
        {#if activeVerifiedMaintainerForRepo}
          <span
            class="rounded-full border border-emerald-300/60 bg-emerald-50/80 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800 dark:border-emerald-500/35 dark:bg-emerald-950/30 dark:text-emerald-200"
            title="Verified maintainer for this repo">
            Verified
          </span>
        {/if}
      </div>
      {#if $handle}
        <div class="overflow-hidden text-ellipsis text-sm opacity-75">
          {displayHandle($handle)}
        </div>
      {/if}
      {#if showPubkey}
        <div class="flex items-center gap-2 overflow-hidden text-ellipsis text-sm opacity-70">
          {displayPubkey(pubkey)}
          <Button onclick={copyPubkey} class="shrink-0 p-1">
            <Icon size={4} icon={Copy} />
          </Button>
        </div>
      {/if}
    </div>
  {/if}
</div>
