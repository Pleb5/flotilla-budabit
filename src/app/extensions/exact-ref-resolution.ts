import {verifyEvent} from "nostr-tools/pure"

export type ExactRefResolution = {
  ref: string
  status: "found" | "deleted" | "missing" | "unavailable"
}

const address = (event: any) =>
  `${event.kind}:${event.pubkey}:${event.tags.find((t: string[]) => t[0] === "d")?.[1] || ""}`

// Only ask for tombstones in the scope already authorized by the event query.
export const exactRefDeletionFilters = (filters: Record<string, any>[]) =>
  filters.map(filter =>
    filter.ids
      ? {kinds: [5], "#e": filter.ids, limit: 100}
      : {
          kinds: [5],
          authors: filter.authors,
          "#a": filter["#d"].map((d: string) => `${filter.kinds[0]}:${filter.authors[0]}:${d}`),
          limit: 100,
        },
  )

export function resolveExactRefs(
  refs: string[],
  events: any[],
  tombstones: any[],
  complete: boolean,
  now = Math.floor(Date.now() / 1000),
) {
  const validDeletes = tombstones.filter(event => {
    try {
      return (
        event.kind === 5 &&
        Number.isInteger(event.created_at) &&
        event.created_at <= now &&
        event.created_at >= 0 &&
        verifyEvent({
          id: event.id,
          pubkey: event.pubkey,
          created_at: event.created_at,
          kind: event.kind,
          tags: event.tags,
          content: event.content,
          sig: event.sig,
        })
      )
    } catch {
      return false
    }
  })
  const retained = new Set<any>()
  const resolutions: ExactRefResolution[] = refs.map(ref => {
    const isId = /^[0-9a-f]{64}$/i.test(ref)
    const candidates = events.filter(event => (isId ? event.id === ref : address(event) === ref))
    const deletes = validDeletes.filter(deletion => {
      const author = isId ? candidates[0]?.pubkey : ref.split(":")[1]
      // An ID alone cannot prove the original author's identity.
      return (
        author &&
        deletion.pubkey === author &&
        deletion.tags.some((tag: string[]) => tag[0] === (isId ? "e" : "a") && tag[1] === ref)
      )
    })
    const survivors = candidates.filter(
      event => !deletes.some(deletion => deletion.created_at >= event.created_at),
    )
    survivors.sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))
    if (survivors[0]) retained.add(survivors[0])
    return {
      ref,
      status: survivors.length
        ? "found"
        : deletes.length
          ? "deleted"
          : complete
            ? "missing"
            : "unavailable",
    }
  })
  return {events: events.filter(event => retained.has(event)), resolutions}
}
