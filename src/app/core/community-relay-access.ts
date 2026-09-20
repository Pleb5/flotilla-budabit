import {pubkey, signer} from "@welshman/app"
import {AuthError, AuthStatus, Pool, SocketStatus} from "@welshman/net"
import {authenticateRelay} from "./relay-auth-coordinator"
import {recordRelayAuthRequired} from "./relay-policy"
import {loadCommunityEventsWithStatus, makeExactCommunityDefinitionFilter} from "./community-state"
import type {PrivateCommunityScope} from "./private-community-scope"
import {communityReadRecovery} from "./community-read-recovery"

// Explicit connection recovery, not a second reader or a content visibility gate.
// Delivered definitions use the ordinary loader, repository and persistence.
export const connectCommunityInvitation = async (
  scope: PrivateCommunityScope,
  signal: AbortSignal,
) => {
  const identity = pubkey.get()
  const signing = signer.get()
  if (!identity || !signing) throw Error("Connect a signing account to authenticate")
  if (scope.error || !scope.relays.length) throw Error(scope.error || "Missing invitation relays")
  const recovery = communityReadRecovery(scope.pointer.address, identity)
  const current = () => {
    if (signal.aborted || pubkey.get() !== identity || signer.get() !== signing)
      throw new AuthError("cancelled")
  }
  return Promise.all(
    scope.relays.map(async relay => {
      try {
        current()
        recordRelayAuthRequired(relay)
        const pool = Pool.get()
        const previous = pool._data.get(relay)
        // A denied/disconnected connection needs a fresh proof, not AUTH on a
        // stale pooled transport. Never remove a healthy shared connection.
        if (
          previous &&
          (previous._disposed ||
            [SocketStatus.Closed, SocketStatus.Closing, SocketStatus.Error].includes(
              previous.status,
            ) ||
            previous.auth.status === AuthStatus.Forbidden)
        )
          pool.remove(relay)
        await authenticateRelay(pool.get(relay), {signal, retry: true})
        current()
        // AUTH is not membership. Even an empty definition query must reach EOSE.
        const result = await loadCommunityEventsWithStatus(
          [relay],
          [makeExactCommunityDefinitionFilter(scope.pointer)],
          {signal},
        )
        current()
        if (result.complete) recovery.reset([relay])
        else recovery.result(result)
        return {
          relay,
          outcome: result.complete ? "complete" : result.outcomes?.[relay] || "disconnected",
        }
      } catch (error) {
        current()
        return {relay, outcome: error instanceof Error ? error.message : String(error)}
      }
    }),
  )
}
