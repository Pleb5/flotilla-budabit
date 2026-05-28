<script lang="ts">
  import {goto} from "$app/navigation"
  import {removeUndefined} from "@welshman/lib"
  import {deriveProfile, pubkey as sessionPubkey} from "@welshman/app"
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
    activeCommunityReportState,
  } from "@app/core/community-state"
  import {canCreateCommunityBadge} from "@app/core/community-badges"
  import {pushModal} from "@app/util/modal"
  import {makeChatPath, makeProfilePath} from "@app/util/routes"

  export type Props = {
    pubkey: string
    url?: string
    relays?: string[]
  }

  const {pubkey, url, relays = []}: Props = $props()

  const relayHints = $derived(removeUndefined([url, ...relays]))
  const profileUrl = $derived(relayHints[0])
  const profile = $derived(deriveProfile(pubkey, relayHints))
  const canAwardCommunityBadges = $derived(
    Boolean(
      $activeCommunityDefinition &&
      $activeCommunityBootstrapStatus.loaded &&
      !$activeCommunityBootstrapStatus.loading &&
      $sessionPubkey &&
      canCreateCommunityBadge({
        definition: $activeCommunityDefinition,
        pubkey: $sessionPubkey,
        reportState: $activeCommunityReportState,
      }),
    ),
  )

  const back = () => history.back()

  const chatPath = $derived(makeChatPath(pubkey))
  const fullProfilePath = $derived(makeProfilePath(pubkey, relayHints))

  const showInfo = () => pushModal(EventInfo, {url: profileUrl, event: $profile!.event})

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
    <Profile showPubkey avatarSize={14} {pubkey} url={profileUrl} relays={relayHints} />
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
  <ProfileTrustBadges {pubkey} />
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
