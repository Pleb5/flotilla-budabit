<script lang="ts">
  import {page} from "$app/stores"
  import {pubkey, publishThunk, repository} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {makeEvent, getTagValue, type Filter} from "@welshman/util"
  import {randomId} from "@welshman/lib"
  import LinkRound from "@assets/icons/link-round.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
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
    activeExactCommunityRelays,
    activeExactCommunityPublishRelays,
    activeCommunityReportState,
    activeExactCommunityPointer,
  } from "@app/core/community-state"
  import {TARGETED_PUBLICATION_KIND} from "@app/core/community"
  import {
    GIT_PERMALINK_KIND,
    makeCommunityContentFilterPlan,
    makeCommunityTargetingFilter,
    makeTargetedPublicationOriginalFilterPlan,
    makeTargetedPublicationOriginalRelayHintPlans,
  } from "@app/core/community-feeds"
  import {
    makeTargetedPublicationForCommunity,
    withPublicationTargetingId,
  } from "@app/core/community-targeting"
  import {
    COMMUNITY_WRITE_TARGETS,
    canWriteCommunityTarget,
    filterAuthorizedCommunityTargetingEvents,
    getCommunityWriteTargetSectionName,
    getCommunityTargetWriterPubkeys,
  } from "@app/core/community-permissions"
  import {RELAY_REQUEST_PRIORITY} from "@app/core/relay-policy"
  import {loadBoundedCommunityHistory} from "@app/core/requests"
  import {parseExactCommunityRouteParam} from "@app/util/routes"

  const routeCommunity = $derived(parseExactCommunityRouteParam($page.params.community))
  const communityPubkey = $derived(routeCommunity?.ownerPubkey || "")
  const communityId = $derived(routeCommunity?.communityId || "")
  const communityAddress = $derived(routeCommunity?.address || "")
  const communityDefinition = $derived(
    $activeExactCommunityDefinition?.pointer.address === communityAddress &&
      $activeExactCommunityDefinition.ownerPubkey === communityPubkey
      ? $activeExactCommunityDefinition
      : undefined,
  )
  const communityBootstrapReady = $derived(
    Boolean(
      communityPubkey &&
      communityDefinition &&
      $activeCommunityBootstrapStatus.loaded &&
      !$activeCommunityBootstrapStatus.loading,
    ),
  )
  const communityBootstrapLoading = $derived(
    Boolean(communityPubkey && !communityBootstrapReady && !$activeCommunityBootstrapStatus.error),
  )
  const communityBootstrapFailed = $derived(
    Boolean(communityPubkey && !communityBootstrapReady && $activeCommunityBootstrapStatus.error),
  )
  const communityAuthorityReadiness = $derived(
    $activeCommunityDescriptor?.community.address === communityAddress
      ? $activeCommunityDescriptor.authorityReadiness.state
      : "loading",
  )
  const communityAuthorityLoading = $derived(
    communityBootstrapReady && communityAuthorityReadiness === "loading",
  )
  const communityAuthorityReady = $derived(
    communityBootstrapReady && communityAuthorityReadiness === "ready",
  )
  const communityAuthorityUnavailable = $derived(communityAuthorityReadiness === "unavailable")
  const targetingFilters = $derived(
    communityAuthorityReady && $activeExactCommunityPointer
      ? [
          makeCommunityTargetingFilter($activeExactCommunityPointer.communityId, [
            GIT_PERMALINK_KIND,
          ]),
        ]
      : [],
  )
  const permalinkAuthorPubkeys = $derived(
    communityAuthorityReady && communityDefinition
      ? getCommunityTargetWriterPubkeys({
          definition: communityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          target: COMMUNITY_WRITE_TARGETS.permalink,
          reportState: $activeCommunityReportState,
        })
      : [],
  )
  const targetingFilterPlan = $derived(
    communityAuthorityReady
      ? makeCommunityContentFilterPlan(targetingFilters, permalinkAuthorPubkeys)
      : {relayFilters: [], localFilters: []},
  )
  const targetingEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: targetingFilterPlan.localFilters})),
  )
  const authorizedTargetingEvents = $derived.by(() =>
    communityAuthorityReady && communityDefinition && $activeExactCommunityPointer
      ? filterAuthorizedCommunityTargetingEvents({
          community: $activeExactCommunityPointer,
          definition: communityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          events: $targetingEvents,
          reportState: $activeCommunityReportState,
          kinds: [GIT_PERMALINK_KIND],
        })
      : [],
  )
  const targetedPermalinkFilterPlan = $derived(
    makeTargetedPublicationOriginalFilterPlan(authorizedTargetingEvents),
  )
  const targetedPermalinkRelayHintPlans = $derived(
    makeTargetedPublicationOriginalRelayHintPlans(authorizedTargetingEvents),
  )
  const directPermalinkFilterPlan = $derived(
    communityAuthorityReady && communityId
      ? makeCommunityContentFilterPlan(
          [{kinds: [GIT_PERMALINK_KIND], "#h": [communityId]}],
          permalinkAuthorPubkeys,
        )
      : {relayFilters: [], localFilters: []},
  )
  const permalinkFilterPlan = $derived({
    relayFilters: [
      ...directPermalinkFilterPlan.relayFilters,
      ...targetedPermalinkFilterPlan.relayFilters,
    ] as Filter[],
    localFilters: [
      ...directPermalinkFilterPlan.localFilters,
      ...targetedPermalinkFilterPlan.localFilters,
    ] as Filter[],
  })
  const permalinkFilters = $derived(permalinkFilterPlan.localFilters)
  const permalinkRelayFilters = $derived(permalinkFilterPlan.relayFilters)
  const permalinks = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: permalinkFilters})),
  )
  const canCreatePermalink = $derived(
    Boolean(
      $pubkey &&
      communityAuthorityReady &&
      communityDefinition &&
      canWriteCommunityTarget({
        definition: communityDefinition,
        profileListEvents: $activeCommunityProfileListEvents,
        userPubkey: $pubkey,
        target: COMMUNITY_WRITE_TARGETS.permalink,
        reportState: $activeCommunityReportState,
      }),
    ),
  )
  const permalinkSectionName = $derived(
    getCommunityWriteTargetSectionName(
      communityAuthorityReady ? communityDefinition : undefined,
      COMMUNITY_WRITE_TARGETS.permalink,
    ),
  )
  const permalinkAccessMessage = $derived(
    `Request ${permalinkSectionName} access to publish permalinks.`,
  )

  const createPermalink = () => {
    if (!$pubkey || !communityId || !repo.trim() || !file.trim() || !commit.trim()) return
    if (!canCreatePermalink) {
      pushToast({theme: "error", message: permalinkAccessMessage})
      return
    }
    const relays = $activeExactCommunityPublishRelays
    if (relays.length === 0) {
      pushToast({theme: "error", message: "Community relays are not loaded yet."})
      return
    }

    const targetingId = randomId()
    publishThunk({
      relays,
      event: makeEvent(
        GIT_PERMALINK_KIND,
        withPublicationTargetingId(
          {
            content: description.trim(),
            tags: [
              ["repo", repo.trim()],
              ["file", file.trim()],
              ["commit", commit.trim()],
              ...(line.trim() ? [["line", line.trim()]] : []),
            ],
          },
          targetingId,
        ),
      ),
    })
    publishThunk({
      relays,
      event: makeEvent(
        TARGETED_PUBLICATION_KIND,
        makeTargetedPublicationForCommunity({
          targetingId,
          originalKind: GIT_PERMALINK_KIND,
          originalRef: undefined,
          community: $activeExactCommunityPointer!,
        }),
      ),
    })

    repo = ""
    file = ""
    commit = ""
    line = ""
    description = ""
    pushToast({message: "Permalink published."})
  }

  let repo = $state("")
  let file = $state("")
  let commit = $state("")
  let line = $state("")
  let description = $state("")
  let loadingTargets = $state(false)
  let targetLoadStatus = $state<"idle" | "loading" | "complete" | "incomplete" | "failed">("idle")
  let loadingHintedOriginals = $state(false)
  let loadingPermalinks = $state(false)
  let permalinkLoadStatus = $state<"idle" | "loading" | "complete" | "incomplete" | "failed">(
    "idle",
  )
  let historicalLoadRetryVersion = $state(0)
  const permalinksLoading = $derived(
    !communityBootstrapFailed &&
      !communityAuthorityUnavailable &&
      (communityBootstrapLoading ||
        communityAuthorityLoading ||
        loadingTargets ||
        loadingHintedOriginals ||
        loadingPermalinks ||
        targetLoadStatus === "idle" ||
        (permalinkFilters.length > 0 &&
          permalinkLoadStatus === "idle" &&
          $permalinks.length === 0)),
  )
  const retryHistoricalLoad = () => {
    if (communityBootstrapFailed || communityAuthorityUnavailable) {
      window.location.reload()
      return
    }
    historicalLoadRetryVersion += 1
  }

  $effect(() => {
    void historicalLoadRetryVersion
    const relays = $activeExactCommunityRelays
    const relayFilters = targetingFilterPlan.relayFilters
    const localFilters = targetingFilterPlan.localFilters

    if (!communityBootstrapReady || !communityPubkey) {
      loadingTargets = false
      targetLoadStatus = "idle"
      return
    }
    if (relayFilters.length === 0 || localFilters.length === 0) {
      loadingTargets = false
      targetLoadStatus = "complete"
      return
    }
    if (relays.length === 0) {
      loadingTargets = false
      targetLoadStatus = "incomplete"
      return
    }

    const controller = new AbortController()
    loadingTargets = true
    targetLoadStatus = "loading"
    void loadBoundedCommunityHistory({
      relays,
      relayFilters,
      localFilters,
      priority: RELAY_REQUEST_PRIORITY.interactive,
      owner: `community-permalink-targets:${communityPubkey}`,
      signal: controller.signal,
    })
      .then(result => {
        if (controller.signal.aborted) return
        targetLoadStatus = result.complete ? "complete" : "incomplete"
      })
      .catch(error => {
        if (controller.signal.aborted) return
        console.warn("[community-permalinks] Failed to load targeting history", error)
        targetLoadStatus = "failed"
      })
      .finally(() => {
        if (controller.signal.aborted) return
        loadingTargets = false
      })

    return () => controller.abort()
  })

  $effect(() => {
    void historicalLoadRetryVersion
    const plans = targetedPermalinkRelayHintPlans

    if (!communityBootstrapReady) {
      loadingHintedOriginals = false
      return
    }
    if (plans.length === 0) {
      loadingHintedOriginals = false
      return
    }

    const controller = new AbortController()
    loadingHintedOriginals = true
    void Promise.all(
      plans.map(plan =>
        loadBoundedCommunityHistory({
          ...plan,
          priority: RELAY_REQUEST_PRIORITY.interactive,
          owner: `community-permalink-target-originals:${communityPubkey}`,
          signal: controller.signal,
        }),
      ),
    )
      .catch(error => {
        if (controller.signal.aborted) return
        console.warn("[community-permalinks] Failed to load hinted permalink originals", error)
      })
      .finally(() => {
        if (!controller.signal.aborted) loadingHintedOriginals = false
      })

    return () => controller.abort()
  })

  $effect(() => {
    void historicalLoadRetryVersion
    const relays = $activeExactCommunityRelays

    if (!communityBootstrapReady) {
      loadingPermalinks = false
      permalinkLoadStatus = "idle"
      return
    }
    if (permalinkRelayFilters.length === 0 || permalinkFilters.length === 0) {
      loadingPermalinks = false
      permalinkLoadStatus = "complete"
      return
    }
    if (relays.length === 0) {
      loadingPermalinks = false
      permalinkLoadStatus = "incomplete"
      return
    }

    const controller = new AbortController()
    loadingPermalinks = true
    permalinkLoadStatus = "loading"
    void loadBoundedCommunityHistory({
      relays,
      relayFilters: permalinkRelayFilters,
      localFilters: permalinkFilters,
      priority: RELAY_REQUEST_PRIORITY.interactive,
      owner: `community-permalinks:${communityPubkey}`,
      signal: controller.signal,
    })
      .then(result => {
        if (controller.signal.aborted) return
        permalinkLoadStatus = result.complete ? "complete" : "incomplete"
      })
      .catch(error => {
        if (controller.signal.aborted) return
        console.warn("[community-permalinks] Failed to load permalink history", error)
        permalinkLoadStatus = "failed"
      })
      .finally(() => {
        if (controller.signal.aborted) return
        loadingPermalinks = false
      })

    return () => controller.abort()
  })
