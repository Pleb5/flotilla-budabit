import * as nip19 from "nostr-tools/nip19"
import {range, DAY, hexToBytes, bytesToHex} from "@welshman/lib"

export const nsecEncode = (secret: string) => nip19.nsecEncode(hexToBytes(secret))

export const nsecDecode = (nsec: string) => {
  const {type, data} = nip19.decode(nsec)

  if (type !== "nsec") throw new Error(`Invalid nsec: ${nsec}`)

  return bytesToHex(data)
}

export type NsecTextParseResult = {
  nsecs: string[]
  hasInvalidNsec: boolean
  hasEncryptedNsec: boolean
}

const NIP19_SECRET_PATTERN = /\b(?:nsec|ncryptsec)1[0-9a-z]+\b/gi

const normalizeBech32Candidate = (candidate: string) => {
  const hasLower = /[a-z]/.test(candidate)
  const hasUpper = /[A-Z]/.test(candidate)

  if (hasLower && hasUpper) return undefined

  return candidate.toLowerCase()
}

export const parseNsecsFromText = (text: string): NsecTextParseResult => {
  const nsecs = new Set<string>()
  let hasInvalidNsec = false
  let hasEncryptedNsec = false

  for (const match of text.matchAll(NIP19_SECRET_PATTERN)) {
    const candidate = match[0]
    const normalized = normalizeBech32Candidate(candidate)

    if (!normalized) {
      if (candidate.toLowerCase().startsWith("nsec1")) hasInvalidNsec = true
      if (candidate.toLowerCase().startsWith("ncryptsec1")) hasEncryptedNsec = true

      continue
    }

    if (normalized.startsWith("ncryptsec1")) {
      hasEncryptedNsec = true
      continue
    }

    try {
      nsecDecode(normalized)
      nsecs.add(normalized)
    } catch {
      hasInvalidNsec = true
    }
  }

  return {nsecs: [...nsecs], hasInvalidNsec, hasEncryptedNsec}
}

export const day = (seconds: number) => Math.floor(seconds / DAY)

export const daysBetween = (start: number, end: number) => [...range(start, end, DAY)].map(day)

export const ucFirst = (s: string) => s.slice(0, 1).toUpperCase() + s.slice(1)

/**
 * Preprocess markdown text to convert literal \n to actual newlines.
 * This is useful when markdown content contains escaped newline characters
 * that should be rendered as line breaks.
 */
export const preprocessMarkdown = (text: string): string => {
  if (!text) return ""
  // Convert literal \n (escaped newlines) to actual newlines
  return text.replace(/\\n/g, "\n")
}

export function deleteIndexedDB(name: string, timeoutMs = 1000): Promise<void> {
  return new Promise((resolve, reject) => {
    const request: IDBOpenDBRequest = indexedDB.deleteDatabase(name)
    let done = false

    const finish = () => {
      if (!done) {
        done = true
        resolve()
      }
    }

    request.onsuccess = finish

    request.onerror = () => finish()

    request.onblocked = () => {
      console.warn(`Deletion of IndexedDB '${name}' is blocked`)
    }

    setTimeout(() => {
      console.warn(`IndexedDB '${name}' deletion timed out`)
      finish()
    }, timeoutMs)
  })
}
