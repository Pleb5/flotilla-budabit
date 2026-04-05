import * as nip19 from "nostr-tools/nip19"
import {normalizeRelayUrl, type TrustedEvent} from "@welshman/util"

export const NIP85_PROVIDER_CONFIG_KIND = 10040
export const NIP85_USER_ASSERTION_KIND = 30382
export const NIP85_EVENT_ASSERTION_KIND = 30383
export const NIP85_ADDRESSABLE_ASSERTION_KIND = 30384
export const NIP85_EXTERNAL_ASSERTION_KIND = 30385

export const NIP85_SUPPORTED_ASSERTION_KINDS = [
  NIP85_USER_ASSERTION_KIND,
  NIP85_EVENT_ASSERTION_KIND,
  NIP85_ADDRESSABLE_ASSERTION_KIND,
  NIP85_EXTERNAL_ASSERTION_KIND,
]

export type Nip85ProviderVisibility = "public" | "private"

export type Nip85MetricFormat =
  | "rank"
  | "number"
  | "sats"
  | "satsPerDay"
  | "date"
  | "hour"
  | "topics"
  | "text"

export type Nip85MetricValue = number | string | string[] | undefined

export interface Nip85Provider {
  kindTag: string
  serviceKey: string
  relayHint: string
  kind: number
  tag: string
}

export interface Nip85ConfiguredProvider extends Nip85Provider {
  visibility: Nip85ProviderVisibility
}

export interface Nip85RecommendedProvider extends Nip85Provider {
  usageCount: number
  recommenders: string[]
  score: number
}

export interface Nip85MetricDefinition {
  kind: number
  kindTag: string
  tag: string
  label: string
  description: string
  format: Nip85MetricFormat
}

export interface Nip85UserAssertion {
  pubkey: string
  rank?: number
  followers?: number
  firstCreatedAt?: number
  postCnt?: number
  replyCnt?: number
  reactionsCnt?: number
  zapAmtRecd?: number
  zapAmtSent?: number
  zapCntRecd?: number
  zapCntSent?: number
  zapAvgAmtDayRecd?: number
  zapAvgAmtDaySent?: number
  reportsCntRecd?: number
  reportsCntSent?: number
  commonTopics?: string[]
  activeHoursStart?: number
  activeHoursEnd?: number
  extraMetrics?: Record<string, number | string>
}

export interface Nip85FetchedUserAssertion {
  serviceKey: string
  relayHints: string[]
  assertion?: Nip85UserAssertion
  status: "data" | "no_data" | "error"
  availableTags: string[]
  error?: string
}

export interface Nip85UserAssertionSummary {
  providerCount: number
  rank?: number
  followers?: number
  firstCreatedAt?: number
  postCnt?: number
  replyCnt?: number
  reactionsCnt?: number
  zapAmtRecd?: number
  zapAmtSent?: number
  zapCntRecd?: number
  zapCntSent?: number
  zapAvgAmtDayRecd?: number
  zapAvgAmtDaySent?: number
  reportsCntRecd?: number
  reportsCntSent?: number
  commonTopics?: string[]
  activeHoursStart?: number
  activeHoursEnd?: number
}

export interface Nip85VerificationSample {
  pubkeys: string[]
}

const DEFAULT_IGNORED_ASSERTION_TAGS = new Set(["d"])

const isHexPubkey = (value: string) => /^[0-9a-f]{64}$/i.test(value)

const getTagValue = (name: string, tags: string[][]) => tags.find(tag => tag[0] === name)?.[1]

const parseNumberValue = (value: string | undefined) => {
  if (value === undefined || value === "") return undefined

  const number = Number(value)

  if (Number.isNaN(number)) {
    return undefined
  }

  return number
}

const normalizeKindTag = (value: string) => {
  const trimmed = (value || "").trim()

  if (!trimmed.match(/^\d+:[^\s].*$/)) {
    return ""
  }

  const [kindValue, ...rest] = trimmed.split(":")
  const kind = Number.parseInt(kindValue || "", 10)
  const tag = rest.join(":").trim()

  if (!NIP85_SUPPORTED_ASSERTION_KINDS.includes(kind) || !tag) {
    return ""
  }

  return `${kind}:${tag}`
}

