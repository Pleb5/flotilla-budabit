<script lang="ts">
  import {loadProfile, pubkey as sessionPubkey} from "@welshman/app"
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
  import {
    PROFILE_CODE_TRUST_WINDOW_DAYS,
    getProfileCodeTrustAnalysisKey,
    loadProfileCodeTrustAnalysis,
    profileCodeTrustAnalyses,
    type ProfileCodeTrustCollaborator,
    type ProfileCodeTrustInteractionDetail,
    type ProfileCodeTrustAnalysis,
  } from "@app/core/profile-collab-analysis"
  import {getTrustGraphSourceLabel} from "@app/core/trust-graph"
  import {hasEnabledTrustGraphRules, userTrustGraphConfigValues} from "@app/core/trust-graph-config"

  type Props = {
    pubkey: string
  }

  const {pubkey}: Props = $props()

  type MetricKey =
    | "overlay-merged"
    | "overlay-maintainer"
    | "overlay-collaborators"
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
    $sessionPubkey ? getProfileCodeTrustAnalysisKey($sessionPubkey, pubkey) : "",
  )

  const cachedAnalysis = $derived.by(() =>
    cacheKey ? $profileCodeTrustAnalyses.get(cacheKey) || null : null,
  )

  const graphSourceLabel = $derived.by(() =>
    getTrustGraphSourceLabel(analysis?.graphSource || "direct_social"),
  )
  const hasGraphAdjustments = $derived.by(() =>
    hasEnabledTrustGraphRules($userTrustGraphConfigValues),
  )
  const isDirectSocialAnalysis = $derived.by(
    () => (analysis?.graphSource || "direct_social") === "direct_social",
  )
  const matchedActorPhrase = $derived.by(() =>
    isDirectSocialAnalysis ? "people you follow" : "people matched by your direct overlay rules",
  )
  const matchedCollaboratorLabel = $derived.by(() =>
    isDirectSocialAnalysis ? "Direct-follow collaborators" : "Overlay-matched collaborators",
  )
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
            key: "overlay-merged",
            label: isDirectSocialAnalysis
              ? "Direct-follow merged PRs"
              : "Overlay-matched merged PRs",
            value: analysis.overlayMatchedMergedPullRequests,
            description: `Pull requests authored by this profile that were merged by ${matchedActorPhrase}.`,
            details: analysis.overlayMatchedMergedPullRequestDetails,
          },
          {
            key: "overlay-maintainer",
            label: isDirectSocialAnalysis
              ? "Direct-follow author merges"
              : "Overlay-matched author merges",
            value: analysis.overlayMatchedMaintainerMerges,
            description: `Pull requests this profile merged where the author is among ${matchedActorPhrase}.`,
            details: analysis.overlayMatchedMaintainerMergeDetails,
          },
          {
            key: "overlay-collaborators",
            label: matchedCollaboratorLabel,
            value: analysis.overlayMatchedCollaborators,
            description: `Distinct ${matchedActorPhrase} involved in either direction of recent merged pull request work.`,
            collaborators: analysis.collaborators.slice(0, 5),
          },
          {
            key: "observed-authored",
            label: "Observed authored PRs",
            value: analysis.authoredPullRequestCount,
            description:
              "All pull requests authored by this profile in the current analysis window, regardless of overlay match.",
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

  const openProfile = (pubkey: string) => pushModal(ProfileDetail, {pubkey})

  const getRepoHref = (_repoAddress: string) => ""

  const getPrHref = (detail: ProfileCodeTrustInteractionDetail) => {
    const repoHref = getRepoHref(detail.repoAddress)

    return repoHref ? `${repoHref}/prs/${detail.rootId}` : ""
  }

  const loadProfiles = (pubkeys: Array<string | undefined>) => {
    for (const targetPubkey of pubkeys.filter(Boolean) as string[]) {
      loadProfile(targetPubkey).catch(() => undefined)
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
    if (metric.key === "overlay-collaborators") {
      return metric.value === 1 ? "1 collaborator" : `${metric.value} collaborators`
    }

    if (metric.key === "observed-maintainer") {
      return metric.value === 1 ? "1 maintainer action" : `${metric.value} maintainer actions`
    }

    return metric.value === 1 ? "1 PR" : `${metric.value} PRs`
  }

  const getDetailContext = (metricKey: MetricKey, detail: ProfileCodeTrustInteractionDetail) => {
    if (metricKey === "overlay-maintainer" || metricKey === "observed-maintainer") {
      return {label: "Author", pubkey: detail.authorPubkey}
    }

    if (detail.mergedByPubkey) {
      return {label: "Merged by", pubkey: detail.mergedByPubkey}
    }

    return {label: "Status", text: "Not merged yet"}
  }

  const analyze = async (force = false) => {
    if (!$sessionPubkey) {
      status = "Sign in to analyze code collaboration evidence."
      return
    }

    const currentRequest = ++requestId

    loading = true
    status = null

    try {
      const result = await loadProfileCodeTrustAnalysis(pubkey, {force})

      if (currentRequest !== requestId || result.targetPubkey !== pubkey) return

      analysis = result

      if (result.authoredPullRequestCount === 0 && result.maintainerActionCount === 0) {
        status = `No recent pull request activity found in the last ${result.windowDays} days.`
      } else if (
        result.overlayMatchedMergedPullRequests === 0 &&
        result.overlayMatchedMaintainerMerges === 0 &&
        result.overlayMatchedCollaborators === 0
      ) {
        status = `No recent git collaborations matched your ${getTrustGraphSourceLabel(result.graphSource).toLowerCase()} in the last ${result.windowDays} days.`
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
    class="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
    onclick={() => (isOpen = !isOpen)}>
    <div class="flex flex-col gap-1">
      <span class="flex items-center gap-2 text-sm font-semibold">
        <Icon icon={Git} /> Code collaboration evidence
      </span>
      <span class="text-xs opacity-70">
        Run a bounded recent git collaboration check when you need deeper evidence.
      </span>
    </div>

    <div class="flex flex-wrap items-center justify-end gap-2 text-xs opacity-70">
      {#if analysis}
        <span class="badge badge-neutral">{analysis.overlayMatchedMergedPullRequests} merged</span>
        <span class="badge badge-neutral"
          >{analysis.overlayMatchedMaintainerMerges} maintainer</span>
        <span class="badge badge-neutral"
          >{analysis.overlayMatchedCollaborators} collaborators</span>
      {/if}
      <div class="transition-transform" class:rotate-180={isOpen}>
        <Icon icon={AltArrowDown} />
      </div>
    </div>
  </button>

  {#if isOpen}
    <div class="flex flex-col gap-4 border-t border-base-300/50 px-4 py-4">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div class="text-xs opacity-70">
          Uses {graphSourceLabel} and scans up to {PROFILE_CODE_TRUST_WINDOW_DAYS} days of recent PR and
          merge activity on git relays.
        </div>

        <div class="flex flex-wrap gap-2">
          <Button
            type="button"
            class="btn btn-neutral btn-sm inline-flex items-center justify-center gap-2"
            disabled={loading}
            onclick={() => analyze(Boolean(analysis))}>
            {#if loading}
              <span class="loading loading-spinner loading-sm shrink-0"></span>
            {:else}
              <Icon icon={Refresh} size={4} class="shrink-0" />
            {/if}
            <span class="leading-none">{analysisActionLabel}</span>
          </Button>
          <Link href="/trust-model" class="btn btn-neutral btn-sm">More about trust in BudaBit</Link>
        </div>
      </div>

      {#if !hasGraphAdjustments}
        <div class="rounded-box bg-base-100/40 p-3 text-xs opacity-75">
          Using direct social overlay only. This panel counts recent collaboration with people you
          follow; community roles and shared membership are shown in the profile connection
          sections.
        </div>
      {/if}

      {#if !analysis && !loading && !status}
        <div class="rounded-box bg-base-100/40 p-3 text-xs opacity-75">
          This deeper analysis runs only after you press Analyze code collaboration, so profile
          navigation stays responsive.
        </div>
      {/if}

      {#if status}
        <div class="rounded-box bg-base-100/40 p-3 text-sm opacity-80">{status}</div>
      {/if}

      {#if analysis}
        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {#each metricCards as metric (metric.key)}
            <div class="rounded-box bg-base-100/40 p-3">
              <div class="text-xs uppercase tracking-wide opacity-60">{metric.label}</div>
              <div class="mt-2 flex items-center gap-2">
                <div class="relative">
                  <button
                    type="button"
                    class="badge badge-neutral cursor-pointer px-3 py-3 text-sm font-medium"
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
                                      <ProfileName pubkey={context.pubkey} />
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
                                    <ProfileCircle pubkey={collaborator.pubkey} size={6} />
                                  </Button>
                                  <div class="min-w-0">
                                    <Button
                                      type="button"
                                      class="truncate p-0 text-sm font-medium"
                                      onclick={() => openProfile(collaborator.pubkey)}>
                                      <ProfileName pubkey={collaborator.pubkey} />
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
                            No evidence captured for this metric in the current window.
                          </div>
                        {/if}
                      </div>
                    </InlinePopover>
                  {/if}
                </div>
                <span class="text-xs opacity-60">Click for meaning and evidence</span>
              </div>
            </div>
          {/each}
        </div>

        {#if analysis.collaborators.length > 0}
          <div class="flex flex-col gap-3 border-t border-base-300/50 pt-4">
            <div class="flex items-center justify-between gap-2">
              <strong class="text-sm">{matchedCollaboratorLabel}</strong>
              <span class="text-xs opacity-60">Most active recent matches</span>
            </div>

            {#each analysis.collaborators.slice(0, 5) as collaborator (collaborator.pubkey)}
              <div class="rounded-box bg-base-100/40 p-3">
                <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div class="flex min-w-0 gap-3">
                    <Button
                      type="button"
                      class="shrink-0 p-0"
                      onclick={() => openProfile(collaborator.pubkey)}>
                      <ProfileCircle pubkey={collaborator.pubkey} size={7} />
                    </Button>
                    <div class="min-w-0">
                      <Button
                        type="button"
                        class="truncate p-0 text-sm font-medium"
                        onclick={() => openProfile(collaborator.pubkey)}>
                        <ProfileName pubkey={collaborator.pubkey} />
                      </Button>
                      <div class="text-xs opacity-60">
                        Recent direct-overlay collaboration match
                      </div>
                    </div>
                  </div>

                  <div class="flex flex-wrap gap-2 text-xs sm:justify-end">
                    {#if collaborator.mergedTargetPullRequests > 0}
                      <div class="relative">
                        <button
                          type="button"
                          class="badge badge-neutral cursor-pointer px-3 py-3"
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
                                  collaborator.
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
                          class="badge badge-neutral cursor-pointer px-3 py-3"
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
                        class="badge badge-neutral cursor-pointer px-3 py-3"
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
