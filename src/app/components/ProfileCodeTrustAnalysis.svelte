<script lang="ts">
  import {pubkey as sessionPubkey} from "@welshman/app"
  import type {TrustedEvent} from "@welshman/util"
  import Git from "@assets/icons/git.svg?dataurl"
  import AltArrowDown from "@assets/icons/alt-arrow-down.svg?dataurl"
  import Refresh from "@assets/icons/refresh.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import InlinePopover from "@lib/components/InlinePopover.svelte"
  import Link from "@lib/components/Link.svelte"
  import ProfileCircle from "@app/components/ProfileCircle.svelte"
  import ProfileName from "@app/components/ProfileName.svelte"
  import ProfileDetail from "@app/components/ProfileDetail.svelte"
  import {pushModal} from "@app/util/modal"
  import {loadBudabitProfile} from "@app/core/profile-resolver"
  import {
    getProfileCodeTrustAnalysisKey,
    loadProfileCodeTrustAnalysis,
    profileCodeTrustAnalyses,
    type ProfileCodeTrustCollaborator,
    type ProfileCodeTrustCommunityContext,
    type ProfileCodeTrustInteractionDetail,
    type ProfileCodeTrustAnalysis,
  } from "@app/core/profile-collab-analysis"
  import type {CommunityDefinition} from "@app/core/community"
  import type {EffectiveCommunityReportState} from "@app/core/community-reports"

  type Props = {
    pubkey: string
    communityDefinition?: CommunityDefinition
    communityProfileListEvents?: TrustedEvent[]
    communityReportState?: EffectiveCommunityReportState
  }

  const {
    pubkey,
    communityDefinition,
    communityProfileListEvents = [],
    communityReportState,
  }: Props = $props()

  type MetricKey =
    | "maintainer-accepted"
    | "community-maintainer"
    | "community-collaborators"
    | "observed-authored"
    | "observed-maintainer"

  type CollaboratorPopoverKey =
    | `${string}:merged-target`
    | `${string}:merged-by-target`
    | `${string}:repos`

  type MetricCard = {
    key: MetricKey
    label: string
    value: number
    description: string
    details?: ProfileCodeTrustInteractionDetail[]
    collaborators?: ProfileCodeTrustCollaborator[]
  }

  let isOpen = $state(false)
  let loading = $state(false)
  let status = $state<string | null>(null)
  let analysis = $state<ProfileCodeTrustAnalysis | null>(null)
  let previousPubkey = $state(pubkey)
  let openMetricPopover = $state<MetricKey | null>(null)
  let openCollaboratorPopover = $state<CollaboratorPopoverKey | null>(null)
  let requestId = 0

  const cacheKey = $derived.by(() =>
    $sessionPubkey
      ? getProfileCodeTrustAnalysisKey($sessionPubkey, pubkey, communityDefinition?.pubkey || "")
      : "",
  )

  const cachedAnalysis = $derived.by(() =>
    cacheKey ? $profileCodeTrustAnalyses.get(cacheKey) || null : null,
  )

  const communityContextLabel = $derived.by(() =>
    communityDefinition ? "the active community" : "loaded community context",
  )
  const matchedCollaboratorLabel = "Community collaborators"
  const communityProfileRelays = $derived(communityDefinition?.relays || [])
  const analysisActionLabel = $derived.by(() => {
    if (analysis) return "Refresh analysis"
    if (loading) return "Analyzing"
    if (status) return "Retry analysis"

    return "Analyze code collaboration"
  })
  const metricCards = $derived.by<MetricCard[]>(() =>
    analysis
      ? [
          {
            key: "maintainer-accepted",
            label: "Maintainer-accepted PRs",
            value: analysis.maintainerAcceptedPullRequests,
            description:
              "Pull requests authored by this profile that were accepted by a repo owner or declared maintainer.",
            details: analysis.maintainerAcceptedPullRequestDetails,
          },
          {
            key: "community-maintainer",
            label: "Community-aligned author merges",
            value: analysis.communityAlignedMaintainerMerges,
            description: `Pull requests this profile merged where the author has evidence in ${communityContextLabel}.`,
            details: analysis.communityAlignedMaintainerMergeDetails,
          },
          {
            key: "community-collaborators",
            label: matchedCollaboratorLabel,
            value: analysis.communityCollaborators,
            description:
              "Distinct community-aligned actors involved in either direction of recent merged pull request work.",
            collaborators: analysis.collaborators.slice(0, 5),
          },
          {
            key: "observed-authored",
            label: "Observed authored PRs",
            value: analysis.authoredPullRequestCount,
            description:
              "All pull requests authored by this profile in the current analysis window, regardless of community or maintainer evidence.",
            details: analysis.authoredPullRequestDetails,
          },
          {
            key: "observed-maintainer",
            label: "Observed maintainer actions",
            value: analysis.maintainerActionCount,
            description:
              "Pull requests where this profile is the latest repo maintainer to apply the merge status.",
            details: analysis.maintainerActionDetails,
          },
        ]
      : [],
  )

  const openProfile = (pubkey: string) =>
    pushModal(ProfileDetail, {
      pubkey,
      url: communityProfileRelays[0],
      relays: communityProfileRelays,
    })

  const getRepoHref = (_repoAddress: string) => ""

  const getPrHref = (detail: ProfileCodeTrustInteractionDetail) => {
    const repoHref = getRepoHref(detail.repoAddress)

    return repoHref ? `${repoHref}/prs/${detail.rootId}` : ""
  }

  const loadProfiles = (pubkeys: Array<string | undefined>) => {
    for (const targetPubkey of pubkeys.filter(Boolean) as string[]) {
      loadBudabitProfile(targetPubkey, {communityRelays: communityProfileRelays}).catch(
        () => undefined,
      )
    }
  }

  const hydrateDetailProfiles = (details: ProfileCodeTrustInteractionDetail[] = []) => {
    loadProfiles(details.flatMap(detail => [detail.authorPubkey, detail.mergedByPubkey]))
  }

  const toggleMetricPopover = (metric: MetricCard) => {
    openCollaboratorPopover = null
    openMetricPopover = openMetricPopover === metric.key ? null : metric.key

    if (openMetricPopover !== metric.key) return

    if (metric.details) {
      hydrateDetailProfiles(metric.details)
    }

    if (metric.collaborators) {
      loadProfiles(metric.collaborators.map(collaborator => collaborator.pubkey))
    }
  }

  const toggleCollaboratorPopover = (
    collaborator: ProfileCodeTrustCollaborator,
    kind: "merged-target" | "merged-by-target" | "repos",
  ) => {
    const nextKey = `${collaborator.pubkey}:${kind}` as CollaboratorPopoverKey

    openMetricPopover = null
    openCollaboratorPopover = openCollaboratorPopover === nextKey ? null : nextKey

    if (openCollaboratorPopover !== nextKey) return

    if (kind === "merged-target") {
      hydrateDetailProfiles(collaborator.mergedTargetPullRequestDetails)
    }

    if (kind === "merged-by-target") {
      hydrateDetailProfiles(collaborator.mergedByTargetDetails)
    }
  }

  const getMetricPopoverButtonLabel = (metric: MetricCard) => {
    if (metric.key === "community-collaborators") {
      return metric.value === 1 ? "1 collaborator" : `${metric.value} collaborators`
    }

    if (metric.key === "observed-maintainer") {
      return metric.value === 1 ? "1 maintainer action" : `${metric.value} maintainer actions`
    }

    return metric.value === 1 ? "1 PR" : `${metric.value} PRs`
  }

  const getDetailContext = (metricKey: MetricKey, detail: ProfileCodeTrustInteractionDetail) => {
    if (metricKey === "community-maintainer" || metricKey === "observed-maintainer") {
      return {label: "Author", pubkey: detail.authorPubkey}
    }

    if (detail.mergedByPubkey) {
      return {label: "Merged by", pubkey: detail.mergedByPubkey}
    }

    return {label: "Status", text: "Not merged yet"}
  }

  const analyze = async (force = false) => {
    if (!$sessionPubkey) {
      status = "Sign in to analyze code collaboration activity."
      return
    }

    const currentRequest = ++requestId

    loading = true
    status = null

    try {
      const communityContext: ProfileCodeTrustCommunityContext | undefined = communityDefinition
        ? {
            communityPubkey: communityDefinition.pubkey,
            definitions: [communityDefinition],
            profileListEvents: communityProfileListEvents,
            reportState: communityReportState,
          }
        : undefined
      const result = await loadProfileCodeTrustAnalysis(pubkey, {force, communityContext})

      if (currentRequest !== requestId || result.targetPubkey !== pubkey) return

      analysis = result

      if (result.authoredPullRequestCount === 0 && result.maintainerActionCount === 0) {
        status = `No recent pull request activity found in the last ${result.windowDays} days.`
      } else if (
        result.maintainerAcceptedPullRequests === 0 &&
        result.communityAlignedMaintainerMerges === 0 &&
        result.communityCollaborators === 0
      ) {
        status = `No recent maintainer-accepted or community-aligned git collaborations found in the last ${result.windowDays} days.`
      }
    } catch (error: any) {
      if (currentRequest !== requestId) return

      status = error?.message || "Unable to analyze code collaboration right now."
    } finally {
      if (currentRequest === requestId) {
        loading = false
      }
    }
  }

  $effect(() => {
    if (cachedAnalysis && (!analysis || cachedAnalysis.analyzedAt > analysis.analyzedAt)) {
      analysis = cachedAnalysis
    }
  })

  $effect(() => {
    if (pubkey === previousPubkey) return

    previousPubkey = pubkey
    requestId += 1
    isOpen = false
    analysis = null
    status = null
    loading = false
    openMetricPopover = null
    openCollaboratorPopover = null
  })

  $effect(() => {
    if (isOpen) return

    openMetricPopover = null
    openCollaboratorPopover = null
  })
