import {beforeEach, describe, expect, it, vi} from "vitest"

const mocks = vi.hoisted(() => ({
  serviceInfo: {
    encryptions: ["nip44_v2"],
    capabilities: ["pay_invoice", "get_balance"],
    notifications: [],
  },
  info: {methods: ["pay_invoice"], lud16: "alice@example.com"},
  balance: {balance: 21_000},
  payResponse: {preimage: "preimage", fees_paid: 0},
  instances: [] as any[],
}))

class MockNWCClient {
  options: Record<string, any>
  nostrWalletConnectUrl: string
  _encryptionType = ""
  getInfoCalls = 0
  payInvoiceParams: unknown
  closed = false

  constructor(options: Record<string, any>) {
    this.options = {
      relayUrl: "wss://relay.example.com/",
      walletPubkey: "wallet-pubkey",
      secret: "secret",
      nostrWalletConnectUrl: "nostr+walletconnect://wallet-pubkey?relay=wss://relay.example.com/&secret=secret",
      ...options,
    }
    this.nostrWalletConnectUrl = this.options.nostrWalletConnectUrl
    mocks.instances.push(this)
  }

  get encryptionType() {
    if (!this._encryptionType) throw new Error("Missing encryption or version")

    return this._encryptionType
  }

  async getWalletServiceInfo() {
    return mocks.serviceInfo
  }

  selectEncryptionType() {
    this._encryptionType = mocks.serviceInfo.encryptions.includes("nip44_v2")
      ? "nip44_v2"
      : mocks.serviceInfo.encryptions.includes("nip04")
        ? "nip04"
        : ""
  }

  async getInfo() {
    this.getInfoCalls += 1
    this.selectEncryptionType()

    return mocks.info
  }

  async getBalance() {
    this.selectEncryptionType()

    return mocks.balance
  }

  async payInvoice(params: unknown) {
    this.selectEncryptionType()
    this.payInvoiceParams = params

    return mocks.payResponse
  }

  close() {
    this.closed = true
  }
}

vi.mock("@getalby/sdk", () => ({
  nwc: {
    NWCClient: MockNWCClient,
  },
}))

describe("NWC helpers", () => {
  beforeEach(() => {
    mocks.serviceInfo = {
      encryptions: ["nip44_v2"],
      capabilities: ["pay_invoice", "get_balance"],
      notifications: [],
    }
    mocks.info = {methods: ["pay_invoice"], lud16: "alice@example.com"}
    mocks.balance = {balance: 21_000}
    mocks.payResponse = {preimage: "preimage", fees_paid: 0}
    mocks.instances = []
  })

  it("connects and persists NIP-44 wallet info", async () => {
    const {connectNwcWallet} = await import("./nwc")
    const result = await connectNwcWallet("nostr+walletconnect://wallet-pubkey?relay=wss://relay.example.com/&secret=secret")

    expect(result.info).toEqual(mocks.info)
    expect(result.walletInfo).toMatchObject({
      nostrWalletConnectUrl: "nostr+walletconnect://wallet-pubkey?relay=wss://relay.example.com/&secret=secret",
      encryptionType: "nip44_v2",
    })
    expect(mocks.instances[0].closed).toBe(true)
  })

  it("falls back to NIP-04 for older wallet services", async () => {
    mocks.serviceInfo = {encryptions: ["nip04"], capabilities: ["pay_invoice"], notifications: []}
    const {connectNwcWallet} = await import("./nwc")
    const result = await connectNwcWallet("nwc://wallet")

    expect(result.walletInfo).toMatchObject({encryptionType: "nip04"})
    expect(mocks.instances[0].getInfoCalls).toBe(1)
    expect(mocks.instances[0].closed).toBe(true)
  })

  it("rejects wallet services without a compatible encryption scheme", async () => {
    mocks.serviceInfo = {encryptions: ["unknown"], capabilities: ["pay_invoice"], notifications: []}
    const {connectNwcWallet} = await import("./nwc")

    await expect(connectNwcWallet("nwc://wallet")).rejects.toThrow(
      "does not advertise a supported NWC encryption scheme",
    )
    expect(mocks.instances[0].getInfoCalls).toBe(0)
    expect(mocks.instances[0].closed).toBe(true)
  })

  it("prefers compatible encryption before paying invoices", async () => {
    const {payNwcInvoice} = await import("./nwc")

    await expect(
      payNwcInvoice({nostrWalletConnectUrl: "nwc://wallet"} as any, {
        invoice: "lnbc1invoice",
        amount: 21_000,
      }),
    ).resolves.toEqual(mocks.payResponse)
    expect(mocks.instances[0].payInvoiceParams).toEqual({invoice: "lnbc1invoice", amount: 21_000})
    expect(mocks.instances[0].closed).toBe(true)
  })

  it("pays invoices with NIP-04 fallback when necessary", async () => {
    mocks.serviceInfo = {encryptions: ["nip04"], capabilities: ["pay_invoice"], notifications: []}
    const {payNwcInvoice} = await import("./nwc")

    await expect(
      payNwcInvoice({nostrWalletConnectUrl: "nwc://wallet"} as any, {invoice: "lnbc1invoice"}),
    ).resolves.toEqual(mocks.payResponse)
    expect(mocks.instances[0]._encryptionType).toBe("nip04")
    expect(mocks.instances[0].closed).toBe(true)
  })
})
