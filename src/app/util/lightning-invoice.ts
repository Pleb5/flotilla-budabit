import {decodeInvoice} from "@getalby/lightning-tools/bolt11"
import {ParsedType, type Parsed} from "@welshman/content"

export type LightningInvoiceInfo = {
  invoice: string
  paymentHash: string
  amount: number
  description: string
  expiresAt: number
  network: "bitcoin" | "testnet" | "regtest" | "signet"
}

const CANDIDATE = /(?:lightning:)?ln(?:bcrt|bc|tbs|tb)(?:\d+[munp]?)?1[02-9ac-hj-np-z]{100,12000}/gi
const BEFORE = /[\s([{"'<>`]/
const AFTER = /[\s)\]}"'<>`.,!?:;]/
const cache = new Map<string, LightningInvoiceInfo | undefined>()

/** Decode locally, including the BOLT11 checksum. Preserve msat precision. */
export const getLightningInvoiceInfo = (raw: string): LightningInvoiceInfo | undefined => {
  const value = raw.trim().replace(/^lightning:/i, "")
  if (cache.has(value)) return cache.get(value)
  let result: LightningInvoiceInfo | undefined
  if (
    value.length <= 12000 &&
    /^(?:lnbc|lntb|lnbcrt|lntbs)(?:\d+[munp]?)?1[02-9ac-hj-np-z]+$/i.test(value) &&
    (value === value.toLowerCase() || value === value.toUpperCase())
  ) {
    const invoice = value.toLowerCase()
    const decoded = decodeInvoice(invoice)
    if (
      decoded &&
      /^[a-f0-9]{64}$/i.test(decoded.paymentHash) &&
      Number.isSafeInteger(Math.round(decoded.satoshi * 1000)) &&
      decoded.satoshi >= 0 &&
      Number.isSafeInteger(decoded.timestamp + (decoded.expiry ?? 3600))
    ) {
      result = {
        invoice,
        paymentHash: decoded.paymentHash,
        amount: decoded.satoshi,
        description: decoded.description || "",
        expiresAt: (decoded.timestamp + (decoded.expiry ?? 3600)) * 1000,
        network: invoice.startsWith("lnbcrt")
          ? "regtest"
          : invoice.startsWith("lntbs")
            ? "signet"
            : invoice.startsWith("lntb")
              ? "testnet"
              : "bitcoin",
      }
    }
  }
  if (cache.size >= 256) cache.delete(cache.keys().next().value!)
  cache.set(value, result)
  return result
}

export const findLightningInvoices = (src: string) => {
  const matches: {raw: string; index: number; info: LightningInvoiceInfo}[] = []
  for (const match of src.matchAll(new RegExp(CANDIDATE))) {
    const index = match.index!
    const end = index + match[0].length
    if (index > 0 && !BEFORE.test(src[index - 1])) continue
    if (end < src.length && !AFTER.test(src[end])) continue
    const info = getLightningInvoiceInfo(match[0])
    if (info) matches.push({raw: match[0], index, info})
  }
  return matches
}

export const replaceLightningInvoices = (content: Parsed[]): Parsed[] =>
  content.flatMap(parsed => {
    if (parsed.type !== ParsedType.Text) return [parsed]
    const matches = findLightningInvoices(parsed.value)
    if (!matches.length) return [parsed]
    const result: Parsed[] = []
    let cursor = 0
    const text = (value: string): Parsed => ({type: ParsedType.Text, raw: value, value})
    for (const {raw, index, info} of matches) {
      if (index > cursor) result.push(text(parsed.value.slice(cursor, index)))
      result.push({type: ParsedType.Invoice, raw, value: info.invoice})
      cursor = index + raw.length
    }
    if (cursor < parsed.value.length) result.push(text(parsed.value.slice(cursor)))
    return result
  })

export const formatInvoiceSats = (amount: number) =>
  new Intl.NumberFormat(undefined, {maximumFractionDigits: 3}).format(amount)

export const getInvoicePaymentAmount = (invoice: LightningInvoiceInfo, amount?: number) => {
  const sats = invoice.amount || amount || 0
  const msats = Math.round(sats * 1000)
  if (sats <= 0 || !Number.isSafeInteger(msats) || Math.abs(msats / 1000 - sats) > 1e-9)
    throw new Error("Enter a positive amount with at most three decimal places.")
  if (invoice.expiresAt <= Date.now()) throw new Error("This Lightning invoice has expired.")
  return {sats, msats}
}