export const normalizeNip85Pubkey = (value: string) => {
  const trimmed = (value || "").trim()

  if (!trimmed) return ""
  if (isHexPubkey(trimmed)) return trimmed.toLowerCase()

  try {
    const decoded = nip19.decode(trimmed)

    if (decoded.type === "npub" && typeof decoded.data === "string") {
      return decoded.data.toLowerCase()
    }

    if (decoded.type === "nprofile" && typeof decoded.data?.pubkey === "string") {
      return decoded.data.pubkey.toLowerCase()
    }
  } catch {
    return ""
  }

  return ""
}

export const normalizeNip85RelayHint = (value: string) => {
  try {
    return normalizeRelayUrl((value || "").trim())
  } catch {
    return ""
  }
}

export const getNip85ProviderKey = (provider: Pick<Nip85Provider, "serviceKey" | "kindTag">) =>
  `${provider.serviceKey}:${provider.kindTag}`

export const makeNip85KindTag = (kind: number, tag: string) => `${kind}:${tag}`

export const parseNip85ProviderTag = (
  tag: string[],
  visibility: Nip85ProviderVisibility = "public",
): Nip85ConfiguredProvider | undefined => {
  if (tag.length < 3) return

  const kindTag = normalizeKindTag(tag[0] || "")
  const serviceKey = normalizeNip85Pubkey(tag[1] || "")
  const relayHint = normalizeNip85RelayHint(tag[2] || "")

  if (!kindTag || !serviceKey || !relayHint) return

  const [kindValue, metricTag] = kindTag.split(":")
  const kind = Number.parseInt(kindValue || "", 10)

  if (!metricTag || Number.isNaN(kind)) return

  return {
    kindTag,
    kind,
    tag: metricTag,
    serviceKey,
    relayHint,
    visibility,
  }
}

export const parseNip85ProviderTags = (
  tags: string[][],
  visibility: Nip85ProviderVisibility = "public",
) =>
  tags
    .map(tag => parseNip85ProviderTag(tag, visibility))
    .filter(Boolean) as Nip85ConfiguredProvider[]

export const formatNip85ProviderTag = (provider: Nip85Provider) => [
  provider.kindTag,
  provider.serviceKey,
  provider.relayHint,
]

export const rankNip85Relays = (relayCounts: Map<string, number>, limit = 8) =>
  Array.from(relayCounts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([relay]) => relay)

export const sortNip85ConfiguredProviders = (providers: Nip85ConfiguredProvider[]) =>
  [...providers].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind - b.kind
    if (a.tag !== b.tag) return a.tag.localeCompare(b.tag)
    if (a.serviceKey !== b.serviceKey) return a.serviceKey.localeCompare(b.serviceKey)
    if (a.visibility !== b.visibility) return a.visibility.localeCompare(b.visibility)
    return a.relayHint.localeCompare(b.relayHint)
  })

export const dedupeNip85ConfiguredProviders = (providers: Nip85ConfiguredProvider[]) => {
  const deduped = new Map<string, Nip85ConfiguredProvider>()

  for (const provider of providers) {
    deduped.set(getNip85ProviderKey(provider), provider)
  }

  return sortNip85ConfiguredProviders(Array.from(deduped.values()))
}

export const splitNip85ConfiguredProviders = (providers: Nip85ConfiguredProvider[]) => {
  const deduped = dedupeNip85ConfiguredProviders(providers)
  const publicTags = deduped
    .filter(provider => provider.visibility === "public")
    .map(formatNip85ProviderTag)
  const privateTags = deduped
    .filter(provider => provider.visibility === "private")
    .map(formatNip85ProviderTag)

  return {publicTags, privateTags}
}

export const upsertNip85ConfiguredProvider = (
  providers: Nip85ConfiguredProvider[],
  provider: Nip85ConfiguredProvider,
) => dedupeNip85ConfiguredProviders([...providers, provider])

export const removeNip85ConfiguredProvider = (
  providers: Nip85ConfiguredProvider[],
  target: Pick<Nip85Provider, "serviceKey" | "kindTag">,
) =>
  sortNip85ConfiguredProviders(
    providers.filter(provider => getNip85ProviderKey(provider) !== getNip85ProviderKey(target)),
  )

