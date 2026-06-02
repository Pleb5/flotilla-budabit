<script lang="ts">
  import ProfileCircle from "@app/components/ProfileCircle.svelte"
  import ProfileName from "@app/components/ProfileName.svelte"
  import ProfileDetail from "@app/components/ProfileDetail.svelte"
  import {pushModal} from "@app/util/modal"
  import type {
    CashuMintRecommendation,
    CashuMintRecommendationEvidence,
    CashuMintRecommendationEvidenceKind,
  } from "@app/core/cashu-mint-recommendations"

  type EvidenceGroup = {
    kind: CashuMintRecommendationEvidenceKind
    label: string
    evidence: CashuMintRecommendationEvidence[]
  }

  interface Props {
    recommendation: CashuMintRecommendation
  }

  const {recommendation}: Props = $props()
  let activeKind = $state<CashuMintRecommendationEvidenceKind | "">("")

  const countLabel = (count: number, singular: string, plural = `${singular}s`) =>
    `${count} ${count === 1 ? singular : plural}`

  const openProfile = (pubkey: string | undefined, relays: string[] = []) => {
    if (!pubkey) return

    pushModal(ProfileDetail, {pubkey, relays})
  }

  const uniqueBy = <T,>(items: T[], getKey: (item: T) => string) => {
    const byKey = new Map<string, T>()

    for (const item of items) {
      const key = getKey(item)
      if (key && !byKey.has(key)) byKey.set(key, item)
    }

    return Array.from(byKey.values())
  }

  const groups = $derived.by<EvidenceGroup[]>(() => {
    const result: EvidenceGroup[] = []

    if (recommendation.counts.ownNutzap > 0) {
      result.push({
        kind: "own_nutzap",
        label: "You trust for nutzaps",
        evidence: recommendation.evidence.filter(item => item.kind === "own_nutzap"),
      })
    }

    if (recommendation.counts.communities > 0) {
      result.push({
        kind: "community",
        label: countLabel(recommendation.counts.communities, "Community", "Communities"),
        evidence: uniqueBy(
          recommendation.evidence.filter(item => item.kind === "community"),
          item => item.communityPubkey || item.pubkey,
        ),
      })
    }

    if (recommendation.counts.moderators > 0) {
      result.push({
        kind: "moderator",
        label: countLabel(recommendation.counts.moderators, "Moderator"),
        evidence: uniqueBy(
          recommendation.evidence.filter(item => item.kind === "moderator"),
          item => `${item.pubkey}:${item.communityPubkey}`,
        ),
      })
    }

    if (recommendation.counts.members > 0) {
      result.push({
        kind: "member",
        label: countLabel(recommendation.counts.members, "Member"),
        evidence: uniqueBy(
          recommendation.evidence.filter(item => item.kind === "member"),
          item => `${item.pubkey}:${item.communityPubkey}`,
        ),
      })
    }

    if (recommendation.counts.follows > 0) {
      result.push({
        kind: "follow",
        label: countLabel(recommendation.counts.follows, "Follow"),
        evidence: uniqueBy(
          recommendation.evidence.filter(item => item.kind === "follow"),
          item => item.pubkey,
        ),
      })
    }

    return result
  })

  const activeGroup = $derived(groups.find(group => group.kind === activeKind))

  const toggleGroup = (kind: CashuMintRecommendationEvidenceKind) => {
    activeKind = activeKind === kind ? "" : kind
  }

  const rowPubkey = (evidence: CashuMintRecommendationEvidence) =>
    evidence.kind === "community" ? evidence.communityPubkey || evidence.pubkey : evidence.pubkey

  const rowRelays = (evidence: CashuMintRecommendationEvidence) =>
    evidence.kind === "community"
      ? evidence.communityRelayHints || evidence.relayHints || []
      : evidence.relayHints || []

  const roleLabel = (evidence: CashuMintRecommendationEvidence) => {
    if (evidence.kind === "own_nutzap") return "From your existing public Cashu mint list"
    if (evidence.kind === "follow") return "You follow"
    if (evidence.kind === "community") {
      return evidence.source === "10222" ? "Community mint" : "Community endorsement"
    }
    if (evidence.kind === "moderator") {
      const count = evidence.moderatorSectionCount || 0
      return count === 1 ? "Moderator of 1 section" : `Moderator of ${count} sections`
    }

    const count = evidence.memberGrantCount || 0
    return count === 1 ? "Member with 1 grant" : `Member with ${count} grants`
  }
</script>

<div class="flex min-w-0 flex-col gap-2">
  <div class="flex flex-wrap gap-1.5">
    {#each groups as group (group.kind)}
      <button
        type="button"
        class="badge cursor-pointer border border-base-content/15 bg-base-200 font-medium text-base-content/80 hover:bg-base-300"
        class:bg-base-300={activeKind === group.kind}
        aria-expanded={activeKind === group.kind}
        onclick={() => toggleGroup(group.kind)}>
        {group.label}
      </button>
    {/each}
  </div>

  {#if activeGroup}
    <div class="rounded-box border border-base-300 bg-base-100 p-2 shadow-sm">
      <div class="flex max-h-72 flex-col gap-1 overflow-y-auto">
        {#each activeGroup.evidence as evidence (`${evidence.kind}:${evidence.pubkey}:${evidence.communityPubkey || ""}`)}
          {@const pubkey = rowPubkey(evidence)}
          {@const relays = rowRelays(evidence)}
          <div class="flex min-w-0 items-center gap-2 rounded-box bg-base-200/50 px-2 py-1.5">
            <button
              type="button"
              class="shrink-0"
              onclick={() => openProfile(pubkey, relays)}
              aria-label="Open profile">
              <ProfileCircle {pubkey} {relays} size={7} />
            </button>
            <div class="min-w-0 flex-1">
              <button
                type="button"
                class="max-w-full truncate text-sm font-medium hover:underline"
                onclick={() => openProfile(pubkey, relays)}>
                <ProfileName {pubkey} {relays} />
              </button>
              <div class="text-xs opacity-70">{roleLabel(evidence)}</div>
              {#if evidence.communityPubkey && evidence.kind !== "community"}
                <button
                  type="button"
                  class="max-w-full truncate text-left text-[11px] opacity-60 hover:underline"
                  onclick={() =>
                    openProfile(evidence.communityPubkey, evidence.communityRelayHints || [])}>
                  in <ProfileName
                    pubkey={evidence.communityPubkey}
                    relays={evidence.communityRelayHints || []} />
                </button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>
