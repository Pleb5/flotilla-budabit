<script lang="ts">
  import {pubkey as sessionPubkey} from "@welshman/app"
  import {
    activeCommunityDefinition,
    activeCommunityProfileListEvents,
    activeCommunityReportState,
    activeUserCommunityRefs,
    communityMemberReportStates,
  } from "@app/core/community-state"
  import {buildCommunityTrustAssessment} from "@app/core/community-trust"
  import {getProfileTrustBadges, type ProfileTrustBadgeTone} from "@app/core/profile-trust-badges"

  type Props = {
    pubkey: string
    class?: string
  }

  const {pubkey, class: className = ""}: Props = $props()

  const activeCommunityPubkey = $derived($activeCommunityDefinition?.pubkey || "")
  const activeReportStates = $derived.by(() =>
    activeCommunityPubkey
      ? new Map([[activeCommunityPubkey, $activeCommunityReportState]])
      : undefined,
  )
  const activeAssessment = $derived.by(() =>
    $activeCommunityDefinition
      ? buildCommunityTrustAssessment({
          viewerPubkey: $sessionPubkey || "",
          targetPubkey: pubkey,
          context: {scope: "active_community", communityPubkey: $activeCommunityDefinition.pubkey},
          definitions: [$activeCommunityDefinition],
          profileListEvents: $activeCommunityProfileListEvents,
          reportStates: activeReportStates,
        })
      : undefined,
  )
  const badges = $derived.by(() =>
    getProfileTrustBadges({
      assessment: activeAssessment,
      viewerCommunityRefs: $activeUserCommunityRefs,
      reportStates: $communityMemberReportStates,
      targetPubkey: pubkey,
      activeCommunityPubkey,
    }),
  )

  const getBadgeClass = (tone: ProfileTrustBadgeTone) => {
    if (tone === "error") return "badge-error"
    if (tone === "warning") return "badge-warning"
    if (tone === "info") return "badge-info"
    if (tone === "success") return "badge-success"
    return "badge-neutral"
  }
</script>

{#if badges.length > 0}
  <div class={`flex flex-wrap gap-1.5 ${className}`} aria-label="Profile trust evidence">
    {#each badges as badge (badge.key)}
      <span
        class={`badge badge-sm h-auto py-1 ${getBadgeClass(badge.tone)}`}
        title={badge.title || badge.label}>
        {badge.label}
      </span>
    {/each}
  </div>
{/if}
