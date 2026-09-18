<script lang="ts">
  import {goto} from "$app/navigation"
  import {page} from "$app/stores"
  import {pubkey} from "@welshman/app"
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
    activeCommunityBootstrapStatus,
    activeCommunityDescriptor,
    activeExactCommunityDefinition,
    activeCommunityProfileListEvents,
    activeExactCommunityPublishRelays,
    activeCommunityReportState,
  } from "@app/core/community-state"
  import {TARGETED_PUBLICATION_KIND, normalizeRelays} from "@app/core/community"
  import {
    makeTargetedPublicationForCommunity,
    makeCommunityTargetedPublicationSemanticKey,
    withPublicationTargetingId,
  } from "@app/core/community-targeting"
  import {
    COMMUNITY_WRITE_TARGETS,
    canWriteCommunityTarget,
    getCommunityWriteTargetSectionName,
  } from "@app/core/community-permissions"
  import {startLinkedPublication} from "@app/core/publication-operations"
  import {makeExactCommunityGoalPath, parseExactCommunityRouteParam} from "@app/util/routes"

  const routeCommunity = $derived(parseExactCommunityRouteParam($page.params.community))
  const communityOwnerPubkey = $derived(routeCommunity?.ownerPubkey || "")
  const communityId = $derived(routeCommunity?.communityId || "")
  const communityAddress = $derived(routeCommunity?.address || "")
  const communityDefinition = $derived(
    $activeExactCommunityDefinition?.pointer.address === communityAddress
      ? $activeExactCommunityDefinition
      : undefined,
  )
  const goalsPath = $derived(routeCommunity ? makeExactCommunityGoalPath(routeCommunity) : "")
  const communityBootstrapReady = $derived(
    Boolean(
      communityAddress &&
      communityDefinition &&
      $activeCommunityBootstrapStatus.loaded &&
      !$activeCommunityBootstrapStatus.loading,
    ),
  )
  const communityAuthorityReadiness = $derived(
    $activeCommunityDescriptor?.community.address === communityAddress
      ? $activeCommunityDescriptor.authorityReadiness.state
      : "loading",
  )
  const communityReady = $derived(
    communityBootstrapReady && communityAuthorityReadiness === "ready",
  )
  const goalSectionName = $derived(
    getCommunityWriteTargetSectionName(
      communityReady ? communityDefinition : undefined,
      COMMUNITY_WRITE_TARGETS.goal,
    ),
  )
  const goalAccessMessage = $derived(`Request ${goalSectionName} access to publish goals.`)
  const canCreateGoal = $derived(
    Boolean(
      $pubkey &&
      communityReady &&
      communityDefinition &&
      canWriteCommunityTarget({
        definition: communityDefinition,
        profileListEvents: $activeCommunityProfileListEvents,
        userPubkey: $pubkey,
        target: COMMUNITY_WRITE_TARGETS.goal,
        reportState: $activeCommunityReportState,
      }),
    ),
  )

  let title = $state("")
  let summary = $state("")
  let amount = $state(1000)
  let publishing = $state(false)

  const createGoal = async () => {
    const trimmedTitle = title.trim()
    const trimmedSummary = summary.trim()
    if (
      publishing ||
      !$pubkey ||
      !routeCommunity ||
      !communityId ||
      !trimmedTitle ||
      !trimmedSummary
    )
      return

    if (!communityReady) {
      pushToast({
        theme: "error",
        message:
          communityAuthorityReadiness === "unavailable"
            ? "Goals unavailable."
            : "Goals are still loading.",
      })
      return
    }
    if (!canCreateGoal) {
      pushToast({theme: "error", message: goalAccessMessage})
      return
    }

    const relays = normalizeRelays($activeExactCommunityPublishRelays)
    if (relays.length === 0) {
      pushToast({theme: "error", message: "Community relays are not loaded yet."})
      return
    }

    const targetingId = randomId()
    const community = routeCommunity

    publishing = true

    try {
      startLinkedPublication({
        event: makeEvent(
          ZAP_GOAL,
          withPublicationTargetingId(
            {
              content: trimmedTitle,
              tags: [
                ["summary", trimmedSummary],
                ["amount", String(amount)],
                ["relays", ...relays],
              ],
            },
            targetingId,
          ),
        ),
        relays,
        targetEvent: () =>
          makeEvent(
            TARGETED_PUBLICATION_KIND,
            makeTargetedPublicationForCommunity({
              targetingId,
              originalKind: ZAP_GOAL,
              originalRef: undefined,
              community,
            }),
          ),
        label: "Community goal",
        href: goalsPath,
        semanticKey: makeCommunityTargetedPublicationSemanticKey(communityAddress, ZAP_GOAL),
        preview: "retain-on-failure",
      })
    } catch (error) {
      pushToast({
        theme: "error",
        message: error instanceof Error ? error.message : "Failed to start goal publication.",
      })
      return
    } finally {
      publishing = false
    }

    pushToast({message: "Goal publication started."})
    if (goalsPath) await goto(goalsPath)
  }
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
    <CommunityMenuButton community={routeCommunity?.naddr} />
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
        disabled={publishing || !title.trim() || !summary.trim()}>
        {publishing ? "Publishing..." : "Create goal"}
      </PublishGate>
    </div>
  </form>
</PageContent>
