import {get, writable} from "svelte/store"
import {session} from "@welshman/app"
import {nwc} from "@getalby/sdk"
import {sha256} from "@noble/hashes/sha2.js"
import {bytesToHex, hexToBytes} from "@noble/hashes/utils.js"
import {payNwcInvoice, lookupNwcInvoice, NwcUnsupportedEncryptionError} from "./nwc"
import {
  executeCashuInvoicePayment,
  checkCashuInvoicePayment,
  type CashuInvoicePayment,
} from "./cashu"
import {getLightningInvoiceInfo, getInvoicePaymentAmount} from "@app/util/lightning-invoice"

export type InvoicePaymentMethod = "nwc" | "webln" | "cashu"
export type InvoicePayment = {
  paymentHash: string
  method: InvoicePaymentMethod
  state: "pending" | "paid" | "failed"
  amount: number
  updatedAt: number
  walletId?: string
  operationId?: string
  mintUrl?: string
  error?: string
}

const PREFIX = "budabit/invoice-payment/v1/"
const attempts = new Set<string>()
export const invoicePayments = writable<Record<string, InvoicePayment>>({})

export const loadInvoicePayment = (paymentHash: string): InvoicePayment | undefined => {
  if (typeof localStorage === "undefined") return get(invoicePayments)[paymentHash]
  const raw = localStorage.getItem(PREFIX + paymentHash)
  if (!raw) return get(invoicePayments)[paymentHash]
  try {
    const payment = JSON.parse(raw) as InvoicePayment
    if (
      payment.paymentHash !== paymentHash ||
      !["pending", "paid", "failed"].includes(payment.state) ||
      !["nwc", "webln", "cashu"].includes(payment.method) ||
      !Number.isFinite(payment.updatedAt)
    )
      throw new Error("Invalid payment record")
    const known = get(invoicePayments)[paymentHash]
    if (known && known.updatedAt > payment.updatedAt) return known
    invoicePayments.update(values => ({...values, [paymentHash]: payment}))
    return payment
  } catch {
    throw new Error(
      "Could not read the previous payment status. Check your wallet before retrying.",
    )
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", event => {
    if (event.key?.startsWith(PREFIX)) {
      try {
        loadInvoicePayment(event.key.slice(PREFIX.length))
      } catch {
        /* Keep the known status. */
      }
    }
  })
}

const save = (payment: InvoicePayment) => {
  // Persist before submitting, so a reload cannot turn an unknown outcome into a retry.
  localStorage.setItem(PREFIX + payment.paymentHash, JSON.stringify(payment))
  invoicePayments.update(values => ({...values, [payment.paymentHash]: payment}))
  return payment
}

const withPaymentLock = async <T>(hash: string, task: () => Promise<T>): Promise<T> => {
  if (attempts.has(hash)) throw new Error("This payment is already being processed.")
  attempts.add(hash)
  try {
    if (typeof navigator !== "undefined" && navigator.locks) {
      return await navigator.locks.request(PREFIX + hash, {ifAvailable: true}, async lock => {
        if (!lock) throw new Error("This payment is being processed in another tab.")
        return task()
      })
    }
    return await task()
  } finally {
    attempts.delete(hash)
  }
}

const walletId = (info: {walletPubkey: string; relayUrl: string}) =>
  bytesToHex(sha256(new TextEncoder().encode(`${info.walletPubkey}\n${info.relayUrl}`)))

const confirmsPayment = (hash: string, preimage: unknown) => {
  if (typeof preimage !== "string" || !/^[0-9a-f]{64}$/i.test(preimage)) return false
  return bytesToHex(sha256(hexToBytes(preimage))) === hash
}

const preferenceKey = () => `budabit/payment-method/${session.get()?.pubkey || "local"}`
export const getPreferredPaymentMethod = (): InvoicePaymentMethod | "" => {
  try {
    const method = localStorage.getItem(preferenceKey())
    return method === "nwc" || method === "webln" || method === "cashu" ? method : ""
  } catch {
    return ""
  }
}

