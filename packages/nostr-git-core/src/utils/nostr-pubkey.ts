import {nip19} from "nostr-tools"

const HEX_PUBKEY_RE = /^[0-9a-f]{64}$/i

export function isHexPubkey(value: string): boolean {
  return HEX_PUBKEY_RE.test(value)
}

export function isNpub(value: string): boolean {
  return value.startsWith("npub1")
}

export function toNpub(pubkeyOrNpub: string): string {
  if (!pubkeyOrNpub) throw new Error("toNpub: empty input")
  if (isNpub(pubkeyOrNpub)) {
    const decoded = nip19.decode(pubkeyOrNpub)
    if (decoded.type !== "npub") throw new Error(`toNpub: expected npub, got ${decoded.type}`)
    return pubkeyOrNpub
  }
  if (isHexPubkey(pubkeyOrNpub)) {
    return nip19.npubEncode(pubkeyOrNpub.toLowerCase())
  }
  throw new Error(
    `toNpub: invalid pubkey format "${pubkeyOrNpub.slice(0, 16)}..." - expected 64-char hex or npub1...`,
  )
}

export function toHexPubkey(pubkeyOrNpub: string): string {
  if (!pubkeyOrNpub) throw new Error("toHexPubkey: empty input")
  if (isHexPubkey(pubkeyOrNpub)) {
    return pubkeyOrNpub.toLowerCase()
  }
  if (isNpub(pubkeyOrNpub)) {
    const decoded = nip19.decode(pubkeyOrNpub)
    if (decoded.type !== "npub") throw new Error(`toHexPubkey: expected npub, got ${decoded.type}`)
    return decoded.data as string
  }
  throw new Error(
    `toHexPubkey: invalid pubkey format "${pubkeyOrNpub.slice(0, 16)}..." - expected 64-char hex or npub1...`,
  )
}
