<script lang="ts">
  import {goto} from "$app/navigation"
  import type {TrustedEvent} from "@welshman/util"
  import {ArrowUpRight} from "@lucide/svelte"
  import Code2 from "@assets/icons/code-2.svg?dataurl"
  import NotesMinimalistic from "@assets/icons/notes-minimalistic.svg?dataurl"
  import ShareCircle from "@assets/icons/share-circle.svg?dataurl"
  import Button from "@lib/components/Button.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import EventInfo from "@app/components/EventInfo.svelte"
  import RepoActivityThreadCreate from "@app/components/RepoActivityThreadCreate.svelte"
  import {COMMUNITY_SECTION_THREADS} from "@app/core/community"
  import {activeUserCommunityRefs} from "@app/core/community-state"
  import {makeEventShareEntityForEvent} from "@app/util/event-share"
  import {clearModals, pushModal} from "@app/util/modal"
  import {clip} from "@app/util/toast"

  type Props = {
    url: string
    event: TrustedEvent
    openHref: string
    openLabel?: string
    relays?: string[]
    defaultThreadCommunityPubkey?: string
  }

  const {
    url,
    event,
    openHref,
    openLabel = "Open",
    relays = [],
    defaultThreadCommunityPubkey = "",
  }: Props = $props()

  const relayTargets = $derived.by(() => (relays.length > 0 ? relays : [url]).filter(Boolean))
  const canCreateThread = $derived.by(() =>
    $activeUserCommunityRefs.some(ref => ref.writableSections.includes(COMMUNITY_SECTION_THREADS)),
  )

  const showInfo = () =>
    pushModal(EventInfo, {url, event, relays: relayTargets}, {replaceState: true})

  const shareItem = () => {
    clip(makeEventShareEntityForEvent(event, {url, relays: relayTargets}))
    history.back()
  }

  const createThread = () => {
    if (!canCreateThread) return

    pushModal(
      RepoActivityThreadCreate,
      {
        event,
        url,
        relays: relayTargets,
        defaultCommunityPubkey: defaultThreadCommunityPubkey,
      },
      {replaceState: true},
    )
  }

  const openItem = () => {
    clearModals()
    goto(openHref)
  }
</script>

<div class="flex flex-col gap-2">
  <Button class="btn btn-neutral w-full" onclick={openItem}>
    <ArrowUpRight class="h-4 w-4" />
    {openLabel}
  </Button>

  <Button
    class="btn btn-neutral w-full"
    onclick={createThread}
    disabled={!canCreateThread}
    title={canCreateThread
      ? "Create thread from activity"
      : "No thread-writable community available"}>
    <Icon size={4} icon={NotesMinimalistic} />
    Create Thread
  </Button>

  <Button class="btn btn-neutral w-full" onclick={shareItem}>
    <Icon size={4} icon={ShareCircle} />
    Share
  </Button>

  <Button class="btn btn-neutral" onclick={showInfo}>
    <Icon size={4} icon={Code2} />
    Message Info
  </Button>
</div>