export const setNip85ProviderVisibility = (
  providers: Nip85ConfiguredProvider[],
  target: Pick<Nip85Provider, "serviceKey" | "kindTag">,
  visibility: Nip85ProviderVisibility,
) =>
  sortNip85ConfiguredProviders(
    providers.map(provider =>
      getNip85ProviderKey(provider) === getNip85ProviderKey(target)
        ? {...provider, visibility}
        : provider,
    ),
  )

export const getNip85ConfiguredProvidersByCapability = (providers: Nip85ConfiguredProvider[]) => {
  const byCapability = new Map<string, Nip85ConfiguredProvider[]>()

  for (const provider of sortNip85ConfiguredProviders(providers)) {
    const providersForCapability = byCapability.get(provider.kindTag) || []

    providersForCapability.push(provider)
    byCapability.set(provider.kindTag, providersForCapability)
  }

  return byCapability
}

export const NIP85_USER_METRICS: Nip85MetricDefinition[] = [
  {
    kind: NIP85_USER_ASSERTION_KIND,
    kindTag: makeNip85KindTag(NIP85_USER_ASSERTION_KIND, "rank"),
    tag: "rank",
    label: "WoT Rank",
    description: "A normalized reputation score from 0 to 100.",
    format: "rank",
  },
  {
    kind: NIP85_USER_ASSERTION_KIND,
    kindTag: makeNip85KindTag(NIP85_USER_ASSERTION_KIND, "followers"),
    tag: "followers",
    label: "Followers",
    description: "Follower count as estimated by the provider.",
    format: "number",
  },
  {
    kind: NIP85_USER_ASSERTION_KIND,
    kindTag: makeNip85KindTag(NIP85_USER_ASSERTION_KIND, "post_cnt"),
    tag: "post_cnt",
    label: "Posts",
    description: "The number of root posts this provider attributes to the account.",
    format: "number",
  },
  {
    kind: NIP85_USER_ASSERTION_KIND,
    kindTag: makeNip85KindTag(NIP85_USER_ASSERTION_KIND, "reply_cnt"),
    tag: "reply_cnt",
    label: "Replies",
    description: "The number of replies this provider attributes to the account.",
    format: "number",
  },
  {
    kind: NIP85_USER_ASSERTION_KIND,
    kindTag: makeNip85KindTag(NIP85_USER_ASSERTION_KIND, "reactions_cnt"),
    tag: "reactions_cnt",
    label: "Reactions",
    description: "How many reactions this provider has observed from the account.",
    format: "number",
  },
  {
    kind: NIP85_USER_ASSERTION_KIND,
    kindTag: makeNip85KindTag(NIP85_USER_ASSERTION_KIND, "first_created_at"),
    tag: "first_created_at",
    label: "First Activity",
    description: "The first known activity time for the account.",
    format: "date",
  },
  {
    kind: NIP85_USER_ASSERTION_KIND,
    kindTag: makeNip85KindTag(NIP85_USER_ASSERTION_KIND, "zap_amt_recd"),
    tag: "zap_amt_recd",
    label: "Zaps Received",
    description: "Total sats received according to the provider.",
    format: "sats",
  },
  {
    kind: NIP85_USER_ASSERTION_KIND,
    kindTag: makeNip85KindTag(NIP85_USER_ASSERTION_KIND, "zap_amt_sent"),
    tag: "zap_amt_sent",
    label: "Zaps Sent",
    description: "Total sats sent according to the provider.",
    format: "sats",
  },
  {
    kind: NIP85_USER_ASSERTION_KIND,
    kindTag: makeNip85KindTag(NIP85_USER_ASSERTION_KIND, "zap_cnt_recd"),
    tag: "zap_cnt_recd",
    label: "Zap Count Received",
    description: "The number of zaps received by the account.",
    format: "number",
  },
  {
    kind: NIP85_USER_ASSERTION_KIND,
    kindTag: makeNip85KindTag(NIP85_USER_ASSERTION_KIND, "zap_cnt_sent"),
    tag: "zap_cnt_sent",
    label: "Zap Count Sent",
    description: "The number of zaps sent by the account.",
    format: "number",
  },
  {
    kind: NIP85_USER_ASSERTION_KIND,
    kindTag: makeNip85KindTag(NIP85_USER_ASSERTION_KIND, "zap_avg_amt_day_recd"),
    tag: "zap_avg_amt_day_recd",
    label: "Avg Zaps/Day Received",
    description: "Average sats received per day.",
    format: "satsPerDay",
  },
  {
    kind: NIP85_USER_ASSERTION_KIND,
    kindTag: makeNip85KindTag(NIP85_USER_ASSERTION_KIND, "zap_avg_amt_day_sent"),
    tag: "zap_avg_amt_day_sent",
    label: "Avg Zaps/Day Sent",
    description: "Average sats sent per day.",
    format: "satsPerDay",
  },
  {
    kind: NIP85_USER_ASSERTION_KIND,
    kindTag: makeNip85KindTag(NIP85_USER_ASSERTION_KIND, "reports_cnt_recd"),
    tag: "reports_cnt_recd",
    label: "Reports Received",
    description: "The number of reports this provider has seen against the account.",
    format: "number",
  },
  {
    kind: NIP85_USER_ASSERTION_KIND,
    kindTag: makeNip85KindTag(NIP85_USER_ASSERTION_KIND, "reports_cnt_sent"),
    tag: "reports_cnt_sent",
    label: "Reports Sent",
    description: "The number of reports this provider has seen from the account.",
    format: "number",
  },
  {
    kind: NIP85_USER_ASSERTION_KIND,
    kindTag: makeNip85KindTag(NIP85_USER_ASSERTION_KIND, "t"),
    tag: "t",
    label: "Common Topics",
    description: "Common topics the provider associates with the account.",
    format: "topics",
  },
  {
    kind: NIP85_USER_ASSERTION_KIND,
    kindTag: makeNip85KindTag(NIP85_USER_ASSERTION_KIND, "active_hours_start"),
    tag: "active_hours_start",
    label: "Active Hours Start",
    description: "The start of the account's typical active window in UTC.",
    format: "hour",
  },
  {
    kind: NIP85_USER_ASSERTION_KIND,
    kindTag: makeNip85KindTag(NIP85_USER_ASSERTION_KIND, "active_hours_end"),
    tag: "active_hours_end",
    label: "Active Hours End",
    description: "The end of the account's typical active window in UTC.",
    format: "hour",
  },
]

