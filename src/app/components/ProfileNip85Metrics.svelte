<script lang="ts">
  import {displayPubkey} from "@welshman/util"
  import ShieldCheck from "@assets/icons/shield-check.svg?dataurl"
  import AltArrowDown from "@assets/icons/alt-arrow-down.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Link from "@lib/components/Link.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import ProfileCircle from "@app/components/ProfileCircle.svelte"
  import ProfileName from "@app/components/ProfileName.svelte"
  import {
    NIP85_USER_METRICS,
    getNip85ConfiguredProvidersByCapability,
    getNip85ProviderKey,
    getNip85UserAssertionValue,
    getNip85UserMetricLabel,
    hasNip85MetricValue,
    loadNip85ProfileSummary,
    userNip85ConfiguredUserProviders,
    formatNip85UserMetricValue,
    type Nip85FetchedUserAssertion,
    type Nip85UserAssertionSummary,
  } from "@lib/budabit/nip85"

  type Props = {
    pubkey: string
  }

  const {pubkey}: Props = $props()

  let isOpen = $state(false)
  let loading = $state(false)
  let status = $state<string | null>(null)
  let summary = $state<Nip85UserAssertionSummary | null>(null)
  let results = $state(new Map<string, Nip85FetchedUserAssertion>())
  let loadedKey = $state("")
  let previousPubkey = $state(pubkey)
  let requestId = 0

  const configuredProviders = $derived($userNip85ConfiguredUserProviders)

  const providersByCapability = $derived.by(() =>
    getNip85ConfiguredProvidersByCapability(configuredProviders),
  )

  const selectedTags = $derived.by(() =>
    NIP85_USER_METRICS.filter(metric => providersByCapability.has(metric.kindTag)).map(
      metric => metric.kindTag,
    ),
  )

  const getSummaryValue = (summary: Nip85UserAssertionSummary | null, kindTag: string) => {
    if (!summary) return undefined

    switch (kindTag) {
      case "30382:rank":
        return summary.rank
      case "30382:followers":
        return summary.followers
      case "30382:first_created_at":
        return summary.firstCreatedAt
      case "30382:post_cnt":
        return summary.postCnt
      case "30382:reply_cnt":
        return summary.replyCnt
      case "30382:reactions_cnt":
        return summary.reactionsCnt
      case "30382:zap_amt_recd":
        return summary.zapAmtRecd
      case "30382:zap_amt_sent":
        return summary.zapAmtSent
      case "30382:zap_cnt_recd":
        return summary.zapCntRecd
      case "30382:zap_cnt_sent":
        return summary.zapCntSent
      case "30382:zap_avg_amt_day_recd":
        return summary.zapAvgAmtDayRecd
      case "30382:zap_avg_amt_day_sent":
        return summary.zapAvgAmtDaySent
      case "30382:reports_cnt_recd":
        return summary.reportsCntRecd
      case "30382:reports_cnt_sent":
        return summary.reportsCntSent
      case "30382:t":
        return summary.commonTopics
      case "30382:active_hours_start":
        return summary.activeHoursStart
      case "30382:active_hours_end":
        return summary.activeHoursEnd
    }
  }

  const summaryTags = $derived.by(() =>
    selectedTags.filter(kindTag => {
      const providers = providersByCapability.get(kindTag) || []

      return providers.length === 1 && hasNip85MetricValue(getSummaryValue(summary, kindTag))
    }),
  )

  const providerExtras = $derived.by(() => {
    const selectedTagNames = new Set(selectedTags.map(kindTag => kindTag.split(":")[1]))

    return Array.from(results.values())
      .map(result => {
        const metrics = (result.availableTags || [])
          .filter(tag => !selectedTagNames.has(tag))
          .map(tag => ({tag, value: result.assertion ? getNip85UserAssertionValue(result.assertion, tag) : undefined}))
          .filter(metric => hasNip85MetricValue(metric.value))

        return {serviceKey: result.serviceKey, metrics}
      })
      .filter(entry => entry.metrics.length > 0)
  })

  const buildLoadKey = () =>
    [
      pubkey,
      ...configuredProviders
        .map(provider => `${getNip85ProviderKey(provider)}:${provider.visibility}`)
        .sort(),
    ].join("|")

  const loadMetrics = async () => {
    const nextKey = buildLoadKey()

    if (!isOpen || nextKey === loadedKey) return

    const currentRequest = ++requestId

    if (configuredProviders.length === 0) {
      summary = null
      results = new Map()
      loadedKey = nextKey
      status = "Configure trusted assertion providers in Settings to see NIP-85 profile metrics."
      return
    }

    loading = true
    status = null

    try {
      const loaded = await loadNip85ProfileSummary(pubkey, configuredProviders)

      if (currentRequest !== requestId) return

      summary = loaded.summary
      results = loaded.results
      loadedKey = nextKey

      const hasData = Array.from(loaded.results.values()).some(result => result.status === "data")

      status = hasData ? null : "No trusted assertion data found for this profile yet."
    } catch (error: any) {
      if (currentRequest !== requestId) return

      summary = null
      results = new Map()
      status = error?.message || "Unable to load trusted assertion data."
    } finally {
      if (currentRequest === requestId) {
        loading = false
      }
    }
  }

  $effect(() => {
    if (pubkey === previousPubkey) return

    previousPubkey = pubkey
    requestId += 1
    summary = null
    results = new Map()
    status = null
    loading = false
    loadedKey = ""
  })

  $effect(() => {
    buildLoadKey()

    if (isOpen) {
      loadMetrics()
    }
  })
</script>