</script>

<div class="rounded-xl bg-base-200/50">
  <button
    type="button"
    class="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left sm:gap-3 sm:px-4 sm:py-3"
    onclick={() => (isOpen = !isOpen)}>
    <div class="flex flex-col gap-1">
      <span class="flex items-center gap-1.5 text-xs font-semibold sm:gap-2 sm:text-sm">
        <Icon icon={Git} /> Code collaboration activity
      </span>
      <span class="text-xs opacity-70">
        Recent pull requests, merges, and maintainer relationships connected to this profile.
      </span>
    </div>

    <div class="flex flex-wrap items-center justify-end gap-2 text-xs opacity-70">
      {#if analysis}
        <span class="badge badge-neutral badge-sm sm:badge-md"
          >{analysis.maintainerAcceptedPullRequests} accepted</span>
        <span class="badge badge-neutral badge-sm sm:badge-md"
          >{analysis.communityAlignedMaintainerMerges} community merges</span>
        <span class="badge badge-neutral badge-sm sm:badge-md"
          >{analysis.communityCollaborators} collaborators</span>
      {/if}
      <div class="transition-transform" class:rotate-180={isOpen}>
        <Icon icon={AltArrowDown} />
      </div>
    </div>
  </button>

  {#if isOpen}
    <div class="flex flex-col gap-3 border-t border-base-300/50 px-3 py-3 sm:gap-4 sm:px-4 sm:py-4">
      <div class="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <div class="text-xs opacity-70">
          Looks at recent public git activity and highlights work accepted by repo maintainers or
          connected to the active community.
        </div>

        <div class="flex flex-wrap gap-2">
          <Button
            type="button"
            class="btn btn-neutral btn-xs inline-flex items-center justify-center gap-1.5 sm:btn-sm sm:gap-2"
            disabled={loading}
            onclick={() => analyze(Boolean(analysis))}>
            {#if loading}
              <span class="loading loading-spinner loading-sm shrink-0"></span>
            {:else}
              <Icon icon={Refresh} size={4} class="shrink-0" />
            {/if}
            <span class="leading-none">{analysisActionLabel}</span>
          </Button>
          <Link href="/trust-model" class="btn btn-neutral btn-xs sm:btn-sm"
            >More about trust in BudaBit</Link>
        </div>
      </div>

      {#if !analysis && !loading && !status}
        <div class="rounded-box bg-base-100/40 p-2.5 text-xs opacity-75 sm:p-3">
          This deeper analysis runs only after you press Analyze code collaboration, so profile
          navigation stays responsive.
        </div>
      {/if}

      {#if status}
        <div class="rounded-box bg-base-100/40 p-2.5 text-xs opacity-80 sm:p-3 sm:text-sm">
          {status}
        </div>
      {/if}

      {#if analysis}
        <div class="grid gap-2 sm:grid-cols-2 sm:gap-3 xl:grid-cols-3">
          {#each metricCards as metric (metric.key)}
            <div class="rounded-box bg-base-100/40 p-2.5 sm:p-3">
              <div class="text-xs uppercase tracking-wide opacity-60">{metric.label}</div>
              <div class="mt-2 flex items-center gap-2">
                <div class="relative">
                  <button
                    type="button"
                    class="badge badge-neutral badge-sm cursor-pointer px-2 py-2 text-xs font-medium sm:badge-md sm:px-3 sm:py-3 sm:text-sm"
                    onclick={() => toggleMetricPopover(metric)}>
                    {metric.value}
                  </button>

                  {#if openMetricPopover === metric.key}
                    <InlinePopover
                      onClose={() => (openMetricPopover = null)}
                      align="left"
                      widthClass="w-80">
                      <div class="flex flex-col gap-3 text-sm">
                        <div>
                          <div class="font-medium">{metric.label}</div>
                          <div class="mt-1 text-xs opacity-70">{metric.description}</div>
                        </div>

                        <div class="text-xs opacity-60">
                          {getMetricPopoverButtonLabel(metric)} in the current {analysis.windowDays}-day
                          analysis window.
                        </div>

                        {#if metric.details && metric.details.length > 0}
                          <div class="flex flex-col gap-2">
                            {#each metric.details as detail (detail.rootId)}
                              {@const context = getDetailContext(metric.key, detail)}
                              {@const prHref = getPrHref(detail)}
                              {@const repoHref = getRepoHref(detail.repoAddress)}
                              <div class="rounded-box bg-base-200/50 p-3">
                                {#if prHref}
                                  <Link
                                    href={prHref}
                                    class="text-sm font-medium text-primary underline-offset-2 hover:underline">
                                    {detail.subject}
                                  </Link>
                                {:else}
                                  <div class="text-sm font-medium">{detail.subject}</div>
                                {/if}
                                <div class="mt-1 text-xs opacity-70">
                                  {#if repoHref}
                                    <Link
                                      href={repoHref}
                                      class="text-primary underline-offset-2 hover:underline">
                                      {detail.repoName}
                                    </Link>
                                  {:else}
                                    {detail.repoName}
                                  {/if}
                                </div>
                                <div class="mt-2 flex items-center gap-2 text-xs opacity-70">
                                  <span>{context.label}</span>
                                  {#if context.pubkey}
                                    <Button
                                      type="button"
                                      class="truncate p-0 text-xs font-medium"
                                      onclick={() => openProfile(context.pubkey)}>
                                      <ProfileName
                                        pubkey={context.pubkey}
                                        relays={communityProfileRelays} />
                                    </Button>
                                  {:else}
                                    <span>{context.text}</span>
                                  {/if}
                                </div>
                              </div>
                            {/each}
                          </div>
                        {:else if metric.collaborators && metric.collaborators.length > 0}
                          <div class="flex flex-col gap-2">
                            {#each metric.collaborators as collaborator (collaborator.pubkey)}
                              <div class="rounded-box bg-base-200/50 p-3">
                                <div class="flex min-w-0 items-center gap-3">
                                  <Button
                                    type="button"
                                    class="shrink-0 p-0"
                                    onclick={() => openProfile(collaborator.pubkey)}>
                                    <ProfileCircle
                                      pubkey={collaborator.pubkey}
                                      relays={communityProfileRelays}
                                      size={6} />
                                  </Button>
                                  <div class="min-w-0">
                                    <Button
                                      type="button"
                                      class="truncate p-0 text-sm font-medium"
                                      onclick={() => openProfile(collaborator.pubkey)}>
                                      <ProfileName
                                        pubkey={collaborator.pubkey}
                                        relays={communityProfileRelays} />
                                    </Button>
                                    <div class="text-xs opacity-70">
                                      {collaborator.totalInteractions} interaction{collaborator.totalInteractions ===
                                      1
                                        ? ""
                                        : "s"}
                                      across {collaborator.repoCount} repo{collaborator.repoCount ===
                                      1
                                        ? ""
                                        : "s"}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            {/each}
                          </div>
                        {:else}
                          <div class="text-xs opacity-60">
                            No activity captured for this metric in the current window.
                          </div>
                        {/if}
                      </div>
                    </InlinePopover>
                  {/if}
                </div>
                <span class="text-xs opacity-60">Click for meaning and activity</span>
              </div>
            </div>
          {/each}
        </div>

        {#if analysis.collaborators.length > 0}
          <div class="flex flex-col gap-2.5 border-t border-base-300/50 pt-3 sm:gap-3 sm:pt-4">
            <div class="flex items-center justify-between gap-2">
              <strong class="text-sm">{matchedCollaboratorLabel}</strong>
              <span class="text-xs opacity-60">Most active recent matches</span>
            </div>

            {#each analysis.collaborators.slice(0, 5) as collaborator (collaborator.pubkey)}
              <div class="rounded-box bg-base-100/40 p-2.5 sm:p-3">
                <div
                  class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                  <div class="flex min-w-0 gap-2 sm:gap-3">
                    <Button
                      type="button"
                      class="shrink-0 p-0"
                      onclick={() => openProfile(collaborator.pubkey)}>
                      <ProfileCircle
                        pubkey={collaborator.pubkey}
                        relays={communityProfileRelays}
                        size={7} />
                    </Button>
                    <div class="min-w-0">
                      <Button
                        type="button"
                        class="truncate p-0 text-sm font-medium"
                        onclick={() => openProfile(collaborator.pubkey)}>
                        <ProfileName pubkey={collaborator.pubkey} relays={communityProfileRelays} />
                      </Button>
                      <div class="text-xs opacity-60">
                        Recent community-aligned collaboration match
                      </div>
                    </div>
                  </div>

                  <div class="flex flex-wrap gap-2 text-xs sm:justify-end">
                    {#if collaborator.mergedTargetPullRequests > 0}
                      <div class="relative">
                        <button
                          type="button"
                          class="badge badge-neutral badge-sm cursor-pointer px-2 py-2 sm:badge-md sm:px-3 sm:py-3"
                          onclick={() => toggleCollaboratorPopover(collaborator, "merged-target")}>
                          {collaborator.mergedTargetPullRequests} merged target PRs
                        </button>

                        {#if openCollaboratorPopover === `${collaborator.pubkey}:merged-target`}
                          <InlinePopover
                            onClose={() => (openCollaboratorPopover = null)}
                            align="right"
                            widthClass="w-80">
                            <div class="flex flex-col gap-3 text-sm">
                              <div>
                                <div class="font-medium">Merged target PRs</div>
                                <div class="mt-1 text-xs opacity-70">
                                  Pull requests authored by this profile and merged by this
                                  community collaborator.
                                </div>
                              </div>

                              {#if collaborator.mergedTargetPullRequestDetails.length > 0}
                                <div class="flex flex-col gap-2">
                                  {#each collaborator.mergedTargetPullRequestDetails as detail (detail.rootId)}
                                    {@const prHref = getPrHref(detail)}
                                    {@const repoHref = getRepoHref(detail.repoAddress)}
                                    <div class="rounded-box bg-base-200/50 p-3">
                                      {#if prHref}
                                        <Link
                                          href={prHref}
                                          class="text-sm font-medium text-primary underline-offset-2 hover:underline">
                                          {detail.subject}
                                        </Link>
                                      {:else}
                                        <div class="text-sm font-medium">{detail.subject}</div>
                                      {/if}
                                      <div class="mt-1 text-xs opacity-70">
                                        {#if repoHref}
                                          <Link
                                            href={repoHref}
                                            class="text-primary underline-offset-2 hover:underline">
                                            {detail.repoName}
                                          </Link>
                                        {:else}
                                          {detail.repoName}
                                        {/if}
                                      </div>
                                    </div>
                                  {/each}
                                </div>
                              {:else}
                                <div class="text-xs opacity-60">
                                  No merged target PR examples in the current analysis window.
                                </div>
                              {/if}
                            </div>
                          </InlinePopover>
                        {/if}
                      </div>
                    {/if}

                    {#if collaborator.mergedByTarget > 0}
                      <div class="relative">
                        <button
                          type="button"
                          class="badge badge-neutral badge-sm cursor-pointer px-2 py-2 sm:badge-md sm:px-3 sm:py-3"
                          onclick={() =>
                            toggleCollaboratorPopover(collaborator, "merged-by-target")}>
                          {collaborator.mergedByTarget} merged by target
                        </button>

                        {#if openCollaboratorPopover === `${collaborator.pubkey}:merged-by-target`}
                          <InlinePopover
                            onClose={() => (openCollaboratorPopover = null)}
                            align="right"
                            widthClass="w-80">
                            <div class="flex flex-col gap-3 text-sm">
                              <div>
                                <div class="font-medium">Merged by target</div>
                                <div class="mt-1 text-xs opacity-70">
                                  Pull requests authored by this collaborator and merged by the
                                  target profile.
                                </div>
                              </div>

                              {#if collaborator.mergedByTargetDetails.length > 0}
                                <div class="flex flex-col gap-2">
                                  {#each collaborator.mergedByTargetDetails as detail (detail.rootId)}
                                    {@const prHref = getPrHref(detail)}
                                    {@const repoHref = getRepoHref(detail.repoAddress)}
                                    <div class="rounded-box bg-base-200/50 p-3">
                                      {#if prHref}
                                        <Link
                                          href={prHref}
                                          class="text-sm font-medium text-primary underline-offset-2 hover:underline">
                                          {detail.subject}
                                        </Link>
                                      {:else}
                                        <div class="text-sm font-medium">{detail.subject}</div>
                                      {/if}
                                      <div class="mt-1 text-xs opacity-70">
                                        {#if repoHref}
                                          <Link
                                            href={repoHref}
                                            class="text-primary underline-offset-2 hover:underline">
                                            {detail.repoName}
                                          </Link>
                                        {:else}
                                          {detail.repoName}
                                        {/if}
                                      </div>
                                    </div>
                                  {/each}
                                </div>
                              {:else}
                                <div class="text-xs opacity-60">
                                  No target-merged PR examples in the current analysis window.
                                </div>
                              {/if}
                            </div>
                          </InlinePopover>
                        {/if}
                      </div>
                    {/if}

                    <div class="relative">
                      <button
                        type="button"
                        class="badge badge-neutral badge-sm cursor-pointer px-2 py-2 sm:badge-md sm:px-3 sm:py-3"
                        onclick={() => toggleCollaboratorPopover(collaborator, "repos")}>
                        {collaborator.repoCount} repos
                      </button>

                      {#if openCollaboratorPopover === `${collaborator.pubkey}:repos`}
                        <InlinePopover
                          onClose={() => (openCollaboratorPopover = null)}
                          align="right"
                          widthClass="w-72">
                          <div class="flex flex-col gap-3 text-sm">
                            <div>
                              <div class="font-medium">Common repos</div>
                              <div class="mt-1 text-xs opacity-70">
                                Repositories where this collaborator has recent matched activity
                                with the target profile.
                              </div>
                            </div>

                            {#if collaborator.repoDetails.length > 0}
                              <div class="flex flex-col gap-2">
                                {#each collaborator.repoDetails as repoDetail (repoDetail.repoAddress)}
                                  {@const repoHref = getRepoHref(repoDetail.repoAddress)}
                                  <div class="rounded-box bg-base-200/50 p-3">
                                    {#if repoHref}
                                      <Link
                                        href={repoHref}
                                        class="text-sm font-medium text-primary underline-offset-2 hover:underline">
                                        {repoDetail.repoName}
                                      </Link>
                                    {:else}
                                      <div class="text-sm font-medium">{repoDetail.repoName}</div>
                                    {/if}
                                    <div class="mt-1 text-xs opacity-70">
                                      {repoDetail.count} interaction{repoDetail.count === 1
                                        ? ""
                                        : "s"}
                                    </div>
                                  </div>
                                {/each}
                              </div>
                            {:else}
                              <div class="text-xs opacity-60">
                                No repository overlap captured in the current analysis window.
                              </div>
                            {/if}
                          </div>
                        </InlinePopover>
                      {/if}
                    </div>
                  </div>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      {/if}
    </div>
  {/if}
</div>