const USER_METRICS_BY_TAG = new Map(NIP85_USER_METRICS.map(metric => [metric.tag, metric]))
const USER_METRICS_BY_KIND_TAG = new Map(NIP85_USER_METRICS.map(metric => [metric.kindTag, metric]))

export const getNip85CapabilityLabel = (kindTag: string) => {
  const metric = USER_METRICS_BY_KIND_TAG.get(kindTag)

  if (metric) {
    return `User - ${metric.label}`
  }

  const [kindValue, tag] = kindTag.split(":")
  const subject =
    {
      [NIP85_USER_ASSERTION_KIND]: "User",
      [NIP85_EVENT_ASSERTION_KIND]: "Event",
      [NIP85_ADDRESSABLE_ASSERTION_KIND]: "Address",
      [NIP85_EXTERNAL_ASSERTION_KIND]: "Identifier",
    }[Number.parseInt(kindValue || "", 10)] || "Metric"

  return `${subject} - ${tag || kindTag}`
}

export const getNip85CapabilityDescription = (kindTag: string) => {
  const metric = USER_METRICS_BY_KIND_TAG.get(kindTag)

  if (metric) {
    return metric.description
  }

  const [kindValue, tag] = kindTag.split(":")
  const kind = Number.parseInt(kindValue || "", 10)

  if (kind === NIP85_USER_ASSERTION_KIND) {
    return `Provider-defined user metric published as \`${tag || kindTag}\`.`
  }

  return "Provider-defined metric discovered through public NIP-85 configuration."
}

export const isNip85KnownCapability = (kindTag: string) => USER_METRICS_BY_KIND_TAG.has(kindTag)

export const getNip85RecommenderWeight = (
  author: string,
  currentPubkey: string,
  follows: string[] | Set<string>,
  wotGraph: Map<string, number>,
) => {
  const followSet = follows instanceof Set ? follows : new Set(follows)

  if (author === currentPubkey) {
    return 5
  }

  if (followSet.has(author)) {
    return 3
  }

  return Math.max(1, wotGraph.get(author) || 0)
}