<div class="rounded-xl bg-base-200/50">
  <button
    type="button"
    class="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
    onclick={() => (isOpen = !isOpen)}>
    <div class="flex flex-col gap-1">
      <span class="flex items-center gap-2 text-sm font-semibold">
        <Icon icon={ShieldCheck} /> Trust metrics
      </span>
      <span class="text-xs opacity-70">
        Load NIP-85 profile metrics from the providers you trust.
      </span>
    </div>

    <div class="flex items-center gap-2 text-xs opacity-70">
      {#if summary?.providerCount}
        <span class="badge badge-neutral">{summary.providerCount} providers</span>
      {/if}
      <div class="transition-transform" class:rotate-180={isOpen}>
        <Icon icon={AltArrowDown} />
      </div>
    </div>
  </button>

  {#if isOpen}
    <div class="flex flex-col gap-4 border-t border-base-300/50 px-4 py-4">
      {#if loading}
        <div class="flex items-center gap-2 text-sm opacity-75">
          <Spinner loading={loading} />
          <span>Loading trusted assertions...</span>
        </div>
      {:else}
        {#if status}
          <div class="rounded-box bg-base-100/40 p-3 text-sm opacity-80">
            {status}
          </div>
        {/if}

        {#if configuredProviders.length === 0}
          <div>
            <Link href="/settings/trust" class="btn btn-neutral btn-sm">Configure Providers</Link>
          </div>
        {:else}
          <p class="text-xs opacity-70">
            Summary values only show when exactly one provider is selected for a metric.
          </p>

          {#if summaryTags.length > 0}
            <div class="grid gap-3 sm:grid-cols-2">
              {#each summaryTags as kindTag}
                {@const value = getSummaryValue(summary, kindTag)}
                <div class="rounded-box bg-base-100/40 p-3">
                  <div class="text-xs uppercase tracking-wide opacity-60">
                    {getNip85UserMetricLabel(kindTag.split(":")[1])}
                  </div>
                  <div class="mt-1 text-sm font-medium">
                    {formatNip85UserMetricValue(kindTag.split(":")[1], value)}
                  </div>
                </div>
              {/each}
            </div>
          {/if}

          {#if selectedTags.length > 0}
            <div class="flex flex-col gap-3 border-t border-base-300/50 pt-4">
              <div class="flex items-center justify-between gap-2">
                <strong class="text-sm">Provider responses</strong>
                <span class="text-xs opacity-60">Per metric</span>
              </div>

              {#each selectedTags as kindTag}
                {@const providers = providersByCapability.get(kindTag) || []}
                <div class="flex flex-col gap-2">
                  <div class="flex items-center justify-between gap-2 text-sm">
                    <span class="font-medium">{getNip85UserMetricLabel(kindTag.split(":")[1])}</span>
                    <span class="text-xs opacity-60">{providers.length} selected</span>
                  </div>

                  {#each providers as provider}
                    {@const result = results.get(provider.serviceKey)}
                    {@const rawValue = result?.assertion ? getNip85UserAssertionValue(result.assertion, provider.tag) : undefined}
                    {@const hasValue = hasNip85MetricValue(rawValue)}
                    {@const tagMissing = Boolean(
                      result?.assertion &&
                        !hasValue &&
                        result.availableTags.length > 0 &&
                        !result.availableTags.includes(provider.tag),
                    )}
                    <div class="rounded-box bg-base-100/40 p-3">
                      <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div class="flex min-w-0 gap-3">
                          <ProfileCircle pubkey={provider.serviceKey} size={7} />
                          <div class="min-w-0">
                            <div class="truncate text-sm font-medium">
                              <ProfileName pubkey={provider.serviceKey} />
                            </div>
                            <div class="text-xs opacity-60">{displayPubkey(provider.serviceKey)}</div>
                          </div>
                        </div>

                        <div class="text-sm font-medium">
                          {#if hasValue}
                            {formatNip85UserMetricValue(provider.tag, rawValue)}
                          {:else}
                            <span class="opacity-60">No data</span>
                          {/if}
                        </div>
                      </div>

                      {#if result?.status === "error"}
                        <p class="mt-2 text-xs opacity-70">{result.error || "Provider unavailable."}</p>
                      {:else if result && result.status !== "data"}
                        <p class="mt-2 text-xs opacity-70">
                          Provider may be offline or has not published this profile yet.
                        </p>
                      {/if}

                      {#if tagMissing}
                        <p class="mt-2 text-xs opacity-70">
                          This provider published different metrics for this profile:
                          {result?.availableTags.join(", ")}
                        </p>
                      {/if}
                    </div>
                  {/each}
                </div>
              {/each}
            </div>
          {/if}

          {#if providerExtras.length > 0}
            <details class="rounded-box border border-base-300/50 bg-base-100/20 p-3">
              <summary class="cursor-pointer text-sm font-medium">Other provider metrics</summary>
              <div class="mt-3 flex flex-col gap-3">
                {#each providerExtras as entry}
                  <div class="rounded-box bg-base-100/40 p-3">
                    <div class="flex items-center gap-3">
                      <ProfileCircle pubkey={entry.serviceKey} size={7} />
                      <div class="min-w-0">
                        <div class="truncate text-sm font-medium">
                          <ProfileName pubkey={entry.serviceKey} />
                        </div>
                        <div class="text-xs opacity-60">{displayPubkey(entry.serviceKey)}</div>
                      </div>
                    </div>

                    <div class="mt-3 flex flex-col gap-2">
                      {#each entry.metrics as metric}
                        <div class="flex items-center justify-between gap-3 text-sm">
                          <span class="opacity-70">{getNip85UserMetricLabel(metric.tag)}</span>
                          <span class="font-medium">
                            {formatNip85UserMetricValue(metric.tag, metric.value)}
                          </span>
                        </div>
                      {/each}
                    </div>
                  </div>
                {/each}
              </div>
            </details>
          {/if}
        {/if}
      {/if}
    </div>
  {/if}
</div>
