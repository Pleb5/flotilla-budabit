import * as nip19 from "nostr-tools/nip19"
import {range, DAY, hexToBytes, bytesToHex} from "@welshman/lib"

export const nsecEncode = (secret: string) => nip19.nsecEncode(hexToBytes(secret))

export const nsecDecode = (nsec: string) => {
  const {type, data} = nip19.decode(nsec)

  if (type !== "nsec") throw new Error(`Invalid nsec: ${nsec}`)

  return bytesToHex(data)
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
