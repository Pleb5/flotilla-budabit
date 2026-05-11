<script lang="ts">
  import {page} from "$app/stores"
  import HomeSmile from "@assets/icons/home-smile.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import CardButton from "@lib/components/CardButton.svelte"
  import {activeCommunitySession} from "@app/core/community-state"
  import {
    makeCommunityCalendarPath,
    makeCommunityGitPath,
    makeCommunityGoalPath,
    makeCommunityPath,
    makeCommunityThreadPath,
    parseCommunityRouteParam,
  } from "@app/util/routes"

  const parsedCommunity = $derived(parseCommunityRouteParam($page.params.community))
  const communityId = $derived(parsedCommunity?.pubkey || $activeCommunitySession?.communityPubkey || "")
  const shortCommunity = $derived(
    communityId ? `${communityId.slice(0, 8)}...${communityId.slice(-8)}` : "Unknown community",
  )

  const navItems = $derived(
    communityId
      ? [
          ["Rooms", makeCommunityPath(communityId, "rooms")],
          ["Threads", makeCommunityThreadPath(communityId)],
          ["Calendar", makeCommunityCalendarPath(communityId)],
          ["Fundraisers", makeCommunityGoalPath(communityId)],
          ["Git", makeCommunityGitPath(communityId)],
        ]
      : [],
  )
</script>

<PageBar>
  {#snippet icon()}
    <div class="center">
      <Icon icon={HomeSmile} />
    </div>
  {/snippet}
  {#snippet title()}
    <strong>Community</strong>
  {/snippet}
</PageBar>

<PageContent class="content col-4 p-4">
  <CardButton class="btn-neutral">
    {#snippet title()}
      <div>Selected community</div>
    {/snippet}
    {#snippet info()}
      <div>{shortCommunity}</div>
    {/snippet}
  </CardButton>

  <div class="grid gap-2 sm:grid-cols-2">
    {#each navItems as [label, href]}
      <a {href} class="btn btn-neutral justify-start">{label}</a>
    {/each}
  </div>
</PageContent>
