import {supportsMemberOnlyReads} from "./private-community-policy"
export const PRIVATE_AUTHORITY_KINDS = [5, 1984, 30000, 32222]
export const privateRelayUnfilteredKinds = (profile: unknown) => {
  const kinds = (profile as {budabit?: {read_control?: {unfiltered_kinds?: unknown}}})?.budabit
    ?.read_control?.unfiltered_kinds
  return Array.isArray(kinds) && kinds.every(kind => Number.isSafeInteger(kind) && kind >= 0)
    ? (kinds as number[])
    : []
}

// Unknown/invalid server limits are not evidence of a complete history scan.
export const privateRelayReadLimit = (profile: unknown): number | undefined => {
  const limit = (profile as {limitation?: {max_limit?: unknown}})?.limitation?.max_limit
  return typeof limit === "number" && Number.isSafeInteger(limit) && limit > 0
    ? Math.min(200, limit)
    : undefined
}

export const loadPrivateRelayProfiles = async (relays: string[], signal: AbortSignal) =>
  new Map(
    await Promise.all(
      relays.map(async relay => {
        const url = new URL(relay)
        url.protocol = url.protocol === "wss:" ? "https:" : "http:"
        const response = await fetch(url, {
          headers: {Accept: "application/nostr+json"},
          redirect: "error",
          credentials: "omit",
          referrerPolicy: "no-referrer",
          cache: "no-store",
          signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
        })
        if (!response.ok || !response.body)
          throw Error("Unable to verify member-only relay capability")
        const reader = response.body.getReader(),
          chunks: Uint8Array[] = []
        let size = 0
        try {
          while (true) {
            const {value, done} = await reader.read()
            if (done) break
            if ((size += value.length) > 65536)
              throw Error("Relay information exceeds the size bound")
            chunks.push(value)
          }
        } finally {
          await reader.cancel()
        }
        const bytes = new Uint8Array(size)
        let offset = 0
        for (const chunk of chunks) {
          bytes.set(chunk, offset)
          offset += chunk.length
        }
        const profile: unknown = JSON.parse(new TextDecoder().decode(bytes))
        if (!supportsMemberOnlyReads(profile))
          throw Error(
            "Relay does not advertise version-1, whole-relay members-only reads with required AUTH",
          )
        return [relay, profile] as const
      }),
    ),
  )
