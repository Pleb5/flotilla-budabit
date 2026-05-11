<script lang="ts">
  import {onMount} from "svelte"
  import {page} from "$app/stores"
  import {request} from "@welshman/net"
  import {pubkey, publishThunk, repository} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {ZAP_GOAL, makeEvent, getTagValue} from "@welshman/util"
  import {randomId} from "@welshman/lib"
  import Bolt from "@assets/icons/bolt.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import Button from "@lib/components/Button.svelte"
  import Field from "@lib/components/Field.svelte"
  import {preventDefault} from "@lib/html"
  import {pushToast} from "@app/util/toast"
  import {activeCommunityRelays} from "@app/core/community-state"
  import {TARGETED_PUBLICATION_KIND} from "@app/core/community"
  import {makeCommunityTargetingFilter, makeTargetedPublicationOriginalFilters} from "@app/core/community-feeds"
  import {
    makeTargetedPublicationForCommunity,
    withPublicationTargetingId,
  } from "@app/core/community-targeting"
  import {parseCommunityRouteParam} from "@app/util/routes"

  const parsedCommunity = $derived(parseCommunityRouteParam($page.params.community))
  const communityPubkey = $derived(parsedCommunity?.pubkey || "")
  const targetingFilters = $derived(
    communityPubkey ? [makeCommunityTargetingFilter(communityPubkey, [ZAP_GOAL])] : [],
  )
  const targetingEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: targetingFilters})),
  )
  const goalFilters = $derived(makeTargetedPublicationOriginalFilters($targetingEvents))
  const goals = $derived(deriveEventsAsc(deriveEventsById({repository, filters: goalFilters})))

  const createGoal = () => {
    if (!$pubkey || !communityPubkey || !title.trim() || !summary.trim()) return
    const relays = $activeCommunityRelays
    if (relays.length === 0) {
      pushToast({theme: "error", message: "Community relays are not loaded yet."})
      return
    }

    const targetingId = randomId()
    const goalEvent = makeEvent(
      ZAP_GOAL,
      withPublicationTargetingId(
        {
          content: title.trim(),
          tags: [
            ["summary", summary.trim()],
            ["amount", String(amount)],
            ["relays", relays[0]],
          ],
        },
        targetingId,
      ),
    )

    publishThunk({relays, event: goalEvent})
    publishThunk({
      relays,
      event: makeEvent(
        TARGETED_PUBLICATION_KIND,
        makeTargetedPublicationForCommunity({
          targetingId,
          originalKind: ZAP_GOAL,
          originalRef: undefined,
          communityPubkey,
          communityRelay: relays[0],
        }),
      ),
    })

    title = ""
    summary = ""
    pushToast({message: "Fundraiser published."})
  }

  let title = $state("")
  let summary = $state("")
  let amount = $state(1000)

  onMount(() => {
    if (!communityPubkey || $activeCommunityRelays.length === 0) return

    const controller = new AbortController()
    request({relays: $activeCommunityRelays, filters: targetingFilters, signal: controller.signal})

    return () => controller.abort()
  })

  $effect(() => {
    if ($activeCommunityRelays.length === 0 || goalFilters.length === 0) return

    const controller = new AbortController()
    request({relays: $activeCommunityRelays, filters: goalFilters, signal: controller.signal})

    return () => controller.abort()
  })
</script>

<PageBar>
  {#snippet icon()}
    <div class="center">
      <Icon icon={Bolt} />
    </div>
  {/snippet}
  {#snippet title()}
    <strong>Fundraisers</strong>
  {/snippet}
</PageBar>

<PageContent class="content col-4 p-4">
  <form class="card2 bg-alt col-3 p-4 shadow-md" onsubmit={preventDefault(createGoal)}>
    <strong>Create targeted fundraiser</strong>
    <Field>
      {#snippet label()}
        <p>Title</p>
      {/snippet}
      {#snippet input()}
        <input bind:value={title} class="input input-bordered w-full" type="text" />
      {/snippet}
    </Field>
    <Field>
      {#snippet label()}
        <p>Amount</p>
      {/snippet}
      {#snippet input()}
        <input bind:value={amount} class="input input-bordered w-full" min="1" type="number" />
      {/snippet}
    </Field>
    <Field>
      {#snippet label()}
        <p>Summary</p>
      {/snippet}
      {#snippet input()}
        <textarea bind:value={summary} class="textarea textarea-bordered" rows="4"></textarea>
      {/snippet}
    </Field>
    <div class="flex justify-end">
      <Button type="submit" class="btn btn-primary" disabled={!$pubkey || !title.trim() || !summary.trim()}>
        Create fundraiser
      </Button>
    </div>
  </form>

  <div class="col-2">
    {#each $goals as goal (goal.id)}
      <div class="card2 bg-alt p-4 shadow-md">
        <strong>{goal.content || "Untitled fundraiser"}</strong>
        <p class="text-sm opacity-70">Amount: {getTagValue("amount", goal.tags) || "unknown"} sats</p>
        <p class="whitespace-pre-wrap">{getTagValue("summary", goal.tags) || ""}</p>
      </div>
    {:else}
      <p class="py-8 text-center opacity-70">No targeted fundraisers found.</p>
    {/each}
  </div>
</PageContent>
