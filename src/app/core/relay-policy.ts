import {getRelay, loadRelay} from "@welshman/app"
import {setRequestPolicy, type RelayRequestPolicy} from "@welshman/net"
import {normalizeRelayUrl, type RelayProfile} from "@welshman/util"

export type RelayAuthPolicy = "none" | "optional" | "required"

export type RelayPolicy = {
  auth: RelayAuthPolicy
  maxSubscriptions: number
  maxFiltersPerSubscription: number
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
  maxSubscriptions: 20,
  maxFiltersPerSubscription: 1,
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
      maxSubscriptions: 10,
      maxFiltersPerSubscription: 5,
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

  return {
    auth: override?.auth ?? getProfileAuthPolicy(profile),
    maxSubscriptions: positiveInteger(
      override?.maxSubscriptions ?? profile?.limitation?.max_subscriptions,
      DEFAULT_RELAY_POLICY.maxSubscriptions,
    ),
    maxFiltersPerSubscription: positiveInteger(
      override?.maxFiltersPerSubscription,
      DEFAULT_RELAY_POLICY.maxFiltersPerSubscription,
    ),
    maxMessageBytes: positiveInteger(
      override?.maxMessageBytes ?? profile?.limitation?.max_message_length,
      DEFAULT_RELAY_POLICY.maxMessageBytes,
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
    // Keep one relay subscription available for recovery and diagnostics.
    maxSubscriptions: Math.max(1, policy.maxSubscriptions - 1),
    maxFiltersPerSubscription: policy.maxFiltersPerSubscription,
    maxMessageBytes: policy.maxMessageBytes,
    reservedSubscriptions: Math.min(3, Math.max(0, policy.maxSubscriptions - 2)),
    reservedPriority: RELAY_REQUEST_PRIORITY.live,
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