export const payLightningInvoice = async (
  raw: string,
  method: InvoicePaymentMethod,
  amount?: number,
  cashu?: CashuInvoicePayment,
): Promise<InvoicePayment> => {
  const invoice = getLightningInvoiceInfo(raw)
  if (!invoice) throw new Error("Invalid Lightning invoice")
  return withPaymentLock(invoice.paymentHash, async () => {
    const previous = loadInvoicePayment(invoice.paymentHash)
    if (previous && previous.state !== "failed") return previous
    const {sats, msats} = getInvoicePaymentAmount(invoice, amount)
    const wallet = session.get()?.wallet
    const webln = typeof window !== "undefined" ? (window as any).webln : undefined
    if (method === "cashu") {
      if (!cashu || cashu.invoice !== invoice.invoice || cashu.amount !== Math.ceil(sats))
        throw new Error("Get a fee quote for this invoice first.")
      if (cashu.expiresAt <= Date.now()) throw new Error("The fee quote has expired.")
    } else {
      if (wallet?.type !== method) throw new Error("Connect this Lightning wallet first.")
      if (method === "webln") {
        if (!invoice.amount)
          throw new Error("This WebLN wallet requires an invoice with a fixed amount.")
        if (!webln?.sendPayment) throw new Error("WebLN is unavailable in this browser.")
        await webln.enable()
      }
    }
    const payment = save({
      paymentHash: invoice.paymentHash,
      method,
      amount: sats,
      state: "pending",
      updatedAt: Date.now(),
      ...(method === "nwc" && wallet?.type === "nwc" ? {walletId: walletId(wallet.info)} : {}),
      ...(method === "cashu" ? {operationId: cashu!.operationId, mintUrl: cashu!.mintUrl} : {}),
    })
    try {
      localStorage.setItem(preferenceKey(), method)
    } catch {
      /* A display preference must not affect settlement. */
    }
    let result: Pick<InvoicePayment, "state" | "error">
    try {
      if (method === "cashu") {
        result = await executeCashuInvoicePayment(cashu!)
      } else {
        const response =
          method === "nwc" && wallet?.type === "nwc"
            ? await payNwcInvoice(wallet.info, {
                invoice: invoice.invoice,
                ...(!invoice.amount ? {amount: msats} : {}),
              })
            : await webln.sendPayment(invoice.invoice)
        result = confirmsPayment(invoice.paymentHash, response?.preimage)
          ? {state: "paid"}
          : {state: "pending", error: "The wallet has not supplied a confirmed payment result yet."}
      }
    } catch (error) {
      const rejected =
        error instanceof NwcUnsupportedEncryptionError ||
        (error instanceof nwc.Nip47WalletError &&
          [
            "INSUFFICIENT_BALANCE",
            "QUOTA_EXCEEDED",
            "RESTRICTED",
            "UNAUTHORIZED",
            "NOT_IMPLEMENTED",
            "PAYMENT_FAILED",
          ].includes(error.code))
      result = {
        state: rejected ? "failed" : "pending",
        error: error instanceof Error ? error.message : "Could not confirm the payment result.",
      }
    }
    const next = {...payment, ...result, updatedAt: Math.max(Date.now(), payment.updatedAt + 1)}
    // Keep the UI truthful even if storage becomes unavailable after submission.
    invoicePayments.update(values => ({...values, [invoice.paymentHash]: next}))
    try {
      save(next)
    } catch {
      /* The durable pending record still prevents resubmission. */
    }
    return next
  })
}

export const checkInvoicePayment = async (hash: string): Promise<InvoicePayment> =>
  withPaymentLock(hash, async () => {
    const payment = loadInvoicePayment(hash)
    if (!payment) throw new Error("No payment attempt was found.")
    if (payment.state !== "pending") return payment
    let result: Pick<InvoicePayment, "state" | "error">
    if (payment.method === "cashu" && payment.operationId) {
      result = await checkCashuInvoicePayment(payment.operationId)
    } else if (payment.method === "nwc") {
      const wallet = session.get()?.wallet
      if (wallet?.type !== "nwc" || walletId(wallet.info) !== payment.walletId)
        throw new Error("Reconnect the Lightning wallet used for this payment to check its status.")
      const transaction = await lookupNwcInvoice(wallet.info, hash)
      if (transaction.payment_hash !== hash)
        throw new Error("The wallet returned a different payment.")
      result = confirmsPayment(hash, transaction.preimage)
        ? {state: "paid"}
        : transaction.state === "failed"
          ? {state: "failed", error: "The wallet reports that the payment failed."}
          : {state: "pending"}
    } else {
      const webln = (window as any).webln
      if (!webln?.lookupInvoice) throw new Error("Check the payment status in your WebLN wallet.")
      await webln.enable()
      const transaction = await webln.lookupInvoice({paymentHash: hash})
      result = confirmsPayment(hash, transaction?.preimage) ? {state: "paid"} : {state: "pending"}
    }
    return save({
      ...payment,
      ...result,
      error: result.error,
      updatedAt: Math.max(Date.now(), payment.updatedAt + 1),
    })
  })
