import {derived} from "svelte/store"
import {parseJson} from "@welshman/lib"
import {APP_DATA, makeEvent, type TrustedEvent} from "@welshman/util"
import {deriveItemsByKey, getter, makeLoadItem} from "@welshman/store"
import {
  ensurePlaintext,
  makeOutboxLoader,
  makeUserData,
  makeUserLoader,
  pubkey,
  publishThunk,
  repository,
  signer,
} from "@welshman/app"
import {Router} from "@welshman/router"
import {getNip85CapabilityLabel, getNip85ProviderKey, type Nip85ConfiguredProvider} from "./nip85"

export const TRUST_GRAPH_DTAG = "budabit/trust-graph"

export type TrustGraphRuleAction = "include" | "exclude"
export type TrustGraphRuleOperator = "gte" | "lte"
export type TrustGraphPreset = "balanced" | "conservative" | "open"

export type TrustGraphMetricSource =
  | {
      type: "basic_wot"
    }
  | {
      type: "nip85"
      serviceKey: string
      kindTag: string
    }

export type TrustGraphRule = {
  id: string
  enabled: boolean
  action: TrustGraphRuleAction
  operator: TrustGraphRuleOperator
  threshold: number
  source: TrustGraphMetricSource
}

export type TrustGraphConfig = {
  version: 1
  preset?: TrustGraphPreset
  rules: TrustGraphRule[]
}

export type TrustGraphConfigItem = {
  event: TrustedEvent
  values: TrustGraphConfig
}

export type TrustGraphMetricSourceOption = {
  value: string
  label: string
  source: TrustGraphMetricSource
}

export const defaultTrustGraphConfig: TrustGraphConfig = {
  version: 1,
  rules: [],
}

const isTrustGraphRuleAction = (value: unknown): value is TrustGraphRuleAction =>
  value === "include" || value === "exclude"

const isTrustGraphRuleOperator = (value: unknown): value is TrustGraphRuleOperator =>
  value === "gte" || value === "lte"

const isTrustGraphPreset = (value: unknown): value is TrustGraphPreset =>
  value === "balanced" || value === "conservative" || value === "open"

