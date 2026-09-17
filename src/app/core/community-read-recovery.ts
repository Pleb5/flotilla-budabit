import {writable} from "svelte/store"
import {normalizeRelayUrl} from "@welshman/util"
import type {CommunityRelayLoadResult, CommunityRelayOutcome} from "./community-state"

type Failure = {failures: number; policyFailures: number; blocked: boolean}
const failures = new Map<string, Failure>()
export const communityReadRecoveryVersion = writable(0)
const notify = () => communityReadRecoveryVersion.update(value => value + 1)

// Recovery state, not an event/privacy boundary. A denial belongs to one
// community, account and relay; unrelated communities/readers must keep working.
// Neither a socket reconnect nor a late successful sibling query clears a block.
export const communityReadRecovery = (community: string, identity: string) => {
  const key = (relay: string) => JSON.stringify([community, identity, normalizeRelayUrl(relay)])
  const blocked = (relay: string) => failures.get(key(relay))?.blocked === true
  const record = (relay: string, outcome: CommunityRelayOutcome, policyRetryUsed = false) => {
    const id = key(relay)
    const previous = failures.get(id)
    if (previous?.blocked) return
    if (outcome === "complete") {
      failures.delete(id)
      return
    }
    const failure: Failure = {
      failures: (previous?.failures || 0) + 1,
      policyFailures: (previous?.policyFailures || 0) + (outcome === "policy-unavailable" ? 1 : 0),
      blocked: false,
    }
    failure.blocked =
      ["denied", "auth-cancelled", "auth-timeout", "auth-required"].includes(outcome) ||
      (outcome === "policy-unavailable" && (policyRetryUsed || failure.policyFailures > 1))
    failures.set(id, failure)
    if (failure.blocked) notify()
  }
  return {
    blocked,
    record,
    available: (relays: string[]) => relays.filter(relay => !blocked(relay)),
    // Transport recovery backs off instead of signing/querying every 5 seconds.
    delay: (relays: string[]) =>
      Math.max(
        5500,
        ...relays.map(relay =>
          Math.min(60_000, 5500 * 2 ** Math.min(4, (failures.get(key(relay))?.failures || 1) - 1)),
        ),
      ),
    closed: (relay: string, reason: string) =>
      record(
        relay,
        reason.startsWith("restricted:")
          ? "denied"
          : reason.startsWith("error:")
            ? "policy-unavailable"
            : reason.startsWith("auth-required:")
              ? "auth-required"
              : "disconnected",
      ),
    result: (result: CommunityRelayLoadResult) => {
      for (const [relay, outcome] of Object.entries(result.outcomes || {})) {
        // The status-aware finite loader already spent its single unavailable
        // retry. Do not start a fresh budget on each component timer.
        record(relay, outcome, true)
      }
    },
    // Only an explicit retry/access check may clear terminal recovery state.
    reset: (relays: string[]) => {
      let changed = false
      for (const relay of relays) changed = failures.delete(key(relay)) || changed
      if (changed) notify()
    },
  }
}
