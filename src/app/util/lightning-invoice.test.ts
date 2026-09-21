import {describe, expect, it, vi, afterEach} from "vitest"
import {parse, ParsedType} from "@welshman/content"
import {makeInvoice} from "../../../tests/helpers/lightning-invoice"
import {
  findLightningInvoices,
  getInvoicePaymentAmount,
  getLightningInvoiceInfo,
  replaceLightningInvoices,
} from "./lightning-invoice"

afterEach(() => vi.restoreAllMocks())
describe("BOLT11 content", () => {
  it("decodes bare/prefixed/uppercase invoices and preserves millisatoshis", () => {
    const invoice = makeInvoice({amountMsats: 1234})
    for (const raw of [invoice, `lightning:${invoice}`, `LIGHTNING:${invoice.toUpperCase()}`]) {
      expect(getLightningInvoiceInfo(raw)).toMatchObject({
        invoice,
        amount: 1.234,
        description: "Payment card test",
        network: "bitcoin",
      })
    }
    expect(
      getLightningInvoiceInfo(invoice.slice(0, -1) + (invoice.endsWith("q") ? "p" : "q")),
    ).toBeUndefined()
    expect(getLightningInvoiceInfo("lnurl1" + "q".repeat(200))).toBeUndefined()
    expect(
      getLightningInvoiceInfo(invoice.slice(0, 20).toUpperCase() + invoice.slice(20)),
    ).toBeUndefined()
  })

  it("finds multiple standalone invoices without consuming punctuation or URL paths", () => {
    const invoice = makeInvoice()
    expect(
      findLightningInvoices(`Pay (${invoice}), or lightning:${invoice}!`).map(m => m.info.invoice),
    ).toEqual([invoice, invoice])
    for (const text of [
      `https://example.com/${invoice}`,
      `prefix${invoice}`,
      `${invoice}/file`,
      `${invoice}suffix`,
    ]) {
      expect(findLightningInvoices(text)).toEqual([])
    }
  })

  it("upgrades bare invoices without rendering code or URL contents as payment cards", () => {
    const invoice = makeInvoice()
    const parsed = replaceLightningInvoices(
      parse({content: `Pay ${invoice}.\n\`${invoice}\`\nhttps://example.com/${invoice}`}),
    )
    expect(parsed.filter(p => p.type === ParsedType.Invoice)).toHaveLength(1)
    expect(parsed.some(p => p.type === ParsedType.Code)).toBe(true)
    expect(parsed.some(p => p.type === ParsedType.Link)).toBe(true)
  })

  it("requires an amount only for amountless invoices and rejects expired/unsafe payments", () => {
    const fixed = getLightningInvoiceInfo(makeInvoice())!
    const open = getLightningInvoiceInfo(makeInvoice({amountMsats: 0}))!
    expect(getInvoicePaymentAmount(fixed, 900)).toEqual({sats: 7, msats: 7000})
    expect(getInvoicePaymentAmount(open, 2.001)).toEqual({sats: 2.001, msats: 2001})
    for (const amount of [0, -1, NaN, Infinity, 0.0001, Number.MAX_SAFE_INTEGER]) {
      expect(() => getInvoicePaymentAmount(open, amount)).toThrow()
    }
    vi.spyOn(Date, "now").mockReturnValue(fixed.expiresAt)
    expect(() => getInvoicePaymentAmount(fixed)).toThrow("expired")
  })
})
