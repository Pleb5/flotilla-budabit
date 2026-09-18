<script lang="ts">
  import {pubkey} from "@welshman/app"
  import Star from "@assets/icons/star.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import LogIn from "@app/components/LogIn.svelte"
  import {activeCommunityStarByAddress, hydrateCommunityStars} from "@app/core/community-state"
  import {normalizeRelays, type CommunityPointer} from "@app/core/community"
  import {
    discardPublication,
    publicationOperations,
    retryPublication,
    startPublication,
  } from "@app/core/publication-operations"
  import {
    getCommunityStarOperationSemanticKey,
    projectCommunityStarOperation,
  } from "@app/core/community-star-operations"
  import {pushToast} from "@app/util/toast"
  import {pushModal} from "@app/util/modal"
  import {makeCommunityStarDelete, makeCommunityStarReaction} from "@app/util/community-stars"

  type Props = {
    community: CommunityPointer
    publishRelayHints: string[]
    class?: string
  }

  const {community, publishRelayHints, class: className = "btn btn-square btn-sm"}: Props = $props()

  const publishRelays = $derived(normalizeRelays(publishRelayHints || []))
  const starProjection = $derived(
    projectCommunityStarOperation({
      star: $activeCommunityStarByAddress.get(community.address),
      operations: $publicationOperations.values(),
      ownerPubkey: $pubkey || "",
      community,
    }),
  )
  const star = $derived(starProjection.star)
  const toggling = $derived(starProjection.pending)

  const toggleStar = () => {
    if (!$pubkey) {
      pushModal(LogIn)
      return
    }
    if (publishRelays.length === 0) {
      pushToast({theme: "error", message: "No relays available for updating this star."})
      return
    }

    try {
      const desiredStarred = !star
      if (
        starProjection.retryOperationId &&
        starProjection.retryDesiredStarred === desiredStarred
      ) {
        void retryPublication(starProjection.retryOperationId).catch(error => {
          pushToast({
            theme: "error",
            message: `Failed to retry star: ${error instanceof Error ? error.message : String(error)}`,
          })
        })
        return
      }
      if (starProjection.retryOperationId) {
        discardPublication(starProjection.retryOperationId)
      }

      if (star) {
        startPublication({
          event: makeCommunityStarDelete(community, star.reaction.id),
          relays: publishRelays,
          label: "Unstar community",
          semanticKey: getCommunityStarOperationSemanticKey(community),
          preview: "rollback-on-failure",
        })
      } else {
        const event = makeCommunityStarReaction({
          ...community,
          relayHints: publishRelays,
        })
        startPublication({
          event,
          relays: publishRelays,
          label: "Star community",
          semanticKey: getCommunityStarOperationSemanticKey(community),
          preview: "rollback-on-failure",
        })
      }
    } catch (error) {
      pushToast({
        theme: "error",
        message: `Failed to update star: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }

  $effect(() => {
    if (!$pubkey) return

    hydrateCommunityStars({
      relayHints: community.relayHints,
      communityAddress: community.address,
    }).catch(() => {})
  })
</script>

<button
  type="button"
  class="{className} {star ? 'btn-primary' : 'btn-outline'}"
  disabled={toggling}
  aria-label={star ? "Unstar community" : "Star community"}
  title={star ? "Unstar community" : "Star community"}
  onclick={toggleStar}>
  <Icon icon={Star} />
</button>
