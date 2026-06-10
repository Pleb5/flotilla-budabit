<script lang="ts">
  import {goto} from "$app/navigation"
  import {CircleCheck, Info} from "@lucide/svelte"
  import {removeUndefined} from "@welshman/lib"
  import {pubkey as sessionPubkey} from "@welshman/app"
  import AltArrowLeft from "@assets/icons/alt-arrow-left.svg?dataurl"
  import AltArrowDown from "@assets/icons/alt-arrow-down.svg?dataurl"
  import Code2 from "@assets/icons/code-2.svg?dataurl"
  import Letter from "@assets/icons/letter-opened.svg?dataurl"
  import MedalStar from "@assets/icons/medal-star.svg?dataurl"
  import MenuDots from "@assets/icons/menu-dots.svg?dataurl"
  import UserCircle from "@assets/icons/user-circle.svg?dataurl"
  import {fly} from "@lib/transition"
  import Icon from "@lib/components/Icon.svelte"
  import Link from "@lib/components/Link.svelte"
  import Button from "@lib/components/Button.svelte"
  import Popover from "@lib/components/Popover.svelte"
  import Tooltip from "@lib/components/Tooltip.svelte"
  import ModalFooter from "@lib/components/ModalFooter.svelte"
  import Profile from "@app/components/Profile.svelte"
  import ProfileInfo from "@app/components/ProfileInfo.svelte"
  import ProfileTrustBadges from "@app/components/ProfileTrustBadges.svelte"
  import EventInfo from "@app/components/EventInfo.svelte"
  import ProfileBadges from "@app/components/ProfileBadges.svelte"
  import CommunityBadgeAwardForm from "@app/components/CommunityBadgeAwardForm.svelte"
  import {
    activeCommunityBootstrapStatus,
    activeCommunityDefinition,
    activeCommunityProfileListEvents,
    activeCommunityReportState,
  } from "@app/core/community-state"
  import {canCreateCommunityBadge} from "@app/core/community-badges"
  import {pushModal} from "@app/util/modal"
  import {makeChatPath, makeProfilePath} from "@app/util/routes"
  import {deriveBudabitProfile} from "@app/core/profile-resolver"
  import type {VerifiedMaintainerForRepo} from "@app/core/git-state"

  export type Props = {
    pubkey: string
    url?: string
    relays?: string[]
    verifiedMaintainerForRepo?: VerifiedMaintainerForRepo
  }

  const {pubkey, url, relays = [], verifiedMaintainerForRepo}: Props = $props()

  const relayHints = $derived(
    Array.from(new Set(removeUndefined([url, ...relays]).filter(Boolean))),
  )
  const profileUrl = $derived(relayHints[0])
  const profile = $derived(deriveBudabitProfile(pubkey, {url, relays}))
  const canAwardCommunityBadges = $derived(
    Boolean(
      $activeCommunityDefinition &&
      $activeCommunityBootstrapStatus.loaded &&
      !$activeCommunityBootstrapStatus.loading &&
      $sessionPubkey &&
      canCreateCommunityBadge({
        definition: $activeCommunityDefinition,
        pubkey: $sessionPubkey,
        profileListEvents: $activeCommunityProfileListEvents,
        reportState: $activeCommunityReportState,
      }),
    ),
  )

  const back = () => history.back()

  const chatPath = $derived(makeChatPath(pubkey))
  const fullProfilePath = $derived(makeProfilePath(pubkey, relayHints))
  const verifiedMaintainerTooltip = $derived(
    `Listed as a maintainer by this repository's owner${verifiedMaintainerForRepo?.repoName ? ` for ${verifiedMaintainerForRepo.repoName}` : ""}, and the owner has marked at least one of their pull requests as merged.`,
  )

  const showInfo = () =>
    pushModal(EventInfo, {url: profileUrl, relays: relayHints, event: $profile!.event})

  const openChat = () => goto(chatPath)

  const toggleMenu = (pubkey: string) => {
    showMenu = !showMenu
  }

  const closeMenu = () => {
    showMenu = false
  }

  let showMenu = $state(false)
  let awardPanelOpen = $state(false)
