import {DELETE, getAddress, isReplaceable, type TrustedEvent} from "@welshman/util"

const canDeleteTarget = (deletion: TrustedEvent, target: TrustedEvent) =>
  deletion.kind === DELETE &&
  deletion.pubkey === target.pubkey &&
  (!isReplaceable(target) || deletion.created_at >= target.created_at)

/** Replaceable content is deleted by coordinate, with a revision cutoff. */
export const deletionDeletesEvent = (deletion: TrustedEvent, target: TrustedEvent) =>
  canDeleteTarget(deletion, target) &&
  deletion.tags.some(tag =>
    isReplaceable(target)
      ? tag[0] === "a" && tag[1] === getAddress(target)
      : tag[0] === "e" && tag[1] === target.id,
  )

/** Index once for batch projections instead of scanning every author's targets. */
export const getDeletedTargetEventIds = (targets: TrustedEvent[], deletions: TrustedEvent[]) => {
  const byTarget = new Map<string, TrustedEvent[]>()
  for (const target of targets) {
    const key = isReplaceable(target) ? `a:${getAddress(target)}` : `e:${target.id}`
    const events = byTarget.get(key) || []
    events.push(target)
    byTarget.set(key, events)
  }
  const deleted = new Set<string>()
  for (const deletion of deletions) {
    if (deletion.kind !== DELETE) continue
    for (const tag of deletion.tags) {
      if (tag[0] !== "a" && tag[0] !== "e") continue
      for (const target of byTarget.get(`${tag[0]}:${tag[1]}`) || []) {
        if (canDeleteTarget(deletion, target)) deleted.add(target.id)
      }
    }
  }
  return deleted
}
