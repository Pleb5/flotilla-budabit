<script lang="ts">
  import {goto} from "$app/navigation"
  import {removeUndefined} from "@welshman/lib"
  import {deriveProfile} from "@welshman/app"
  import AltArrowLeft from "@assets/icons/alt-arrow-left.svg?dataurl"
  import Code2 from "@assets/icons/code-2.svg?dataurl"
  import Letter from "@assets/icons/letter-opened.svg?dataurl"
  import MenuDots from "@assets/icons/menu-dots.svg?dataurl"
  import {fly} from "@lib/transition"
  import Icon from "@lib/components/Icon.svelte"
  import ImageIcon from "@lib/components/ImageIcon.svelte"
  import Link from "@lib/components/Link.svelte"
  import Button from "@lib/components/Button.svelte"
  import Popover from "@lib/components/Popover.svelte"
  import ModalFooter from "@lib/components/ModalFooter.svelte"
  import Profile from "@app/components/Profile.svelte"
  import ProfileInfo from "@app/components/ProfileInfo.svelte"
  import EventInfo from "@app/components/EventInfo.svelte"
  import ProfileBadges from "@app/components/ProfileBadges.svelte"
  import ProfileCodeTrustAnalysis from "@app/components/ProfileCodeTrustAnalysis.svelte"
  import ProfileNip85Metrics from "@app/components/ProfileNip85Metrics.svelte"
  import {pubkeyLink} from "@app/core/state"
  import {pushModal} from "@app/util/modal"
  import {makeChatPath} from "@app/util/routes"

  export type Props = {
    pubkey: string
    url?: string
    relays?: string[]
  }

  const {pubkey, url, relays = []}: Props = $props()

  const relayHints = $derived(removeUndefined([url, ...relays]))
  const profileUrl = $derived(relayHints[0])
  const profile = $derived(deriveProfile(pubkey, relayHints))

  const back = () => history.back()

  const chatPath = $derived(makeChatPath(pubkey))

  const showInfo = () => pushModal(EventInfo, {url: profileUrl, event: $profile!.event})

  const openChat = () => goto(chatPath)

  const toggleMenu = (pubkey: string) => {
    showMenu = !showMenu
  }

  const closeMenu = () => {
    showMenu = false
  }

  let showMenu = $state(false)
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
  <ProfileInfo {pubkey} url={profileUrl} relays={relayHints} />
  <ProfileBadges {pubkey} url={profileUrl} />
  <ProfileNip85Metrics {pubkey} />
  <ProfileCodeTrustAnalysis {pubkey} />
  <ModalFooter>
    <Button onclick={back} class="hidden md:btn md:btn-link">
      <Icon icon={AltArrowLeft} />
      Go back
    </Button>
    <div class="flex gap-2">
      <Link external href={pubkeyLink(pubkey)} class="btn btn-neutral">
        <ImageIcon alt="" src="/coracle.png" />
        Open in Coracle
      </Link>
      <Button onclick={openChat} class="btn btn-primary">
        <Icon icon={Letter} />
        Open Chat
      </Button>
    </div>
  </ModalFooter>
</div>
