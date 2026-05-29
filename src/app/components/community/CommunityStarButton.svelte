<script lang="ts">
  import {pubkey, publishThunk, repository} from "@welshman/app"
  import {type TrustedEvent} from "@welshman/util"
  import Star from "@assets/icons/star.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import {publishDelete} from "@app/core/commands"
  import {
    activeCommunityStarByCommunity,
    getCommunityStarRelays,
    hydrateCommunityStars,
  } from "@app/core/community-state"
  import {makeCommunityDefinitionAddress} from "@app/core/community-forms"
  import {pushToast} from "@app/util/toast"
  import {makeCommunityStarReaction} from "@app/util/community-stars"

  type Props = {
    communityPubkey: string
    relayHints?: string[]
    class?: string
  }

  const {
    communityPubkey,
    relayHints = [],
    class: className = "btn btn-square btn-sm",
  }: Props = $props()

  let toggling = $state(false)
  const relays = $derived(getCommunityStarRelays(relayHints))
  const star = $derived($activeCommunityStarByCommunity.get(communityPubkey))

  const toggleStar = () => {
    if (!$pubkey) {
      pushToast({theme: "warning", message: "Sign in to star communities."})
      return
    }
    if (!communityPubkey || relays.length === 0) {
      pushToast({theme: "error", message: "No relays available for updating this star."})
      return
    }

    toggling = true

    try {
      if (star) {
        const thunk = publishDelete({event: star.reaction, relays})
        if (thunk?.event) repository.publish(thunk.event as TrustedEvent)
        pushToast({message: "Community unstarred."})
      } else {
        const event = makeCommunityStarReaction({communityPubkey, relayHints})
        const thunk = publishThunk({event, relays})
        if (thunk?.event) repository.publish(thunk.event as TrustedEvent)
        pushToast({message: "Community starred."})
      }
    } catch (error) {
      pushToast({
        theme: "error",
        message: `Failed to update star: ${error instanceof Error ? error.message : String(error)}`,
      })
    } finally {
      toggling = false
    }
  }

  $effect(() => {
    const address = makeCommunityDefinitionAddress(communityPubkey)
    if (!$pubkey || !address) return

    hydrateCommunityStars({relayHints, communityAddress: address}).catch(() => {})
  })
</script>

<button
  type="button"
  class="{className} {star ? 'btn-primary' : 'btn-outline'}"
  disabled={!communityPubkey || toggling}
  aria-label={star ? "Unstar community" : "Star community"}
  title={star ? "Unstar community" : "Star community"}
  onclick={toggleStar}>
  <Icon icon={Star} />
</button>
