import {
  Amount,
  createBlindSignature,
  createDLEQProof,
  deriveKeysetId,
  hashToCurve,
  pointFromHex,
  verifyMintQuoteSignature,
} from "@cashu/cashu-ts"
import {schnorr, secp256k1} from "@noble/curves/secp256k1"
import {sha256} from "@noble/hashes/sha2.js"

type Output = {id: string; amount: number | string; B_: string}
type Quote = {
  quote: string
  request: string
  amount: number
  unit: string
  state: string
  expiry: number
  pubkey?: string
}

/** Synthetic, never-funded HTTP mint. Uses real secp256k1 blind signatures/DLEQ.
 * Protocol modes reflect the inspected mint releases; this is not a live-mint test.
 */
export class CashuTestMint {
  readonly url: string
  readonly keys: Record<string, string>
  readonly id: string
  readonly expiry?: number
  readonly signatureMode: "current" | "legacy"
  readonly calls: {path: string; body: any}[] = []
  readonly quotes = new Map<string, Quote>()
  readonly signatures = new Map<string, any>()
  readonly spent = new Set<string>()
  dropNextMintResponse = false
  mintAttempts = 0
  meltState: "PENDING" | "PAID" | "UNPAID" = "PENDING"

  constructor(
    options: {
      version?: 0 | 1
      expiry?: number
      signatureMode?: "current" | "legacy"
      url?: string
      amounts?: number[]
    } = {},
  ) {
    this.url = options.url ?? "https://cashu-test.invalid"
    this.expiry = options.expiry
    this.signatureMode = options.signatureMode ?? "current"
    this.keys = Object.fromEntries(
      (options.amounts ?? [1, 2, 4, 8, 16, 32, 64, 128]).map((amount, i) => [
        amount,
        secp256k1.ProjectivePoint.BASE.multiply(BigInt(i + 1)).toHex(true),
      ]),
    )
    this.id = deriveKeysetId(this.keys, {
      unit: "sat",
      versionByte: options.version ?? 1,
      expiry: this.expiry,
    })
  }

  pay(quote: string) {
    this.quotes.get(quote)!.state = "PAID"
  }

  issueBeforeCrash(quoteId: string, outputs: Output[]) {
    for (const output of outputs) this.sign(output)
    this.quotes.get(quoteId)!.state = "ISSUED"
  }

  private sign(output: Output) {
    const scalar = BigInt(Math.log2(Number(output.amount)) + 1)
    const key = Uint8Array.from(Buffer.from(scalar.toString(16).padStart(64, "0"), "hex"))
    const B = pointFromHex(output.B_)
    const dleq = createDLEQProof(B, key)
    const signature = {
      id: this.id,
      amount: Number(output.amount),
      C_: createBlindSignature(B, key, this.id).C_.toHex(true),
      dleq: {e: Buffer.from(dleq.e).toString("hex"), s: Buffer.from(dleq.s).toString("hex")},
    }
    this.signatures.set(output.B_, signature)
    return signature
  }

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    )
    if (url.origin !== this.url) throw new Error(`Unexpected test network origin: ${url.origin}`)
    const path = url.pathname
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    this.calls.push({path, body})
    const respond = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {status, headers: {"content-type": "application/json"}})
    const keyset = {
      id: this.id,
      unit: "sat",
      active: true,
      input_fee_ppk: 0,
      ...(this.expiry !== undefined ? {final_expiry: this.expiry} : {}),
    }
    if (path === "/v1/info")
      return respond({
        name: "Synthetic Cashu mint",
        version: "fixture/1",
        nuts: {
          "4": {
            methods: [{method: "bolt11", unit: "sat", min_amount: 1, max_amount: 128}],
            disabled: false,
          },
          "5": {methods: [{method: "bolt11", unit: "sat"}], disabled: false},
          "7": {supported: true},
          "9": {supported: true},
          "12": {supported: true},
          "20": {supported: true},
        },
      })
    if (path === "/v1/keysets") return respond({keysets: [keyset]})
    if (path === "/v1/keys" || path === `/v1/keys/${this.id}`)
      return respond({keysets: [{...keyset, keys: this.keys}]})
    if (path === "/v1/mint/quote/bolt11") {
      const quote: Quote = {
        quote: `q-${this.quotes.size + 1}`,
        request: "lnbc-synthetic-unpayable",
        amount: Number(body.amount),
        unit: body.unit,
        state: "UNPAID",
        expiry: 4102444800,
        pubkey: body.pubkey,
      }
      this.quotes.set(quote.quote, quote)
      return respond(quote)
    }
    if (path.startsWith("/v1/mint/quote/bolt11/"))
      return respond(this.quotes.get(path.split("/").at(-1)!))
    if (path === "/v1/mint/bolt11") {
      this.mintAttempts++
      const quote = this.quotes.get(body.quote)!
      const outputs: Output[] = body.outputs
      if (quote.pubkey) {
        const valid =
          this.signatureMode === "current"
            ? verifyMintQuoteSignature(
                quote.pubkey,
                quote.quote,
                outputs.map(o => ({...o, amount: Amount.from(o.amount)})),
                body.signature,
              )
            : schnorr.verify(
                body.signature,
                sha256(new TextEncoder().encode(quote.quote + outputs.map(o => o.B_).join(""))),
                quote.pubkey.slice(2),
              )
        if (!valid) return respond({code: 20008, detail: "Invalid quote signature"}, 400)
      }
      if (quote.state === "UNPAID") return respond({code: 20001, detail: "Quote not paid"}, 400)
      if (quote.state === "ISSUED")
        return respond({code: 20002, detail: "Quote already issued"}, 400)
      const signatures = outputs.map(o => this.sign(o))
      quote.state = "ISSUED"
      if (this.dropNextMintResponse) {
        this.dropNextMintResponse = false
        throw new TypeError("Simulated lost mint response")
      }
      return respond({signatures})
    }
    if (path === "/v1/restore") {
      const outputs: Output[] = body.outputs
        .filter((o: Output) => this.signatures.has(o.B_))
        .map((o: Output) => ({
          ...o,
          id: this.signatures.get(o.B_).id,
          amount: this.signatures.get(o.B_).amount,
        }))
      return respond({outputs, signatures: outputs.map(o => this.signatures.get(o.B_))})
    }
    if (path === "/v1/checkstate")
      return respond({
        states: body.Ys.map((Y: string) => ({Y, state: this.spent.has(Y) ? "SPENT" : "UNSPENT"})),
      })
    if (path.startsWith("/v1/melt/quote/bolt11/"))
      return respond({
        quote: path.split("/").at(-1),
        state: this.meltState,
        amount: 7,
        fee_reserve: 1,
        expiry: 4102444800,
        unit: "sat",
        request: "lnbc-fixture-melt",
        ...(this.meltState === "PAID" ? {payment_preimage: "11".repeat(32), change: []} : {}),
      })
    if (path === "/v1/swap") {
      for (const proof of body.inputs) {
        const Y = hashToCurve(new TextEncoder().encode(proof.secret))
        if (
          this.spent.has(Y.toHex(true)) ||
          Y.multiply(BigInt(Math.log2(Number(proof.amount)) + 1)).toHex(true) !== proof.C
        ) {
          return respond({code: 11001, detail: "Invalid or spent proof"}, 400)
        }
      }
      for (const proof of body.inputs)
        this.spent.add(hashToCurve(new TextEncoder().encode(proof.secret)).toHex(true))
      return respond({signatures: body.outputs.map((o: Output) => this.sign(o))})
    }
    throw new Error(`Unhandled mint fixture endpoint ${path}`)
  }
}
