import {get} from "svelte/store"
import {chunk} from "@welshman/lib"
import {makeLoader} from "@welshman/net"
import {getFollows, getWotGraph, pubkey} from "@welshman/app"
import {type TrustedEvent} from "@welshman/util"
import {
  getNip85UserAssertionValue,
  hasNip85MetricValue,
  parseNip85UserAssertion,
  type Nip85ConfiguredProvider,
  type Nip85UserAssertion,
  userNip85ConfiguredProviders,
} from "./nip85"
import {
  hasEnabledTrustGraphRules,
  isNip85MetricSource,
  userTrustGraphConfigValues,
  type TrustGraphConfig,
  type TrustGraphRule,
} from "./trust-graph-config"

export type TrustGraphSource = "basic_wot" | "adjusted_wot"

export type ActiveTrustGraph = {
  viewerPubkey: string
  source: TrustGraphSource
  scores: Map<string, number>
  enabledRuleCount: number
}

type TrustGraphAssertionStore = Map<string, Map<string, Nip85UserAssertion>>

const SELF_WEIGHT = 5
const FOLLOW_WEIGHT = 3
const trustGraphMetricLoad = makeLoader({delay: 200, timeout: 5000, threshold: 0.5})

export const getBasicTrustGraphScore = (
  viewerPubkey: string,
  targetPubkey: string,
  follows: string[],
  wotGraph: Map<string, number>,
) => {
  if (!viewerPubkey || !targetPubkey) return 0
  if (targetPubkey === viewerPubkey) return SELF_WEIGHT
  if (follows.includes(targetPubkey)) return FOLLOW_WEIGHT

  return Math.max(0, wotGraph.get(targetPubkey) || 0)
}

export const buildBasicTrustGraph = (
  viewerPubkey: string,
  follows: string[],
  wotGraph: Map<string, number>,
) => {
  const scores = new Map<string, number>()

  if (!viewerPubkey) {
    return scores
  }

  scores.set(viewerPubkey, SELF_WEIGHT)

  for (const follow of follows) {
    if (!follow) continue

    scores.set(follow, Math.max(FOLLOW_WEIGHT, scores.get(follow) || 0))
  }

  for (const [targetPubkey, rawScore] of wotGraph.entries()) {
    if (!targetPubkey || rawScore <= 0) continue

    scores.set(targetPubkey, Math.max(rawScore, scores.get(targetPubkey) || 0))
  }

  return scores
}

export const getActiveTrustGraph = (): ActiveTrustGraph => {
  const viewerPubkey = pubkey.get() || ""
  const follows = viewerPubkey ? getFollows(viewerPubkey) : []
  const wotGraph = getWotGraph()

  return {
    viewerPubkey,
    source: "basic_wot",
    scores: buildBasicTrustGraph(viewerPubkey, follows, wotGraph),
    enabledRuleCount: 0,
  }
}

const getBasicTrustGraphScoresForCandidates = (
  viewerPubkey: string,
  candidatePubkeys: string[],
  follows: string[],
  wotGraph: Map<string, number>,
) => {
  const scores = new Map<string, number>()

  for (const candidatePubkey of candidatePubkeys) {
    const score = getBasicTrustGraphScore(viewerPubkey, candidatePubkey, follows, wotGraph)

    if (score > 0) {
      scores.set(candidatePubkey, score)
    }
  }

  return scores
}

const getTrustGraphRuleMetricValue = (
  rule: TrustGraphRule,
  candidatePubkey: string,
  basicScores: Map<string, number>,
  assertionsByServiceKey: TrustGraphAssertionStore,
) => {
  if (!isNip85MetricSource(rule.source)) {
    return basicScores.get(candidatePubkey) || 0
  }

  const assertion = assertionsByServiceKey.get(rule.source.serviceKey)?.get(candidatePubkey)

  if (!assertion) {
    return undefined
  }

  return getNip85UserAssertionValue(assertion, rule.source.kindTag.split(":")[1] || "")
}

export const doesTrustGraphRuleMatch = (rule: TrustGraphRule, value: unknown) => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return false
  }

  return rule.operator === "lte" ? value <= rule.threshold : value >= rule.threshold
}

export const applyTrustGraphRules = ({
  candidatePubkeys,
  basicScores,
  config,
  assertionsByServiceKey,
}: {
  candidatePubkeys: string[]
  basicScores: Map<string, number>
  config: TrustGraphConfig
  assertionsByServiceKey?: TrustGraphAssertionStore
}) => {
  const scores = new Map<string, number>()
  const activeRules = config.rules.filter(rule => rule.enabled)

  for (const candidatePubkey of candidatePubkeys) {
    const basicScore = basicScores.get(candidatePubkey) || 0
    let included = basicScore > 0
    let excluded = false

    for (const rule of activeRules) {
      const value = getTrustGraphRuleMetricValue(
        rule,
        candidatePubkey,
        basicScores,
        assertionsByServiceKey || new Map(),
      )

      if (!hasNip85MetricValue(value) || !doesTrustGraphRuleMatch(rule, value)) {
        continue
      }

      if (rule.action === "exclude") {
        excluded = true
      } else {
        included = true
      }
    }

    if (included && !excluded) {
      scores.set(candidatePubkey, Math.max(1, basicScore))
    }
  }

  return scores
}