export const getNip85UserMetricDefinition = (tag: string) => USER_METRICS_BY_TAG.get(tag)

export const getNip85UserMetricLabel = (tag: string) => USER_METRICS_BY_TAG.get(tag)?.label || tag

export const hasNip85MetricValue = (value: Nip85MetricValue) => {
  if (Array.isArray(value)) return value.length > 0

  return value !== undefined && value !== null && value !== ""
}

export const extractNip85AssertionTagNames = (
  event: Pick<TrustedEvent, "tags">,
  ignoredTags = DEFAULT_IGNORED_ASSERTION_TAGS,
) => {
  const tags = new Set<string>()

  for (const tag of event.tags) {
    const [name, value] = tag

    if (!name || ignoredTags.has(name)) continue
    if (value === undefined || value === "") continue

    tags.add(name)
  }

  return Array.from(tags)
}

export const parseNip85UserAssertion = (event: TrustedEvent): Nip85UserAssertion | undefined => {
  if (event.kind !== NIP85_USER_ASSERTION_KIND) return

  const pubkey = getTagValue("d", event.tags)

  if (!pubkey) return

  const assertion: Nip85UserAssertion = {pubkey}

  for (const tag of event.tags) {
    const [name, value] = tag

    if (!name) continue
    if (name === "d") continue

    const numberValue = parseNumberValue(value)

    switch (name) {
      case "rank":
        if (numberValue !== undefined) assertion.rank = numberValue
        break
      case "followers":
        if (numberValue !== undefined) assertion.followers = numberValue
        break
      case "first_created_at":
        if (numberValue !== undefined) assertion.firstCreatedAt = numberValue
        break
      case "post_cnt":
        if (numberValue !== undefined) assertion.postCnt = numberValue
        break
      case "reply_cnt":
        if (numberValue !== undefined) assertion.replyCnt = numberValue
        break
      case "reactions_cnt":
        if (numberValue !== undefined) assertion.reactionsCnt = numberValue
        break
      case "zap_amt_recd":
        if (numberValue !== undefined) assertion.zapAmtRecd = numberValue
        break
      case "zap_amt_sent":
        if (numberValue !== undefined) assertion.zapAmtSent = numberValue
        break
      case "zap_cnt_recd":
        if (numberValue !== undefined) assertion.zapCntRecd = numberValue
        break
      case "zap_cnt_sent":
        if (numberValue !== undefined) assertion.zapCntSent = numberValue
        break
      case "zap_avg_amt_day_recd":
        if (numberValue !== undefined) assertion.zapAvgAmtDayRecd = numberValue
        break
      case "zap_avg_amt_day_sent":
        if (numberValue !== undefined) assertion.zapAvgAmtDaySent = numberValue
        break
      case "reports_cnt_recd":
        if (numberValue !== undefined) assertion.reportsCntRecd = numberValue
        break
      case "reports_cnt_sent":
        if (numberValue !== undefined) assertion.reportsCntSent = numberValue
        break
      case "active_hours_start":
        if (numberValue !== undefined) assertion.activeHoursStart = numberValue
        break
      case "active_hours_end":
        if (numberValue !== undefined) assertion.activeHoursEnd = numberValue
        break
      case "t":
        if (!value) break
        assertion.commonTopics = [...(assertion.commonTopics || []), value]
        break
      default:
        if (!value) break
        assertion.extraMetrics = {...(assertion.extraMetrics || {}), [name]: numberValue ?? value}
    }
  }

  return assertion
}