</script>

<PageBar>
  {#snippet icon()}
    <div class="center"><Icon icon={LinkRound} /></div>
  {/snippet}
  {#snippet title()}<strong>Permalinks</strong>{/snippet}
  {#snippet action()}
    <CommunityMenuButton community={routeCommunity?.naddr} />
  {/snippet}
</PageBar>

<PageContent class="content col-4 p-4">
  <form class="card2 bg-alt col-3 p-4 shadow-md" onsubmit={preventDefault(createPermalink)}>
    <strong>Create targeted permalink</strong>
    <Field
      >{#snippet label()}<p>Repo address</p>{/snippet}{#snippet input()}<input
          bind:value={repo}
          class="input input-bordered w-full" />{/snippet}</Field>
    <Field
      >{#snippet label()}<p>File</p>{/snippet}{#snippet input()}<input
          bind:value={file}
          class="input input-bordered w-full" />{/snippet}</Field>
    <Field
      >{#snippet label()}<p>Commit</p>{/snippet}{#snippet input()}<input
          bind:value={commit}
          class="input input-bordered w-full" />{/snippet}</Field>
    <Field
      >{#snippet label()}<p>Line</p>{/snippet}{#snippet input()}<input
          bind:value={line}
          class="input input-bordered w-full" />{/snippet}</Field>
    <Field
      >{#snippet label()}<p>Description</p>{/snippet}{#snippet input()}<textarea
          bind:value={description}
          class="textarea textarea-bordered"
          rows="3"></textarea
        >{/snippet}</Field>
    <div class="flex justify-end">
      <PublishGate
        target={COMMUNITY_WRITE_TARGETS.permalink}
        action="publish permalinks"
        submit
        disabled={!repo.trim() || !file.trim() || !commit.trim()}>
        Publish permalink
      </PublishGate>
    </div>
  </form>

  <div class="col-2">
    {#each $permalinks as permalink (permalink.id)}
      <div class="card2 bg-alt p-4 shadow-md">
        <strong>{getTagValue("file", permalink.tags) || "Permalink"}</strong>
        <p class="break-all text-xs opacity-60">{getTagValue("repo", permalink.tags) || ""}</p>
        <p class="text-sm opacity-70">
          {getTagValue("commit", permalink.tags) || ""}{getTagValue("line", permalink.tags)
            ? `:${getTagValue("line", permalink.tags)}`
            : ""}
        </p>
        {#if permalink.content}<p class="whitespace-pre-wrap">{permalink.content}</p>{/if}
      </div>
    {:else}
      <p class="py-8 text-center opacity-70">
        {#if permalinksLoading}
          <Spinner loading>Looking for permalinks...</Spinner>
        {:else if communityBootstrapFailed || communityAuthorityUnavailable}
          <span class="flex flex-col items-center gap-3">
            Permalinks unavailable.
            <button class="btn btn-neutral btn-sm" type="button" onclick={retryHistoricalLoad}
              >Retry</button>
          </span>
        {:else}
          No community permalinks found.
        {/if}
      </p>
    {/each}
  </div>
</PageContent>