</script>

<div class="flex flex-col gap-4">
  <div class="flex justify-between">
    <Profile
      showPubkey
      avatarSize={14}
      {pubkey}
      url={profileUrl}
      relays={relayHints} />
    {#if $profile}
      <div class="relative">
        <Button class="btn btn-circle btn-ghost btn-sm" onclick={() => toggleMenu(pubkey)}>
          <Icon icon={MenuDots} />
        </Button>
        {#if showMenu}
          <Popover hideOnClick onClose={closeMenu}>
            <ul
              transition:fly
              class="bg-alt menu absolute right-0 z-popover w-48 gap-1 rounded-box p-2 shadow-md">
              {#if $profile}
                <li>
                  <Button onclick={showInfo}>
                    <Icon icon={Code2} />
                    User Details
                  </Button>
                </li>
              {/if}
            </ul>
          </Popover>
        {/if}
      </div>
    {/if}
  </div>
  {#if verifiedMaintainerForRepo}
    <div class="flex flex-wrap items-center gap-2">
      <span
        class="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/70 bg-emerald-50/80 px-2.5 py-1 text-xs font-semibold text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-950/30 dark:text-emerald-200">
        <CircleCheck class="h-3.5 w-3.5" />
        Verified maintainer
        <Tooltip content={verifiedMaintainerTooltip} class="inline-flex">
          <button
            type="button"
            class="inline-flex h-4 w-4 items-center justify-center rounded-full border border-emerald-300/70 bg-white/60 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-950/60 dark:text-emerald-200"
            aria-label={verifiedMaintainerTooltip}>
            <Info class="h-3 w-3" />
          </button>
        </Tooltip>
      </span>
      {#if verifiedMaintainerForRepo.repoName}
        <span class="min-w-0 truncate text-xs opacity-70">
          for {verifiedMaintainerForRepo.repoName}
        </span>
      {/if}
    </div>
  {/if}
  <ProfileTrustBadges {pubkey} relays={relayHints} />
  <ProfileInfo {pubkey} url={profileUrl} relays={relayHints} />
  <ProfileBadges {pubkey} url={profileUrl} />
  {#if canAwardCommunityBadges}
    <div class="rounded-xl bg-base-200/50">
      <button
        type="button"
        class="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={awardPanelOpen}
        onclick={() => (awardPanelOpen = !awardPanelOpen)}>
        <div class="flex flex-col gap-1">
          <span class="flex items-center gap-2 text-sm font-semibold">
            <Icon icon={MedalStar} /> Award this profile
          </span>
          <span class="text-xs opacity-70">Choose one of your active badges to award.</span>
        </div>

        <div class="transition-transform" class:rotate-180={awardPanelOpen}>
          <Icon icon={AltArrowDown} />
        </div>
      </button>

      {#if awardPanelOpen}
        <div class="border-t border-base-300/50 px-4 py-4">
          <CommunityBadgeAwardForm
            recipientPubkey={pubkey}
            title="Award this profile"
            description="Choose one of your active badges to award to this profile."
            showHeader={false} />
        </div>
      {/if}
    </div>
  {/if}
  <ModalFooter>
    <Button onclick={back} class="hidden md:btn md:btn-link">
      <Icon icon={AltArrowLeft} />
      Go back
    </Button>
    <div class="grid w-full grid-cols-2 gap-2 md:flex md:w-auto md:justify-end">
      <Link href={fullProfilePath} class="btn btn-neutral min-w-0 justify-center whitespace-nowrap">
        <Icon icon={UserCircle} />
        <span class="truncate text-xs sm:text-sm">View full profile</span>
      </Link>
      <Button onclick={openChat} class="btn btn-primary min-w-0 justify-center whitespace-nowrap">
        <Icon icon={Letter} />
        <span class="truncate">Open Chat</span>
      </Button>
    </div>
  </ModalFooter>
</div>
