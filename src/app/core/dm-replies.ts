import type {TrustedEvent} from "@welshman/util"

// Freedom Builders code 104: native kind-4444 IDs, never quoted plaintext in tags.
export const dmReplyId = (event: TrustedEvent) => {
  const tags = event.tags.filter(tag => tag[0] === "e" && tag[3] === "reply")
  const id = tags.length === 1 ? tags[0][1] : undefined
  return id && /^[0-9a-f]{64}$/.test(id) && id !== event.id ? id : undefined
}

export const isDmReplyTarget = (event: TrustedEvent, account: string, peer: string) => {
  const recipients = event.tags.filter(tag => tag[0] === "p")
  return (
    event.kind === 4444 &&
    recipients.length === 1 &&
    ((event.pubkey === account && recipients[0][1] === peer) ||
      (event.pubkey === peer && recipients[0][1] === account))
  )
}

/** Causal display ordering: keeps replies after their loaded same-conversation parent even under clock skew. */
export const orderDmMessages = (events: TrustedEvent[], account: string, peer: string): TrustedEvent[] => {
  const base = [...events].sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id))
  const indices = new Map<string, number>()
  base.forEach((event, idx) => indices.set(event.id, idx))
  const parents = new Int32Array(base.length).fill(-1)
  const children: number[][] = Array.from({length: base.length}, () => [])
  for (let i = 0; i < base.length; i++) {
    const target = dmReplyId(base[i])
    const p = target ? indices.get(target) : undefined
    if (p !== undefined && p !== i && isDmReplyTarget(base[i], account, peer) && isDmReplyTarget(base[p], account, peer)) {
      parents[i] = p
      children[p].push(i)
    }
  }
  const ready: number[] = []
  const insertReady = (idx: number) => {
    let lo = 0
    let hi = ready.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (ready[mid] < idx) lo = mid + 1
      else hi = mid
    }
    ready.splice(lo, 0, idx)
  }
  for (let i = 0; i < parents.length; i++) {
    if (parents[i] === -1) ready.push(i)
  }
  const emitted = new Uint8Array(base.length)
  const result: TrustedEvent[] = []
  let fallback = 0
  while (result.length < base.length) {
    if (ready.length === 0) {
      while (emitted[fallback]) fallback++
      ready.push(fallback)
    }
    const i = ready.shift()!
    if (emitted[i]) continue
    emitted[i] = 1
    result.push(base[i])
    for (const child of children[i]) {
      if (!emitted[child]) insertReady(child)
    }
  }
  return result
}
