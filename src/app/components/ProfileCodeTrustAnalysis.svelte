<script lang="ts">
  import {loadProfile, pubkey as sessionPubkey} from "@welshman/app"
  import Git from "@assets/icons/git.svg?dataurl"
  import AltArrowDown from "@assets/icons/alt-arrow-down.svg?dataurl"
  import Refresh from "@assets/icons/refresh.svg?dataurl"
  import {page} from "$app/stores"
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
  } from "@lib/budabit/profile-collab-analysis"
  import {getTrustGraphSourceLabel} from "@lib/budabit/trust-graph"
  import {hasEnabledTrustGraphRules, userTrustGraphConfigValues} from "@lib/budabit/trust-graph-config"
  import {makeGitPath} from "@lib/budabit/routes"
  import {decodeRelay} from "@app/core/state"
  import {Address} from "@welshman/util"

  type Props = {
    pubkey: string
  }

  const {pubkey}: Props = $props()

  type MetricKey =
    | "trusted-merged"
    | "trusted-maintainer"
    | "trusted-collaborators"
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

  const cacheKey = $derived.by(() =>
    $sessionPubkey ? getProfileCodeTrustAnalysisKey($sessionPubkey, pubkey) : "",
  )

  const cachedAnalysis = $derived.by(() =>
    cacheKey ? $profileCodeTrustAnalyses.get(cacheKey) || null : null,
  )

  const graphSourceLabel = $derived.by(() =>
    getTrustGraphSourceLabel(analysis?.graphSource || "basic_wot"),
  )
  const hasGraphAdjustments = $derived.by(() => hasEnabledTrustGraphRules($userTrustGraphConfigValues))
  const preferredRelayUrl = $derived.by(() =>
    $page.params.relay ? decodeRelay($page.params.relay) : analysis?.relays.find(Boolean) || "",
  )
  const metricCards = $derived.by<MetricCard[]>(() =>
    analysis
      ? [
          {
            key: "trusted-merged",
            label: "Trusted merged PRs",
            value: analysis.trustedMergedPullRequests,
            description:
              "Pull requests authored by this profile that were applied by collaborators in your trust graph.",
            details: analysis.trustedMergedPullRequestDetails,
          },
          {
            key: "trusted-maintainer",
            label: "Trusted maintainer merges",
            value: analysis.trustedMaintainerMerges,
            description:
              "Pull requests this profile applied where the author is in your trust graph.",
            details: analysis.trustedMaintainerMergeDetails,
          },
          {
            key: "trusted-collaborators",
            label: "Trusted collaborators",
            value: analysis.trustedCollaborators,
            description:
              "Distinct trusted people involved in either direction of recent merged pull request work.",
            collaborators: analysis.collaborators.slice(0, 5),
          },
          {
            key: "observed-authored",
            label: "Observed authored PRs",
            value: analysis.authoredPullRequestCount,
            description:
              "All pull requests authored by this profile in the current analysis window, regardless of trust match.",
            details: analysis.authoredPullRequestDetails,
          },
          {
            key: "observed-maintainer",
            label: "Observed maintainer actions",
            value: analysis.maintainerActionCount,
            description:
              "Pull requests where this profile is the latest effective maintainer to apply the merge status.",
            details: analysis.maintainerActionDetails,
          },
        ]
      : [],
  )

  const openProfile = (pubkey: string) => pushModal(ProfileDetail, {pubkey})

  const getRepoHref = (repoAddress: string) => {
    if (!preferredRelayUrl || !repoAddress) return ""

    try {
      return makeGitPath(preferredRelayUrl, Address.from(repoAddress).toNaddr())
    } catch {
      return ""
    }
  }

  const getPatchHref = (detail: ProfileCodeTrustInteractionDetail) => {
    const repoHref = getRepoHref(detail.repoAddress)

    return repoHref ? `${repoHref}/patches/${detail.rootId}` : ""
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
    if (metric.key === "trusted-collaborators") {
      return metric.value === 1 ? "1 collaborator" : `${metric.value} collaborators`
    }

    if (metric.key === "observed-maintainer") {
      return metric.value === 1 ? "1 maintainer action" : `${metric.value} maintainer actions`
    }

    return metric.value === 1 ? "1 PR" : `${metric.value} PRs`
  }

  const getDetailContext = (metricKey: MetricKey, detail: ProfileCodeTrustInteractionDetail) => {
    if (metricKey === "trusted-maintainer" || metricKey === "observed-maintainer") {
      return {label: "Author", pubkey: detail.authorPubkey}
    }

    if (detail.mergedByPubkey) {
      return {label: "Merged by", pubkey: detail.mergedByPubkey}
    }

    return {label: "Status", text: "Not merged yet"}
  }

  const analyze = async (force = false) => {
    if (!$sessionPubkey) {
      status = "Sign in to analyze code trust against your WoT."
      return
    }

    loading = true
    status = null

    try {
      const result = await loadProfileCodeTrustAnalysis(pubkey, {force})

      analysis = result

      if (result.authoredPullRequestCount === 0 && result.maintainerActionCount === 0) {
        status = `No recent pull request activity found in the last ${result.windowDays} days.`
      } else if (
        result.trustedMergedPullRequests === 0 &&
        result.trustedMaintainerMerges === 0 &&
        result.trustedCollaborators === 0
      ) {
        status = `No recent git collaborations matched your ${getTrustGraphSourceLabel(result.graphSource)} in the last ${result.windowDays} days.`
      }
    } catch (error: any) {
      status = error?.message || "Unable to analyze code trust right now."
    } finally {
      loading = false
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
        <Icon icon={Git} /> Code trust analysis
      </span>
      <span class="text-xs opacity-70">
        Manually analyze recent git collaboration against your trust graph.
      </span>
    </div>

    <div class="flex flex-wrap items-center justify-end gap-2 text-xs opacity-70">
      {#if analysis}
        <span class="badge badge-neutral">{analysis.trustedMergedPullRequests} merged</span>
        <span class="badge badge-neutral">{analysis.trustedMaintainerMerges} maintainer</span>
        <span class="badge badge-neutral">{analysis.trustedCollaborators} collaborators</span>
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
          Uses {graphSourceLabel} and scans up to {PROFILE_CODE_TRUST_WINDOW_DAYS} days of recent
          PR and merge activity on git relays.
        </div>

        <div class="flex flex-wrap gap-2">
          <Button
            type="button"
            class="btn btn-neutral btn-sm inline-flex items-center justify-center gap-2"
            onclick={() => analyze(Boolean(analysis))}>
            {#if loading}
              <span class="loading loading-spinner loading-sm shrink-0"></span>
            {:else}
              <Icon icon={Refresh} size={4} class="shrink-0" />
            {/if}
            <span class="leading-none">{analysis ? "Refresh analysis" : "Analyze"}</span>
          </Button>
          <Link href="/settings/trust" class="btn btn-neutral btn-sm">Trust settings</Link>
        </div>
      </div>

      {#if !hasGraphAdjustments}
        <div class="rounded-box bg-base-100/40 p-3 text-xs opacity-75">
          Using the basic WoT fallback. Add graph rules in Trust settings if you want this analysis
          to include or exclude collaborators based on selected rank, follower, or report metrics.
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
                    <InlinePopover onClose={() => (openMetricPopover = null)} align="left" widthClass="w-80">
                      <div class="flex flex-col gap-3 text-sm">
                        <div>
                          <div class="font-medium">{metric.label}</div>
                          <div class="mt-1 text-xs opacity-70">{metric.description}</div>
                        </div>

                        <div class="text-xs opacity-60">
                          {getMetricPopoverButtonLabel(metric)} in the current {analysis.windowDays}-day analysis window.
                        </div>

                        {#if metric.details && metric.details.length > 0}
                          <div class="flex flex-col gap-2">
                            {#each metric.details as detail (detail.rootId)}
                              {@const context = getDetailContext(metric.key, detail)}
                              {@const patchHref = getPatchHref(detail)}
                              {@const repoHref = getRepoHref(detail.repoAddress)}
                              <div class="rounded-box bg-base-200/50 p-3">
                                {#if patchHref}
                                  <Link
                                    href={patchHref}
                                    class="text-sm font-medium text-primary underline-offset-2 hover:underline">
                                    {detail.subject}
                                  </Link>
                                {:else}
                                  <div class="text-sm font-medium">{detail.subject}</div>
                                {/if}
                                <div class="mt-1 text-xs opacity-70">
                                  {#if repoHref}
                                    <Link href={repoHref} class="text-primary underline-offset-2 hover:underline">
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
                                      {collaborator.totalInteractions} interaction{collaborator.totalInteractions === 1 ? "" : "s"}
                                      across {collaborator.repoCount} repo{collaborator.repoCount === 1 ? "" : "s"}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            {/each}
                          </div>
                        {:else}
                          <div class="text-xs opacity-60">No evidence captured for this metric in the current window.</div>
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
              <strong class="text-sm">Trusted collaborators</strong>
              <span class="text-xs opacity-60">Most active recent matches</span>
            </div>

            {#each analysis.collaborators.slice(0, 5) as collaborator (collaborator.pubkey)}
              <div class="rounded-box bg-base-100/40 p-3">
                <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div class="flex min-w-0 gap-3">
                    <Button type="button" class="shrink-0 p-0" onclick={() => openProfile(collaborator.pubkey)}>
                      <ProfileCircle pubkey={collaborator.pubkey} size={7} />
                    </Button>
                    <div class="min-w-0">
                      <Button
                        type="button"
                        class="truncate p-0 text-sm font-medium"
                        onclick={() => openProfile(collaborator.pubkey)}>
                        <ProfileName pubkey={collaborator.pubkey} />
                      </Button>
                      <div class="text-xs opacity-60">Recent trusted collaboration counterpart</div>
                    </div>
                  </div>

                  <div class="flex flex-wrap gap-2 text-xs sm:justify-end">
                    {#if collaborator.mergedTargetPullRequests > 0}
                      <div class="relative">
                        <button
                          type="button"
                          class="badge badge-neutral cursor-pointer px-3 py-3"
                          onclick={() => toggleCollaboratorPopover(collaborator, "merged-target") }>
                          {collaborator.mergedTargetPullRequests} merged target PRs
                        </button>

                        {#if openCollaboratorPopover === `${collaborator.pubkey}:merged-target`}
                          <InlinePopover onClose={() => (openCollaboratorPopover = null)} align="right" widthClass="w-80">
                            <div class="flex flex-col gap-3 text-sm">
                              <div>
                                <div class="font-medium">Merged target PRs</div>
                                <div class="mt-1 text-xs opacity-70">
                                  Pull requests authored by this profile and applied by this collaborator.
                                </div>
                              </div>

                              {#if collaborator.mergedTargetPullRequestDetails.length > 0}
                                <div class="flex flex-col gap-2">
                            {#each collaborator.mergedTargetPullRequestDetails as detail (detail.rootId)}
                              {@const patchHref = getPatchHref(detail)}
                              {@const repoHref = getRepoHref(detail.repoAddress)}
                              <div class="rounded-box bg-base-200/50 p-3">
                                    {#if patchHref}
                                      <Link href={patchHref} class="text-sm font-medium text-primary underline-offset-2 hover:underline">
                                        {detail.subject}
                                      </Link>
                                    {:else}
                                      <div class="text-sm font-medium">{detail.subject}</div>
                                    {/if}
                                    <div class="mt-1 text-xs opacity-70">
                                      {#if repoHref}
                                        <Link href={repoHref} class="text-primary underline-offset-2 hover:underline">
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
                                <div class="text-xs opacity-60">No merged target PR examples in the current analysis window.</div>
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
                          onclick={() => toggleCollaboratorPopover(collaborator, "merged-by-target") }>
                          {collaborator.mergedByTarget} merged by target
                        </button>

                        {#if openCollaboratorPopover === `${collaborator.pubkey}:merged-by-target`}
                          <InlinePopover onClose={() => (openCollaboratorPopover = null)} align="right" widthClass="w-80">
                            <div class="flex flex-col gap-3 text-sm">
                              <div>
                                <div class="font-medium">Merged by target</div>
                                <div class="mt-1 text-xs opacity-70">
                                  Pull requests authored by this collaborator and applied by the target profile.
                                </div>
                              </div>

                              {#if collaborator.mergedByTargetDetails.length > 0}
                                <div class="flex flex-col gap-2">
                                {#each collaborator.mergedByTargetDetails as detail (detail.rootId)}
                                  {@const patchHref = getPatchHref(detail)}
                                  {@const repoHref = getRepoHref(detail.repoAddress)}
                                  <div class="rounded-box bg-base-200/50 p-3">
                                      {#if patchHref}
                                        <Link href={patchHref} class="text-sm font-medium text-primary underline-offset-2 hover:underline">
                                          {detail.subject}
                                        </Link>
                                      {:else}
                                        <div class="text-sm font-medium">{detail.subject}</div>
                                      {/if}
                                      <div class="mt-1 text-xs opacity-70">
                                        {#if repoHref}
                                          <Link href={repoHref} class="text-primary underline-offset-2 hover:underline">
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
                                <div class="text-xs opacity-60">No target-applied PR examples in the current analysis window.</div>
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
                        onclick={() => toggleCollaboratorPopover(collaborator, "repos") }>
                        {collaborator.repoCount} repos
                      </button>

                      {#if openCollaboratorPopover === `${collaborator.pubkey}:repos`}
                        <InlinePopover onClose={() => (openCollaboratorPopover = null)} align="right" widthClass="w-72">
                          <div class="flex flex-col gap-3 text-sm">
                            <div>
                              <div class="font-medium">Common repos</div>
                              <div class="mt-1 text-xs opacity-70">
                                Repositories where this collaborator has recent trusted activity with the target profile.
                              </div>
                            </div>

                            {#if collaborator.repoDetails.length > 0}
                              <div class="flex flex-col gap-2">
                                {#each collaborator.repoDetails as repoDetail (repoDetail.repoAddress)}
                                  {@const repoHref = getRepoHref(repoDetail.repoAddress)}
                                  <div class="rounded-box bg-base-200/50 p-3">
                                    {#if repoHref}
                                      <Link href={repoHref} class="text-sm font-medium text-primary underline-offset-2 hover:underline">
                                        {repoDetail.repoName}
                                      </Link>
                                    {:else}
                                      <div class="text-sm font-medium">{repoDetail.repoName}</div>
                                    {/if}
                                    <div class="mt-1 text-xs opacity-70">
                                      {repoDetail.count} interaction{repoDetail.count === 1 ? "" : "s"}
                                    </div>
                                  </div>
                                {/each}
                              </div>
                            {:else}
                              <div class="text-xs opacity-60">No repository overlap captured in the current analysis window.</div>
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
