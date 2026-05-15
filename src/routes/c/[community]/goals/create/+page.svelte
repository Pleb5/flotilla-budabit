<script lang="ts">
  import {goto} from "$app/navigation"
  import {page} from "$app/stores"
  import {pubkey, publishThunk} from "@welshman/app"
  import {randomId} from "@welshman/lib"
  import {ZAP_GOAL, makeEvent} from "@welshman/util"
  import AltArrowLeft from "@assets/icons/alt-arrow-left.svg?dataurl"
  import Bolt from "@assets/icons/bolt.svg?dataurl"
  import NotesMinimalistic from "@assets/icons/notes-minimalistic.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import Field from "@lib/components/Field.svelte"
  import CommunityMenuButton from "@app/components/CommunityMenuButton.svelte"
  import PublishGate from "@app/components/community/PublishGate.svelte"
  import {preventDefault} from "@lib/html"
  import {pushToast} from "@app/util/toast"
  import {
    activeCommunityDefinition,
    activeCommunityProfileListEvents,
    activeCommunityRelays,
    getUserOutboxRelays,
  } from "@app/core/community-state"
  import {TARGETED_PUBLICATION_KIND, normalizeRelays} from "@app/core/community"
  import {
    makeTargetedPublicationForCommunity,
    withPublicationTargetingId,
  } from "@app/core/community-targeting"
  import {COMMUNITY_WRITE_TARGETS, canWriteCommunityTarget} from "@app/core/community-permissions"
  import {makeCommunityPath, parseCommunityRouteParam} from "@app/util/routes"

  const parsedCommunity = $derived(parseCommunityRouteParam($page.params.community))
  const communityPubkey = $derived(parsedCommunity?.pubkey || "")
  const goalsPath = $derived(communityPubkey ? makeCommunityPath(communityPubkey, "goals") : "")
  const canCreateGoal = $derived(
    Boolean(
      $pubkey &&
        $activeCommunityDefinition &&
        canWriteCommunityTarget({
          definition: $activeCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          userPubkey: $pubkey,
          target: COMMUNITY_WRITE_TARGETS.goal,
        }),
    ),
  )

  const createGoal = () => {
    const trimmedTitle = title.trim()
    const trimmedSummary = summary.trim()
    if (!$pubkey || !communityPubkey || !trimmedTitle || !trimmedSummary) return
    if (!canCreateGoal) {
      pushToast({theme: "error", message: "You do not have permission to publish goals."})
      return
    }

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
          content: trimmedTitle,
          tags: [
            ["summary", trimmedSummary],
            ["amount", String(amount)],
            ["relays", relays[0]],
          ],
        },
        targetingId,
      ),
    )
    const originalRelays = normalizeRelays([...getUserOutboxRelays(), ...relays])

    publishThunk({relays: originalRelays.length ? originalRelays : relays, event: goalEvent})
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

    pushToast({message: "Goal published."})
    if (goalsPath) goto(goalsPath)
  }

  let title = $state("")
  let summary = $state("")
  let amount = $state(1000)
</script>

<PageBar>
  {#snippet icon()}
    <div>
      <a href={goalsPath || "#"} class="btn btn-neutral btn-sm">
        <Icon icon={AltArrowLeft} />
      </a>
    </div>
  {/snippet}
  {#snippet title()}
    <strong>Create a Goal</strong>
  {/snippet}
  {#snippet action()}
    <CommunityMenuButton community={communityPubkey} />
  {/snippet}
</PageBar>

<PageContent class="content col-4 p-4">
  <form class="card2 bg-alt col-3 p-4 shadow-md" onsubmit={preventDefault(createGoal)}>
    <strong>Create funding goal</strong>
    <Field>
      {#snippet label()}
        <p>Title</p>
      {/snippet}
      {#snippet input()}
        <label class="input input-bordered flex w-full items-center gap-2">
          <Icon icon={NotesMinimalistic} />
          <input bind:value={title} class="grow" type="text" />
        </label>
      {/snippet}
    </Field>
    <Field>
      {#snippet label()}
        <p>Goal amount (sats)</p>
      {/snippet}
      {#snippet input()}
        <label class="input input-bordered flex w-full items-center gap-2">
          <Icon icon={Bolt} />
          <input bind:value={amount} class="grow" min="1" type="number" />
        </label>
      {/snippet}
    </Field>
    <Field>
      {#snippet label()}
        <p>Details</p>
      {/snippet}
      {#snippet input()}
        <textarea bind:value={summary} class="textarea textarea-bordered" rows="8"></textarea>
      {/snippet}
    </Field>
    <div class="flex justify-end">
      <PublishGate
        target={COMMUNITY_WRITE_TARGETS.goal}
        action="publish goals"
        submit
        disabled={!title.trim() || !summary.trim()}>
        Create goal
      </PublishGate>
    </div>
  </form>
</PageContent>