const getTrustGraphRuleProviders = (
  rules: TrustGraphRule[],
  configuredProviders: Nip85ConfiguredProvider[],
) => {
  const byServiceKey = new Map<string, Nip85ConfiguredProvider[]>()

  for (const rule of rules) {
    if (!rule.enabled || !isNip85MetricSource(rule.source)) continue
    const source = rule.source

    const providers = configuredProviders.filter(
      provider => provider.serviceKey === source.serviceKey && provider.kindTag === source.kindTag,
    )

    if (providers.length === 0) continue

    byServiceKey.set(source.serviceKey, providers)
  }

  return byServiceKey
}

const loadTrustGraphAssertions = async (
  candidatePubkeys: string[],
  rules: TrustGraphRule[],
  configuredProviders: Nip85ConfiguredProvider[],
) => {
  const assertionsByServiceKey: TrustGraphAssertionStore = new Map()
  const providersByServiceKey = getTrustGraphRuleProviders(rules, configuredProviders)

  await Promise.all(
    Array.from(providersByServiceKey.entries()).map(async ([serviceKey, providers]) => {
      const relays = Array.from(
        new Set(providers.map(provider => provider.relayHint).filter(Boolean)),
      )
      const latestByTarget = new Map<string, TrustedEvent>()

      for (const pubkeys of chunk(50, candidatePubkeys)) {
        const events = await trustGraphMetricLoad({
          filters: [{kinds: [30382], authors: [serviceKey], "#d": pubkeys}],
          relays,
        })

        for (const event of events) {
          const targetPubkey = event.tags.find(tag => tag[0] === "d")?.[1]

          if (!targetPubkey) continue

          const existing = latestByTarget.get(targetPubkey)

          if (!existing || event.created_at > existing.created_at) {
            latestByTarget.set(targetPubkey, event)
          }
        }
      }

      const assertions = new Map<string, Nip85UserAssertion>()

      for (const [targetPubkey, event] of latestByTarget.entries()) {
        const assertion = parseNip85UserAssertion(event)

        if (assertion) {
          assertions.set(targetPubkey, assertion)
        }
      }

      assertionsByServiceKey.set(serviceKey, assertions)
    }),
  )

  return assertionsByServiceKey
}

export const loadActiveTrustGraph = async (candidatePubkeys: string[]) => {
  const viewerPubkey = pubkey.get() || ""
  const follows = viewerPubkey ? getFollows(viewerPubkey) : []
  const wotGraph = getWotGraph()
  const normalizedCandidates = Array.from(new Set(candidatePubkeys.filter(Boolean)))
  const basicScores = getBasicTrustGraphScoresForCandidates(
    viewerPubkey,
    normalizedCandidates,
    follows,
    wotGraph,
  )
  const config = get(userTrustGraphConfigValues)

  if (!viewerPubkey || normalizedCandidates.length === 0 || !hasEnabledTrustGraphRules(config)) {
    return {
      viewerPubkey,
      source: "basic_wot" as const,
      scores: basicScores,
      enabledRuleCount: 0,
    }
  }

  const configuredProviders = get(userNip85ConfiguredProviders)
  const activeRules = config.rules.filter(rule => {
    if (!rule.enabled) return false
    if (!isNip85MetricSource(rule.source)) return true
    const source = rule.source

    return configuredProviders.some(
      provider => provider.serviceKey === source.serviceKey && provider.kindTag === source.kindTag,
    )
  })

  if (activeRules.length === 0) {
    return {
      viewerPubkey,
      source: "basic_wot" as const,
      scores: basicScores,
      enabledRuleCount: 0,
    }
  }

  const assertionsByServiceKey = await loadTrustGraphAssertions(
    normalizedCandidates,
    activeRules,
    configuredProviders,
  )
  const adjustedScores = applyTrustGraphRules({
    candidatePubkeys: normalizedCandidates,
    basicScores,
    config: {...config, rules: activeRules},
    assertionsByServiceKey,
  })

  return {
    viewerPubkey,
    source: "adjusted_wot" as const,
    scores: adjustedScores,
    enabledRuleCount: activeRules.length,
  }
}

export const getTrustGraphSourceLabel = (source: TrustGraphSource) => {
  switch (source) {
    case "adjusted_wot":
      return "Adjusted WoT"
    default:
      return "Basic WoT"
  }
}
