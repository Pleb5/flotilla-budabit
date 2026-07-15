import {getRelay, loadRelay} from "@welshman/app"
import {setRequestPolicy, type RelayRequestPolicy} from "@welshman/net"
import {normalizeRelayUrl, type RelayProfile} from "@welshman/util"

export type RelayAuthPolicy = "none" | "optional" | "required"

export type RelayPolicy = {
  auth: RelayAuthPolicy
  maxSubscriptions: number
  maxFiltersPerSubscription: number
  maxLiveSubscriptions: number
  maxBackgroundLiveSubscriptions: number
  criticalLivePriority: number
  maxMessageBytes: number
}

type RelayProfileWithLimits = RelayProfile & {
  limitation?: RelayProfile["limitation"] & {
    max_subscriptions?: number
    max_message_length?: number
  }
}

const DEFAULT_RELAY_POLICY: RelayPolicy = {
  auth: "optional",
  maxSubscriptions: 9,
  maxFiltersPerSubscription: 5,
  maxLiveSubscriptions: 7,
  maxBackgroundLiveSubscriptions: 5,
  criticalLivePriority: 200,
  maxMessageBytes: 128 * 1024,
}

const normalizePolicyRelay = (url: string) => {
  try {
    return normalizeRelayUrl(url)
  } catch {
    return url
  }
}

export const BUDABIT_PUBLIC_RELAY = normalizePolicyRelay("wss://relay.budabit.club/")
export const BUDABIT_AUTH_RELAY = normalizePolicyRelay("wss://budabit.nostr1.com/")

const RELAY_POLICY_OVERRIDES = new Map<string, Partial<RelayPolicy>>([
  [
    BUDABIT_PUBLIC_RELAY,
    {
      auth: "none",
      maxSubscriptions: 9,
      maxFiltersPerSubscription: 5,
      maxLiveSubscriptions: 7,
      maxBackgroundLiveSubscriptions: 5,
      criticalLivePriority: 200,
      maxMessageBytes: 128 * 1024,
    },
  ],
  [BUDABIT_AUTH_RELAY, {auth: "required"}],
])

export const RELAY_REQUEST_PRIORITY = {
  background: -100,
  default: 0,
  interactive: 100,
  live: 200,
  community: 300,
  authority: 400,
} as const

const getProfileAuthPolicy = (profile?: RelayProfileWithLimits): RelayAuthPolicy => {
  if (profile?.limitation?.auth_required) return "required"
  if (profile && !profile.supported_nips?.map(String).includes("42")) return "none"

  return "optional"
}

const positiveInteger = (value: unknown, fallback: number) =>
  Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : fallback

export const getRelayPolicy = (url: string): RelayPolicy => {
  const normalized = normalizePolicyRelay(url)
  const profile = (getRelay(normalized) || getRelay(url)) as RelayProfileWithLimits | undefined
  const override = RELAY_POLICY_OVERRIDES.get(normalized)
  const configuredMaxSubscriptions = positiveInteger(
    override?.maxSubscriptions,
    DEFAULT_RELAY_POLICY.maxSubscriptions,
  )
  const maxSubscriptions = Math.min(
    configuredMaxSubscriptions,
    positiveInteger(profile?.limitation?.max_subscriptions, configuredMaxSubscriptions),
  )
  const maxLiveSubscriptions = Math.min(
    positiveInteger(override?.maxLiveSubscriptions, DEFAULT_RELAY_POLICY.maxLiveSubscriptions),
    Math.max(1, maxSubscriptions - 2),
  )
  const configuredMaxMessageBytes = positiveInteger(
    override?.maxMessageBytes,
    DEFAULT_RELAY_POLICY.maxMessageBytes,
  )

  return {
    auth: override?.auth ?? getProfileAuthPolicy(profile),
    maxSubscriptions,
    maxFiltersPerSubscription: positiveInteger(
      override?.maxFiltersPerSubscription,
      DEFAULT_RELAY_POLICY.maxFiltersPerSubscription,
    ),
    maxLiveSubscriptions,
    maxBackgroundLiveSubscriptions: Math.min(
      positiveInteger(
        override?.maxBackgroundLiveSubscriptions,
        DEFAULT_RELAY_POLICY.maxBackgroundLiveSubscriptions,
      ),
      maxLiveSubscriptions,
    ),
    criticalLivePriority: positiveInteger(
      override?.criticalLivePriority,
      DEFAULT_RELAY_POLICY.criticalLivePriority,
    ),
    maxMessageBytes: Math.min(
      configuredMaxMessageBytes,
      positiveInteger(profile?.limitation?.max_message_length, configuredMaxMessageBytes),
    ),
  }
}

export const loadRelayPolicy = async (url: string) => {
  const normalized = normalizePolicyRelay(url)

  await loadRelay(normalized).catch(() => undefined)

  return getRelayPolicy(normalized)
}

export const getRelayRequestPolicy = (url: string): RelayRequestPolicy => {
  const policy = getRelayPolicy(url)

  return {
    maxSubscriptions: policy.maxSubscriptions,
    maxFiltersPerSubscription: policy.maxFiltersPerSubscription,
    maxLiveSubscriptions: policy.maxLiveSubscriptions,
    maxBackgroundLiveSubscriptions: policy.maxBackgroundLiveSubscriptions,
    criticalLivePriority: policy.criticalLivePriority,
    maxMessageBytes: policy.maxMessageBytes,
  }
}

export const installRelayRequestPolicy = () => setRequestPolicy(getRelayRequestPolicy)

export class RelayAuthenticationError extends Error {
  readonly name = "RelayAuthenticationError"

  constructor(
    readonly relay: string,
    readonly status: string,
  ) {
    super(`Authentication failed for ${relay}: ${status}`)
  }
}