const makeTrustGraphRuleId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }

  return `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export const makeBasicWotMetricSource = (): TrustGraphMetricSource => ({type: "basic_wot"})

export const isNip85MetricSource = (
  source: TrustGraphMetricSource,
): source is Extract<TrustGraphMetricSource, {type: "nip85"}> => source.type === "nip85"

export const getTrustGraphMetricSourceValue = (source: TrustGraphMetricSource) => {
  if (source.type === "basic_wot") {
    return "basic_wot"
  }

  return `nip85:${source.serviceKey}:${source.kindTag}`
}

export const parseTrustGraphMetricSourceValue = (
  value: string,
): TrustGraphMetricSource | undefined => {
  if (value === "basic_wot") {
    return makeBasicWotMetricSource()
  }

  if (!value.startsWith("nip85:")) {
    return
  }

  const [, serviceKey, ...kindTagParts] = value.split(":")
  const kindTag = kindTagParts.join(":")

  if (!serviceKey || !kindTag) {
    return
  }

  return {type: "nip85", serviceKey, kindTag}
}

export const getTrustGraphMetricSourceLabel = (
  source: TrustGraphMetricSource,
  providers: Nip85ConfiguredProvider[] = [],
) => {
  if (source.type === "basic_wot") {
    return "Basic WoT score"
  }

  const provider = providers.find(
    provider => provider.serviceKey === source.serviceKey && provider.kindTag === source.kindTag,
  )

  if (provider) {
    return `${getNip85CapabilityLabel(provider.kindTag)} via ${provider.serviceKey.slice(0, 12)}...`
  }

  return `${getNip85CapabilityLabel(source.kindTag)} via ${source.serviceKey.slice(0, 12)}...`
}

export const makeTrustGraphMetricSourceOptions = (providers: Nip85ConfiguredProvider[]) => {
  const options = new Map<string, TrustGraphMetricSourceOption>()
  const basicSource = makeBasicWotMetricSource()

  options.set(getTrustGraphMetricSourceValue(basicSource), {
    value: getTrustGraphMetricSourceValue(basicSource),
    label: getTrustGraphMetricSourceLabel(basicSource),
    source: basicSource,
  })

  for (const provider of providers) {
    const source: TrustGraphMetricSource = {
      type: "nip85",
      serviceKey: provider.serviceKey,
      kindTag: provider.kindTag,
    }
    const value = getTrustGraphMetricSourceValue(source)

    if (!options.has(value)) {
      options.set(value, {
        value,
        label: getTrustGraphMetricSourceLabel(source, providers),
        source,
      })
    }
  }

  return Array.from(options.values()).sort((a, b) => a.label.localeCompare(b.label))
}

const normalizeTrustGraphMetricSource = (
  source: Partial<TrustGraphMetricSource> | undefined,
): TrustGraphMetricSource => {
  if (source?.type === "nip85" && source.serviceKey && source.kindTag) {
    return {
      type: "nip85",
      serviceKey: source.serviceKey,
      kindTag: source.kindTag,
    }
  }

  return makeBasicWotMetricSource()
}

export const normalizeTrustGraphRule = (rule?: Partial<TrustGraphRule> | null): TrustGraphRule => {
  const threshold = Number(rule?.threshold)

  return {
    id: rule?.id || makeTrustGraphRuleId(),
    enabled: rule?.enabled ?? true,
    action: isTrustGraphRuleAction(rule?.action) ? rule.action : "include",
    operator: isTrustGraphRuleOperator(rule?.operator) ? rule.operator : "gte",
    threshold: Number.isFinite(threshold) ? threshold : 1,
    source: normalizeTrustGraphMetricSource(rule?.source),
  }
}

export const normalizeTrustGraphConfig = (
  config?: Partial<TrustGraphConfig> | null,
): TrustGraphConfig => ({
  version: 1,
  preset: isTrustGraphPreset(config?.preset) ? config.preset : undefined,
  rules: (config?.rules || []).map(normalizeTrustGraphRule),
})

export const hasEnabledTrustGraphRules = (config?: TrustGraphConfig | null) =>
  Boolean(config?.rules.some(rule => rule.enabled))

export const trustGraphConfigByPubkey = deriveItemsByKey<TrustGraphConfigItem>({
  repository,
  getKey: item => item.event.pubkey,
  filters: [{kinds: [APP_DATA], "#d": [TRUST_GRAPH_DTAG]}],
  eventToItem: async event => {
    const values = normalizeTrustGraphConfig(parseJson(await ensurePlaintext(event)))

    return {event, values}
  },
})

export const getTrustGraphConfigByPubkey = getter(trustGraphConfigByPubkey)

export const getTrustGraphConfig = (pubkey: string) => getTrustGraphConfigByPubkey().get(pubkey)

export const loadTrustGraphConfig = makeLoadItem(
  makeOutboxLoader(APP_DATA, {"#d": [TRUST_GRAPH_DTAG]}),
  getTrustGraphConfig,
)

export const userTrustGraphConfig = makeUserData(trustGraphConfigByPubkey, loadTrustGraphConfig)

export const loadUserTrustGraphConfig = makeUserLoader(loadTrustGraphConfig)

export const userTrustGraphConfigValues = derived(
  userTrustGraphConfig,
  $config => $config?.values || defaultTrustGraphConfig,
)

export const saveTrustGraphConfig = async (config: TrustGraphConfig) => {
  const $pubkey = pubkey.get()
  const $signer = signer.get()

  if (!$pubkey || !$signer) {
    throw new Error("Sign in to update trust graph settings.")
  }

  const content = await $signer.nip44.encrypt(
    $pubkey,
    JSON.stringify(normalizeTrustGraphConfig(config)),
  )
  const event = makeEvent(APP_DATA, {content, tags: [["d", TRUST_GRAPH_DTAG]]})

  await publishThunk({event, relays: Router.get().FromUser().getUrls()})
}

const findPresetProviderSource = (
  providers: Nip85ConfiguredProvider[],
  kindTag: string,
): TrustGraphMetricSource | undefined => {
  const provider = providers.find(provider => provider.kindTag === kindTag)

  if (!provider) return

  return {
    type: "nip85",
    serviceKey: provider.serviceKey,
    kindTag: provider.kindTag,
  }
}

const makePresetRule = (
  source: TrustGraphMetricSource | undefined,
  action: TrustGraphRuleAction,
  operator: TrustGraphRuleOperator,
  threshold: number,
) => {
  if (!source) return

  return normalizeTrustGraphRule({
    action,
    operator,
    threshold,
    source,
    enabled: true,
  })
}

export const makeTrustGraphPreset = (
  preset: TrustGraphPreset,
  providers: Nip85ConfiguredProvider[],
) => {
  const rules: Array<TrustGraphRule | undefined> = []

  if (preset === "conservative") {
    rules.push(
      makePresetRule(findPresetProviderSource(providers, "30382:rank"), "include", "gte", 70),
      makePresetRule(
        findPresetProviderSource(providers, "30382:followers"),
        "include",
        "gte",
        1000,
      ),
      makePresetRule(
        findPresetProviderSource(providers, "30382:reports_cnt_recd"),
        "exclude",
        "gte",
        5,
      ),
    )
  }

  if (preset === "balanced") {
    rules.push(
      makePresetRule(findPresetProviderSource(providers, "30382:rank"), "include", "gte", 55),
      makePresetRule(findPresetProviderSource(providers, "30382:followers"), "include", "gte", 250),
      makePresetRule(
        findPresetProviderSource(providers, "30382:reports_cnt_recd"),
        "exclude",
        "gte",
        10,
      ),
    )
  }

  if (preset === "open") {
    rules.push(
      makePresetRule(findPresetProviderSource(providers, "30382:rank"), "include", "gte", 40),
      makePresetRule(findPresetProviderSource(providers, "30382:followers"), "include", "gte", 100),
      makePresetRule(
        findPresetProviderSource(providers, "30382:reports_cnt_recd"),
        "exclude",
        "gte",
        25,
      ),
    )
  }

  return normalizeTrustGraphConfig({
    preset,
    rules: rules.filter((rule): rule is TrustGraphRule => Boolean(rule)),
  })
}

export const getTrustGraphRuleKey = (rule: TrustGraphRule) =>
  rule.id || getTrustGraphMetricSourceValue(rule.source)

export const upsertTrustGraphRule = (config: TrustGraphConfig, rule: TrustGraphRule) => {
  const rules = config.rules.filter(existing => existing.id !== rule.id)

  rules.push(normalizeTrustGraphRule(rule))

  return normalizeTrustGraphConfig({...config, rules})
}

export const removeTrustGraphRule = (config: TrustGraphConfig, ruleId: string) =>
  normalizeTrustGraphConfig({
    ...config,
    rules: config.rules.filter(rule => rule.id !== ruleId),
  })

export const makeEmptyTrustGraphRule = (providers: Nip85ConfiguredProvider[]): TrustGraphRule => {
  const preferredProvider =
    providers.find(provider => provider.kindTag === "30382:rank") || providers[0]
  const source = preferredProvider
    ? ({
        type: "nip85",
        serviceKey: preferredProvider.serviceKey,
        kindTag: preferredProvider.kindTag,
      } satisfies TrustGraphMetricSource)
    : makeBasicWotMetricSource()

  return normalizeTrustGraphRule({
    action: "include",
    operator: "gte",
    threshold: source.type === "basic_wot" ? 1 : 50,
    source,
  })
}

export const pruneUnavailableTrustGraphRules = (
  config: TrustGraphConfig,
  providers: Nip85ConfiguredProvider[],
) => {
  const availableProviderKeys = new Set(providers.map(getNip85ProviderKey))

  return normalizeTrustGraphConfig({
    ...config,
    rules: config.rules.filter(rule => {
      if (!isNip85MetricSource(rule.source)) {
        return true
      }

      return availableProviderKeys.has(`${rule.source.serviceKey}:${rule.source.kindTag}`)
    }),
  })
}
