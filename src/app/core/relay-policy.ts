import {forceLoadRelay, getRelay, loadRelay} from "@welshman/app"
import {on} from "@welshman/lib"
import {
  setRequestPolicy,
  SocketEvent,
  SocketStatus,
  type RelayRequestPolicy,
  type Socket,
} from "@welshman/net"
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
  maxLimit?: number
}

type RelayProfileWithLimits = RelayProfile & {
  limitation?: RelayProfile["limitation"] & {
    max_subscriptions?: number
    max_message_length?: number
    max_limit?: number
  }
}

const DEFAULT_MAX_LIMIT = 200

const DEFAULT_RELAY_POLICY: RelayPolicy = {
  auth: "optional",
  maxSubscriptions: 28,
  maxFiltersPerSubscription: 10,
  maxLiveSubscriptions: 24,
  maxBackgroundLiveSubscriptions: 18,
  criticalLivePriority: 200,
  maxMessageBytes: 128 * 1024,
  maxLimit: DEFAULT_MAX_LIMIT,
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

// Read directly from the environment rather than @app/core/state to avoid a
// circular import (state.ts imports this module).
export const SIGNER_POLICY_RELAYS = new Set(
  ((import.meta.env.VITE_SIGNER_RELAYS as string) || "")
    .split(",")
    .filter(Boolean)
    .map(normalizePolicyRelay),
)
export const RELAY_POLICY_REFRESH_INTERVAL = 60 * 60 * 1000

const relayPolicyRefreshes = new Map<string, Promise<RelayPolicy>>()
const relayPolicyRefreshedAt = new Map<string, number>()

const RELAY_POLICY_OVERRIDES = new Map<string, Partial<RelayPolicy>>([
  [
    BUDABIT_PUBLIC_RELAY,
    {
      auth: "none",
      // The relay advertises 30 IDs. Keep two outside Budabit's managed
      // budget for recovery, diagnostics, and transient reconnect overlap.
      maxSubscriptions: 28,
      maxFiltersPerSubscription: 10,
      maxLiveSubscriptions: 24,
      maxBackgroundLiveSubscriptions: 18,
      criticalLivePriority: 200,
      maxMessageBytes: 128 * 1024,
      maxLimit: 200,
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

const readRelayPolicy = (url: string): RelayPolicy => {
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
  const configuredMaxLimit = positiveInteger(override?.maxLimit, DEFAULT_MAX_LIMIT)

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
    maxLimit: Math.min(
      configuredMaxLimit,
      positiveInteger(profile?.limitation?.max_limit, configuredMaxLimit),
    ),
  }
}

export const refreshRelayPolicy = (url: string, force = false): Promise<RelayPolicy> => {
  const normalized = normalizePolicyRelay(url)
  const pending = relayPolicyRefreshes.get(normalized)
  const refreshedAt = relayPolicyRefreshedAt.get(normalized)

  if (pending) return pending
  if (
    !force &&
    refreshedAt !== undefined &&
    Date.now() - refreshedAt < RELAY_POLICY_REFRESH_INTERVAL
  ) {
    return Promise.resolve(readRelayPolicy(normalized))
  }

  relayPolicyRefreshedAt.set(normalized, Date.now())
  const promise = (force ? forceLoadRelay : loadRelay)(normalized)
    .catch(() => undefined)
    .then(() => readRelayPolicy(normalized))
    .finally(() => {
      if (relayPolicyRefreshes.get(normalized) === promise) {
        relayPolicyRefreshes.delete(normalized)
      }
    })

  relayPolicyRefreshes.set(normalized, promise)

  return promise
}

export const getRelayPolicy = (url: string): RelayPolicy => {
  const normalized = normalizePolicyRelay(url)

  void refreshRelayPolicy(normalized)

  return readRelayPolicy(normalized)
}

export const loadRelayPolicy = (url: string) => refreshRelayPolicy(url, true)

export const relayPolicyRefreshPolicy = (socket: Socket) =>
  on(socket, SocketEvent.Status, status => {
    if (status === SocketStatus.Open) void refreshRelayPolicy(socket.url)
  })

export const getRelayRequestPolicy = (url: string): RelayRequestPolicy => {
  const policy = getRelayPolicy(url)

  return {
    maxSubscriptions: policy.maxSubscriptions,
    maxFiltersPerSubscription: policy.maxFiltersPerSubscription,
    maxLiveSubscriptions: policy.maxLiveSubscriptions,
    maxBackgroundLiveSubscriptions: policy.maxBackgroundLiveSubscriptions,
    criticalLivePriority: policy.criticalLivePriority,
    maxMessageBytes: policy.maxMessageBytes,
    // The NIP-46 handshake/receiver REQ is issued by @welshman/signer without
    // an explicit priority. Signer relays are dedicated to that traffic, so
    // default their requests to critical-live priority to keep the login
    // handshake from being queued behind background subscriptions.
    ...(SIGNER_POLICY_RELAYS.has(normalizePolicyRelay(url))
      ? {priority: RELAY_REQUEST_PRIORITY.authority}
      : {}),
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
