import {setPublishPolicy, type PublishPolicy} from "@welshman/net"
import {isRelayUrl, normalizeRelayUrl} from "@welshman/util"

export const RELAY_WRITE_CAPABILITY_TTL = 24 * 60 * 60 * 1000
export const RELAY_WRITE_CAPABILITY_STORAGE_KEY = "relay.writeCapabilities.v1"
const MAX_ENTRIES = 512

type Observation = {
  relay: string
  kind: number
  detail: string
  observedAt: number
}

type CapabilityStorage = Pick<Storage, "getItem" | "setItem">

/** Only an unqualified, explicit kind-wide denial is evidence for other events.
 * Deliberately excludes community/author restrictions and arbitrary blocked text.
 */
export const getUnsupportedRelayKind = (detail: string): number | undefined => {
  const match = detail
    .trim()
    .match(
      /^(?:blocked|restricted):\s*(?:event )?kind\s+(\d+)\s+is\s+(?:not allowed|not supported|unsupported|disabled)(?:\s+(?:on|by) this relay)?[.!]?$/i,
    )
  if (!match) return undefined
  const kind = Number(match[1])
  return Number.isSafeInteger(kind) && kind >= 0 && kind <= 65535 ? kind : undefined
}

const normalize = (relay: string) => {
  try {
    const url = normalizeRelayUrl(relay)
    return isRelayUrl(url) ? url : undefined
  } catch {
    return undefined
  }
}

export const createRelayWriteCapabilityPolicy = ({
  storage,
  now = Date.now,
}: {
  storage?: CapabilityStorage
  now?: () => number
} = {}): PublishPolicy => {
  const observations = new Map<string, Observation>()
  const key = (relay: string, kind: number) => JSON.stringify([relay, kind])
  const fresh = (observation: Observation) =>
    observation.observedAt <= now() && now() - observation.observedAt < RELAY_WRITE_CAPABILITY_TTL

  try {
    const stored: unknown = JSON.parse(storage?.getItem(RELAY_WRITE_CAPABILITY_STORAGE_KEY) || "[]")
    if (Array.isArray(stored)) {
      for (const entry of stored.slice(-MAX_ENTRIES)) {
        if (
          !entry ||
          typeof entry.relay !== "string" ||
          typeof entry.detail !== "string" ||
          entry.detail.length > 256 ||
          !Number.isSafeInteger(entry.observedAt) ||
          !Number.isInteger(entry.kind) ||
          getUnsupportedRelayKind(entry.detail) !== entry.kind ||
          !fresh(entry)
        )
          continue
        const relay = normalize(entry.relay)
        if (relay)
          observations.set(key(relay, entry.kind), {
            relay,
            kind: entry.kind,
            detail: entry.detail,
            observedAt: entry.observedAt,
          })
      }
    }
  } catch {
    // Storage may be disabled, full, or from an older application version.
  }

  const persist = () => {
    for (const [id, observation] of observations) {
      if (!fresh(observation)) observations.delete(id)
    }
    while (observations.size > MAX_ENTRIES) observations.delete(observations.keys().next().value!)
    try {
      storage?.setItem(
        RELAY_WRITE_CAPABILITY_STORAGE_KEY,
        JSON.stringify([...observations.values()]),
      )
    } catch {
      // The in-memory policy still works when persistence is unavailable.
    }
  }

  return {
    check(relay, event) {
      const normalized = normalize(relay)
      if (!normalized) return
      const id = key(normalized, event.kind)
      const observation = observations.get(id)
      if (!observation) return
      if (!fresh(observation)) {
        observations.delete(id)
        return
      }
      return {detail: observation.detail}
    },
    observeAck(relay, event, ok, detail) {
      const normalized = normalize(relay)
      if (!normalized) return
      const id = key(normalized, event.kind)
      if (ok === true) {
        if (observations.delete(id)) persist()
      } else if (
        ok === false &&
        typeof detail === "string" &&
        detail.length <= 256 &&
        getUnsupportedRelayKind(detail) === event.kind
      ) {
        observations.delete(id)
        observations.set(id, {
          relay: normalized,
          kind: event.kind,
          detail: detail.trim(),
          observedAt: now(),
        })
        persist()
      }
    },
  }
}

export const installRelayWriteCapabilityPolicy = () => {
  let storage: CapabilityStorage | undefined
  try {
    storage = globalThis.localStorage
  } catch {
    // Some browsers deny access to localStorage entirely.
  }
  return setPublishPolicy(createRelayWriteCapabilityPolicy({storage}))
}
