import {normalizeRelayUrl} from "@welshman/util"
import {parseCommunityNaddr, type CommunityPointer} from "./community-protocol"

export type PrivateCommunityScope = {pointer: CommunityPointer; relays: string[]; error?: string}
const keyFor = (address: string) => `budabit:private-invite:v1:${address}`
const scopes = new Map<string, PrivateCommunityScope>()
const storage = () => {
  try {
    return globalThis.sessionStorage
  } catch {
    return undefined
  }
}

export const privateRelayHints = (values: string[]) => {
  if (values.length > 8) return []
  const relays: string[] = []
  for (const value of values) {
    try {
      const url = new URL(value)
      const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      if (
        (url.protocol !== "wss:" && !(local && url.protocol === "ws:")) ||
        url.username ||
        url.password ||
        url.hash ||
        url.search
      )
        return []
      relays.push(normalizeRelayUrl(value))
    } catch {
      return []
    }
  }
  return [...new Set(relays)]
}

export const getPrivateCommunityScope = (
  pointer: CommunityPointer,
): PrivateCommunityScope | undefined => {
  const current = scopes.get(pointer.address)
  if (current) return current
  let raw: string | null | undefined
  try {
    raw = storage()?.getItem(keyFor(pointer.address))
  } catch {
    return undefined
  }
  if (!raw) return undefined
  try {
    const saved = JSON.parse(raw)
    if (saved.version !== 1 || !Array.isArray(saved.relays)) throw Error()
    const relays = privateRelayHints(saved.relays)
    const scope = {
      pointer,
      relays,
      ...(!relays.length ? {error: "This private invitation needs valid relay hints."} : {}),
    }
    scopes.set(pointer.address, scope)
    return scope
  } catch {
    // A damaged private marker must never turn into public discovery.
    return {
      pointer,
      relays: [],
      error: "This private invitation could not be restored. Open the original invitation again.",
    }
  }
}

export const resolvePrivateCommunityScope = (url: URL): PrivateCommunityScope | undefined => {
  const segments = url.pathname.split("/").filter(Boolean)
  if (segments[0] !== "c" || !segments[1]) return undefined
  let pointer: CommunityPointer | undefined
  try {
    pointer = parseCommunityNaddr(decodeURIComponent(segments[1]))
  } catch {
    return undefined
  }
  if (!pointer) return undefined
  if (url.searchParams.get("read-access") !== "members") return getPrivateCommunityScope(pointer)
  const explicit = url.searchParams.getAll("relay")
  const relays = privateRelayHints(explicit.length ? explicit : pointer.relayHints)
  const scope = {
    pointer,
    relays,
    ...(!relays.length ? {error: "This private invitation needs valid relay hints."} : {}),
  }
  scopes.set(pointer.address, scope)
  try {
    storage()?.setItem(keyFor(pointer.address), JSON.stringify({version: 1, relays}))
  } catch {
    /* URL keeps the marker when storage is unavailable. */
  }
  return scope
}

export const makePrivateCommunityInvite = (pointer: CommunityPointer, relays: string[]) => {
  const params = new URLSearchParams({"read-access": "members"})
  for (const relay of privateRelayHints(relays)) params.append("relay", relay)
  return `/c/${encodeURIComponent(pointer.naddr)}?${params}`
}
