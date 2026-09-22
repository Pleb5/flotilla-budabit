import {setPublishPolicy, type PublishPolicy} from "@welshman/net"
import {isRelayUrl, normalizeRelayUrl} from "@welshman/util"

export const RELAY_WRITE_CAPABILITY_TTL = 24 * 60 * 60 * 1000
export const RELAY_WRITE_CAPABILITY_STORAGE_KEY = "relay.writeCapabilities.v2:"
const MAX_ENTRIES = 512

type Observation = {
  relay: string
  kind: number
  detail: string
  observedAt: number
}

type CapabilityStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">

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
  const key = (relay: string, kind: number) =>
    RELAY_WRITE_CAPABILITY_STORAGE_KEY + JSON.stringify([relay, kind])
  const fresh = (observation: Observation) =>
    observation.observedAt <= now() && now() - observation.observedAt < RELAY_WRITE_CAPABILITY_TTL
  const parse = (id: string, raw: string | null): Observation | undefined => {
    try {
      const entry = JSON.parse(raw || "null")
      if (
        entry &&
        typeof entry.relay === "string" &&
        typeof entry.detail === "string" &&
        entry.detail.length <= 256 &&
        Number.isSafeInteger(entry.observedAt) &&
        Number.isInteger(entry.kind) &&
        getUnsupportedRelayKind(entry.detail) === entry.kind &&
        normalize(entry.relay) === entry.relay &&
        key(entry.relay, entry.kind) === id &&
        fresh(entry)
      )
        return {
          relay: entry.relay,
          kind: entry.kind,
          detail: entry.detail,
          observedAt: entry.observedAt,
        }
    } catch {
      // Invalid persisted evidence is unknown, never a reason to skip.
    }
  }
  const trimMemory = () => {
    for (const [id, observation] of observations) {
      if (!fresh(observation)) observations.delete(id)
    }
    while (observations.size > MAX_ENTRIES) observations.delete(observations.keys().next().value!)
  }
  const trimStorage = () => {
    if (!storage) return
    const entries: {id: string; raw: string | null; observedAt: number}[] = []
    for (let index = 0; index < storage.length; index++) {
      const id = storage.key(index)
      if (!id?.startsWith(RELAY_WRITE_CAPABILITY_STORAGE_KEY)) continue
      const raw = storage.getItem(id)
      const observation = parse(id, raw)
      entries.push({id, raw, observedAt: observation?.observedAt ?? -Infinity})
    }
    entries.sort((a, b) => a.observedAt - b.observedAt || a.id.localeCompare(b.id))
    for (const [index, entry] of entries.entries()) {
      if (entry.observedAt !== -Infinity && index >= entries.length - MAX_ENTRIES) continue
      // Do not delete a refreshed entry based on an older pruning snapshot.
      if (storage.getItem(entry.id) === entry.raw) storage.removeItem(entry.id)
    }
  }
  const persist = (id: string, observation?: Observation) => {
    try {
      if (observation) {
        storage?.setItem(id, JSON.stringify(observation))
        trimStorage()
      } else storage?.removeItem(id)
    } catch {
      // Retain new in-memory evidence if writes are denied/full; subsequent
      // reads must not replace it with the last successfully persisted value.
      storage = undefined
    }
  }

  return {
    check(relay, event) {
      const normalized = normalize(relay)
      if (!normalized) return
      const id = key(normalized, event.kind)
      if (storage) {
        try {
          // One key per relay/kind: other tabs cannot overwrite unrelated ACKs.
          // Read at the decision boundary, including null after another tab's
          // acceptance, rather than relying on delayed browser storage events.
          const current = parse(id, storage.getItem(id))
          if (current) observations.set(id, current)
          else observations.delete(id)
        } catch {
          storage = undefined
        }
      }
      trimMemory()
      const observation = observations.get(id)
      if (observation) return {detail: observation.detail}
    },
    observeAck(relay, event, ok, detail) {
      const normalized = normalize(relay)
      if (!normalized) return
      const id = key(normalized, event.kind)
      if (ok === true) {
        observations.delete(id)
        // Acceptance invalidates shared evidence even if this tab never saw it.
        persist(id)
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
        persist(id, observations.get(id))
      }
      trimMemory()
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