export const getNip85UserAssertionValue = (
  assertion: Nip85UserAssertion,
  tag: string,
): Nip85MetricValue => {
  switch (tag) {
    case "rank":
      return assertion.rank
    case "followers":
      return assertion.followers
    case "first_created_at":
      return assertion.firstCreatedAt
    case "post_cnt":
      return assertion.postCnt
    case "reply_cnt":
      return assertion.replyCnt
    case "reactions_cnt":
      return assertion.reactionsCnt
    case "zap_amt_recd":
      return assertion.zapAmtRecd
    case "zap_amt_sent":
      return assertion.zapAmtSent
    case "zap_cnt_recd":
      return assertion.zapCntRecd
    case "zap_cnt_sent":
      return assertion.zapCntSent
    case "zap_avg_amt_day_recd":
      return assertion.zapAvgAmtDayRecd
    case "zap_avg_amt_day_sent":
      return assertion.zapAvgAmtDaySent
    case "reports_cnt_recd":
      return assertion.reportsCntRecd
    case "reports_cnt_sent":
      return assertion.reportsCntSent
    case "t":
      return assertion.commonTopics
    case "active_hours_start":
      return assertion.activeHoursStart
    case "active_hours_end":
      return assertion.activeHoursEnd
    default:
      return assertion.extraMetrics?.[tag]
  }
}

export const getNip85UserAssertionAvailableTags = (assertion?: Nip85UserAssertion) => {
  if (!assertion) return []

  const tags = NIP85_USER_METRICS.map(metric => metric.tag).filter(tag =>
    hasNip85MetricValue(getNip85UserAssertionValue(assertion, tag)),
  )

  return [...tags, ...Object.keys(assertion.extraMetrics || {})].filter(
    (tag, index, all) => all.indexOf(tag) === index,
  )
}

export const formatNip85UserMetricValue = (tag: string, value: Nip85MetricValue) => {
  if (!hasNip85MetricValue(value)) return ""

  if (Array.isArray(value)) {
    return value.join(", ")
  }

  const format = getNip85UserMetricDefinition(tag)?.format || "text"

  if (typeof value !== "number") {
    return String(value)
  }

  switch (format) {
    case "rank":
      return `${Math.round(value)} / 100`
    case "number":
      return Math.round(value).toLocaleString()
    case "sats":
      return `${Math.round(value).toLocaleString()} sats`
    case "satsPerDay":
      return `${Math.round(value).toLocaleString()} sats/day`
    case "date":
      return new Date(value * 1000).toLocaleDateString()
    case "hour": {
      const hour = Math.max(0, Math.min(23, Math.round(value)))
      return `${hour.toString().padStart(2, "0")}:00 UTC`
    }
    default:
      return value.toLocaleString()
  }
}

export const aggregateNip85UserAssertions = (
  results: Map<string, Nip85FetchedUserAssertion>,
  providers: Nip85ConfiguredProvider[],
): Nip85UserAssertionSummary => {
  const summary: Nip85UserAssertionSummary = {providerCount: 0}
  const providersByCapability = getNip85ConfiguredProvidersByCapability(
    providers.filter(provider => provider.kind === NIP85_USER_ASSERTION_KIND),
  )
  const providerCount = new Set<string>()

  for (const result of results.values()) {
    if (result.status === "data" && result.assertion && result.availableTags.length > 0) {
      providerCount.add(result.serviceKey)
    }
  }

  summary.providerCount = providerCount.size

  for (const [kindTag, providersForCapability] of providersByCapability.entries()) {
    if (providersForCapability.length !== 1) continue

    const provider = providersForCapability[0]
    const result = results.get(provider.serviceKey)
    const value = result?.assertion
      ? getNip85UserAssertionValue(result.assertion, provider.tag)
      : undefined

    if (!hasNip85MetricValue(value)) continue

    switch (kindTag) {
      case "30382:rank":
        summary.rank = Number(value)
        break
      case "30382:followers":
        summary.followers = Number(value)
        break
      case "30382:first_created_at":
        summary.firstCreatedAt = Number(value)
        break
      case "30382:post_cnt":
        summary.postCnt = Number(value)
        break
      case "30382:reply_cnt":
        summary.replyCnt = Number(value)
        break
      case "30382:reactions_cnt":
        summary.reactionsCnt = Number(value)
        break
      case "30382:zap_amt_recd":
        summary.zapAmtRecd = Number(value)
        break
      case "30382:zap_amt_sent":
        summary.zapAmtSent = Number(value)
        break
      case "30382:zap_cnt_recd":
        summary.zapCntRecd = Number(value)
        break
      case "30382:zap_cnt_sent":
        summary.zapCntSent = Number(value)
        break
      case "30382:zap_avg_amt_day_recd":
        summary.zapAvgAmtDayRecd = Number(value)
        break
      case "30382:zap_avg_amt_day_sent":
        summary.zapAvgAmtDaySent = Number(value)
        break
      case "30382:reports_cnt_recd":
        summary.reportsCntRecd = Number(value)
        break
      case "30382:reports_cnt_sent":
        summary.reportsCntSent = Number(value)
        break
      case "30382:t":
        summary.commonTopics = Array.isArray(value) ? value : [String(value)]
        break
      case "30382:active_hours_start":
        summary.activeHoursStart = Number(value)
        break
      case "30382:active_hours_end":
        summary.activeHoursEnd = Number(value)
        break
    }
  }

  return summary
}

