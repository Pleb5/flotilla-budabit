import {secp256k1} from "@noble/curves/secp256k1"
import {sha256} from "@noble/hashes/sha2.js"
import {hexToBytes} from "@noble/hashes/utils.js"

const alphabet = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
const words = (value: number, length = 0): number[] => {
  const result: number[] = []
  do {
    result.unshift(value % 32)
    value = Math.floor(value / 32)
  } while (value)
  while (result.length < length) result.unshift(0)
  return result
}
const convert = (data: number[], from: number, to: number) => {
  let buffer = 0
  let bits = 0
  const result: number[] = []
  for (const value of data) {
    buffer = (buffer << from) | value
    bits += from
    while (bits >= to) {
      bits -= to
      result.push((buffer >>> bits) & ((1 << to) - 1))
    }
  }
  if (bits) result.push((buffer << (to - bits)) & ((1 << to) - 1))
  return result
}
const field = (tag: string, data: number[]) => [
  alphabet.indexOf(tag),
  ...words(data.length, 2),
  ...data,
]
const encode = (prefix: string, data: number[]) => {
  const expanded = [...prefix]
    .map(c => c.charCodeAt(0) >>> 5)
    .concat(
      0,
      [...prefix].map(c => c.charCodeAt(0) & 31),
    )
  let checksum = 1
  for (const value of [...expanded, ...data, 0, 0, 0, 0, 0, 0]) {
    const top = checksum >>> 25
    checksum = ((checksum & 0x1ffffff) << 5) ^ value
    for (let bit = 0; bit < 5; bit++)
      if ((top >>> bit) & 1)
        checksum ^= [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3][bit]
  }
  checksum ^= 1
  return (
    prefix +
    "1" +
    [...data, ...Array.from({length: 6}, (_, i) => (checksum >>> (5 * (5 - i))) & 31)]
      .map(word => alphabet[word])
      .join("")
  )
}

/** Signed synthetic invoices; no receiving node or real funds are involved. */
export const makeInvoice = ({
  amountMsats = 7000,
  description = "Payment card test",
  timestamp = Math.floor(Date.now() / 1000),
  expiry = 3600,
  preimage = "11".repeat(32),
  network = "bc",
}: {
  amountMsats?: number
  description?: string
  timestamp?: number
  expiry?: number
  preimage?: string
  network?: "bc" | "tb" | "bcrt"
} = {}) => {
  const prefix = `ln${network}${amountMsats ? `${BigInt(amountMsats) * 10n}p` : ""}`
  const data = [
    ...words(timestamp, 7),
    ...field("p", convert([...sha256(hexToBytes(preimage))], 8, 5)),
    ...field("d", convert([...new TextEncoder().encode(description)], 8, 5)),
    ...field("x", words(expiry)),
  ]
  const digest = sha256(
    Uint8Array.from([...new TextEncoder().encode(prefix), ...convert(data, 5, 8)]),
  )
  const signature = secp256k1.sign(digest, "01".repeat(32))
  return encode(prefix, [
    ...data,
    ...convert([...signature.toCompactRawBytes(), signature.recovery], 8, 5),
  ])
}
