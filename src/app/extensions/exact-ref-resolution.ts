import {verifyEvent} from "nostr-tools/pure"

export type ExactRefResolution = {
  ref: string
  status: "found" | "deleted" | "missing" | "unavailable"
}

const isEventId = (ref: string) => /^[0-9a-f]{64}$/i.test(ref)

export const normalizeExactRef = (ref: string) => {
  if (isEventId(ref)) return ref.toLowerCase()
  const [kind, pubkey, ...identifier] = ref.split(":")
  return `${kind}:${pubkey?.toLowerCase()}:${identifier.join(":")}`
}

const referenceAddress = (event: any) =>
  `${event.kind}:${event.pubkey.toLowerCase()}:${event.tags.find((t: string[]) => t[0] === "d")?.[1] || ""}`

const address = (event: any) =>
  event.kind >= 30000 && event.kind < 40000 ? referenceAddress(event) : undefined

const verified = (event: any) => {
  try {
    // Do not copy nostr-tools' cached verification symbol from mutable objects.
    return verifyEvent({
      id: event.id,
      pubkey: event.pubkey,
      created_at: event.created_at,
      kind: event.kind,
      tags: event.tags,
      content: event.content,
      sig: event.sig,
    })
  } catch {
    return false
  }
}

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

// A verified, authorized candidate supplies the other representation and author.
// Exclude filters already covered by the first lookup; never discover new relays.
export const candidateDeletionFilters = (events: any[], queried: Record<string, any>[]) => {
  const filters: Record<string, any>[] = []
  for (const event of events) {
    if (event.kind === 5 || !verified(event)) continue
    const targets: Array<[string, string | undefined]> = [
      ["#e", event.id.toLowerCase()],
      ["#a", address(event)],
    ]
    for (const [tag, value] of targets) {
      if (!value) continue
      const covered = [...queried, ...filters].some(
        filter =>
          filter.kinds?.includes(5) &&
          (!filter.authors || filter.authors.includes(event.pubkey)) &&
          filter[tag]?.includes(value),
      )
      if (!covered) filters.push({kinds: [5], authors: [event.pubkey], [tag]: [value], limit: 100})
    }
  }
  return filters
}

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
        verified(event)
      )
    } catch {
      return false
    }
  })
  const retained = new Set<any>()
  const resolutions: ExactRefResolution[] = refs.map(ref => {
    const normalized = normalizeExactRef(ref)
    const isId = isEventId(ref)
    const candidates = events.filter(event =>
      isId ? event.id.toLowerCase() === normalized : referenceAddress(event) === normalized,
    )
    const addressDeletes = isId
      ? []
      : validDeletes.filter(
          deletion =>
            deletion.pubkey === normalized.split(":")[1] &&
            deletion.tags.some(
              (tag: string[]) =>
                tag[0] === "a" &&
                typeof tag[1] === "string" &&
                normalizeExactRef(tag[1]) === normalized,
            ),
        )
    const survivors = candidates.filter(event => {
      if (event.kind === 5 || !verified(event)) return true
      return !validDeletes.some(
        deletion =>
          deletion.pubkey === event.pubkey &&
          deletion.tags.some(
            (tag: string[]) =>
              typeof tag[1] === "string" &&
              // NIP-09: e targets exactly one ID; a targets versions through created_at.
              ((tag[0] === "e" && tag[1].toLowerCase() === event.id.toLowerCase()) ||
                (tag[0] === "a" &&
                  normalizeExactRef(tag[1]) === address(event) &&
                  deletion.created_at >= event.created_at)),
          ),
      )
    })
    survivors.sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))
    if (survivors[0]) retained.add(survivors[0])
    return {
      ref,
      status: survivors.length
        ? "found"
        : addressDeletes.length || candidates.length > survivors.length
          ? "deleted"
          : complete
            ? "missing"
            : "unavailable",
    }
  })
  return {events: events.filter(event => retained.has(event)), resolutions}
}
