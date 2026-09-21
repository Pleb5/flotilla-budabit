import {beforeEach, afterEach, describe, expect, it, vi} from "vitest"
import {get} from "svelte/store"
import {nwc} from "@getalby/sdk"
import {makeInvoice} from "../../../tests/helpers/lightning-invoice"
import {getLightningInvoiceInfo} from "@app/util/lightning-invoice"

const mocks = vi.hoisted(() => ({
  session: {
    pubkey: "test-user",
    wallet: {type: "nwc", info: {walletPubkey: "test-wallet", relayUrl: "wss://test.invalid"}},
  } as any,
  pay: vi.fn(),
  lookup: vi.fn(),
  melt: vi.fn(),
  checkMelt: vi.fn(),
}))
vi.mock("@welshman/app", () => ({session: {get: () => mocks.session}}))
vi.mock("./nwc", () => ({
  payNwcInvoice: mocks.pay,
  lookupNwcInvoice: mocks.lookup,
  NwcUnsupportedEncryptionError: class extends Error {},
}))
vi.mock("./cashu", () => ({
  executeCashuInvoicePayment: mocks.melt,
  checkCashuInvoicePayment: mocks.checkMelt,
}))

import {
  payLightningInvoice,
  checkInvoicePayment,
  invoicePayments,
  getPreferredPaymentMethod,
} from "./invoice-payments"

beforeEach(() => {
  localStorage.clear()
  invoicePayments.set({})
  vi.clearAllMocks()
  mocks.session.wallet = {
    type: "nwc",
    info: {walletPubkey: "test-wallet", relayUrl: "wss://test.invalid"},
  }
  mocks.pay.mockResolvedValue({preimage: "11".repeat(32)})
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("invoice payment routing and settlement", () => {
  it("does not submit when the durable attempt cannot be saved", async () => {
    vi.spyOn(localStorage, "setItem").mockImplementationOnce(() => {
      throw new Error("Storage unavailable")
    })
    await expect(payLightningInvoice(makeInvoice(), "nwc")).rejects.toThrow("Storage unavailable")
    expect(mocks.pay).not.toHaveBeenCalled()
    expect(mocks.melt).not.toHaveBeenCalled()
  })

  it("does not treat an unreadable prior payment as permission to pay again", async () => {
    const invoice = makeInvoice()
    const hash = getLightningInvoiceInfo(invoice)!.paymentHash
    localStorage.setItem(
      `budabit/invoice-payment/v1/${hash}`,
      JSON.stringify({paymentHash: hash, state: "unknown"}),
    )
    await expect(payLightningInvoice(invoice, "nwc")).rejects.toThrow("previous payment status")
    expect(mocks.pay).not.toHaveBeenCalled()
  })

  it("sends fixed invoices without amount overrides and remembers the chosen wallet", async () => {
    const invoice = makeInvoice()
    expect(await payLightningInvoice(invoice, "nwc", 900)).toMatchObject({state: "paid", amount: 7})
    expect(mocks.pay).toHaveBeenCalledWith(mocks.session.wallet.info, {invoice})
    expect(mocks.melt).not.toHaveBeenCalled()
    expect(getPreferredPaymentMethod()).toBe("nwc")
  })

  it("passes amountless amounts in msats and never silently chooses another wallet", async () => {
    const invoice = makeInvoice({amountMsats: 0})
    await payLightningInvoice(invoice, "nwc", 21)
    expect(mocks.pay).toHaveBeenCalledWith(mocks.session.wallet.info, {invoice, amount: 21000})
    expect(mocks.melt).not.toHaveBeenCalled()
  })

  it("blocks duplicate clicks, reload retries, and switching to Cashu while NWC is uncertain", async () => {
    const invoice = makeInvoice()
    let reject!: (error: Error) => void
    mocks.pay.mockReturnValue(
      new Promise((_, no) => {
        reject = no
      }),
    )
    const first = payLightningInvoice(invoice, "nwc")
    await vi.waitFor(() => expect(mocks.pay).toHaveBeenCalledTimes(1))
    await expect(payLightningInvoice(invoice, "cashu")).rejects.toThrow("already being processed")
    reject(new Error("Wallet response timed out"))
    expect(await first).toMatchObject({state: "pending"})
    invoicePayments.set({}) // Remount/reload: only the durable record remains.
    expect(await payLightningInvoice(invoice, "cashu")).toMatchObject({
      method: "nwc",
      state: "pending",
    })
    expect(mocks.pay).toHaveBeenCalledTimes(1)
    expect(mocks.melt).not.toHaveBeenCalled()
    const hash = getLightningInvoiceInfo(invoice)!.paymentHash
    mocks.lookup.mockResolvedValue({payment_hash: hash, preimage: "11".repeat(32)})
    expect(await checkInvoicePayment(hash)).toMatchObject({state: "paid"})
  })

  it("allows another method only after an explicit wallet rejection", async () => {
    const invoice = makeInvoice()
    mocks.pay.mockRejectedValue(
      new nwc.Nip47WalletError("Insufficient balance", "INSUFFICIENT_BALANCE"),
    )
    expect(await payLightningInvoice(invoice, "nwc")).toMatchObject({state: "failed"})
    mocks.melt.mockResolvedValue({state: "paid"})
    const quote = {
      operationId: "prepared-1",
      mintUrl: "https://mint.invalid",
      invoice,
      amount: 7,
      feeReserve: 1,
      mintFees: 0,
      maxTotal: 8,
      expiresAt: Date.now() + 60000,
    }
    expect(await payLightningInvoice(invoice, "cashu", 7, quote)).toMatchObject({
      state: "paid",
      method: "cashu",
    })
    expect(mocks.melt).toHaveBeenCalledWith(quote)
  })

  it("rejects unconfirmed preimages and checks against the wallet that actually paid", async () => {
    const invoice = makeInvoice()
    const hash = getLightningInvoiceInfo(invoice)!.paymentHash
    mocks.pay.mockResolvedValue({preimage: "22".repeat(32)})
    expect(await payLightningInvoice(invoice, "nwc")).toMatchObject({state: "pending"})
    mocks.session.wallet.info.walletPubkey = "different-wallet"
    await expect(checkInvoicePayment(hash)).rejects.toThrow("Reconnect")
    expect(mocks.lookup).not.toHaveBeenCalled()
    expect(get(invoicePayments)[hash].state).toBe("pending")
  })

  it("supports fixed-amount WebLN invoices without an amount override", async () => {
    const invoice = makeInvoice()
    const sendPayment = vi.fn().mockResolvedValue({preimage: "11".repeat(32)})
    vi.stubGlobal("window", {webln: {enable: vi.fn(), sendPayment}})
    mocks.session.wallet = {type: "webln", info: {}}
    expect(await payLightningInvoice(invoice, "webln")).toMatchObject({state: "paid"})
    expect(sendPayment).toHaveBeenCalledWith(invoice)
  })
})