export const getNip85RecommendationAuthors = (
  currentPubkey: string,
  follows: string[],
  wotGraph: Map<string, number>,
  {followLimit, wotLimit}: {followLimit?: number; wotLimit?: number} = {},
) => {
  const directFollows = follows
    .map(normalizeNip85Pubkey)
    .filter(pubkey => pubkey && pubkey !== currentPubkey)
  const limitedFollows = Number.isFinite(followLimit)
    ? directFollows.slice(0, followLimit)
    : directFollows
  const followedSet = new Set(limitedFollows)
  const wotPubkeys = Array.from(wotGraph.entries())
    .filter(([pubkey, score]) => pubkey !== currentPubkey && score > 0 && !followedSet.has(pubkey))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, Number.isFinite(wotLimit) ? wotLimit : undefined)
    .map(([pubkey]) => pubkey)

  return [currentPubkey, ...limitedFollows, ...wotPubkeys].filter(
    (pubkey, index, all) => pubkey && all.indexOf(pubkey) === index,
  )
}

export const getNip85VerificationSamplePubkeys = (
  currentPubkey: string,
  wotGraph: Map<string, number>,
  sampleSize = 3,
) => {
  const pubkeys = [
    currentPubkey,
    ...Array.from(wotGraph.entries())
      .filter(([pubkey, score]) => pubkey !== currentPubkey && score > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([pubkey]) => pubkey),
  ].filter((pubkey, index, all) => pubkey && all.indexOf(pubkey) === index)

  return pubkeys.slice(0, sampleSize)
}

export const aggregateNip85RecommendedProviders = ({
  currentPubkey,
  follows,
  wotGraph,
  configsByAuthor,
  kind = NIP85_USER_ASSERTION_KIND,
}: {
  currentPubkey: string
  follows: string[]
  wotGraph: Map<string, number>
  configsByAuthor: Map<string, Nip85ConfiguredProvider[]>
  kind?: number
}) => {
  const followsSet = new Set(follows)
  const aggregated = new Map<string, Nip85RecommendedProvider>()

  for (const [author, providers] of configsByAuthor.entries()) {
    const weight = getNip85RecommenderWeight(author, currentPubkey, followsSet, wotGraph)
    const seen = new Set<string>()

    for (const provider of providers) {
      if (provider.kind !== kind) continue

      const key = getNip85ProviderKey(provider)

      if (seen.has(key)) continue
      seen.add(key)

      const existing = aggregated.get(key)

      if (existing) {
        aggregated.set(key, {
          ...existing,
          usageCount: existing.usageCount + 1,
          score: existing.score + weight,
          recommenders: [...existing.recommenders, author].filter(
            (pubkey, index, all) => all.indexOf(pubkey) === index,
          ),
        })
      } else {
        aggregated.set(key, {
          kindTag: provider.kindTag,
          kind: provider.kind,
          tag: provider.tag,
          serviceKey: provider.serviceKey,
          relayHint: provider.relayHint,
          usageCount: 1,
          recommenders: [author],
          score: weight,
        })
      }
    }
  }

  const byCapability = new Map<string, Nip85RecommendedProvider[]>()

  for (const provider of aggregated.values()) {
    const providersForCapability = byCapability.get(provider.kindTag) || []

    providersForCapability.push(provider)
    byCapability.set(provider.kindTag, providersForCapability)
  }

  for (const providers of byCapability.values()) {
    providers.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score
      if (a.usageCount !== b.usageCount) return b.usageCount - a.usageCount
      return a.serviceKey.localeCompare(b.serviceKey)
    })
  }

  return byCapability
}
