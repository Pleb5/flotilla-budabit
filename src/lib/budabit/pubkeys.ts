import * as nip19 from "nostr-tools/nip19"

const isHexPubkey = (value: string) => /^[0-9a-f]{64}$/i.test(value)

export const normalizePubkey = (value: string) => {
  const trimmed = (value || "").trim()

  if (!trimmed) return ""
  if (isHexPubkey(trimmed)) return trimmed.toLowerCase()

  try {
    const decoded = nip19.decode(trimmed)

    if (decoded.type === "npub" && typeof decoded.data === "string") {
      return decoded.data.toLowerCase()
    }

    if (decoded.type === "nprofile" && typeof decoded.data?.pubkey === "string") {
      return decoded.data.pubkey.toLowerCase()
    }
  } catch {
    return ""
  }

  return ""
}
