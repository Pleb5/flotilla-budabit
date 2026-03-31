import {beforeEach, describe, expect, it, vi} from "vitest"

const mocks = vi.hoisted(() => {
  const createStore = <T>(initial: T) => {
    let value = initial
    const subscribers = new Set<(value: T) => void>()
    let subscribeCount = 0
    let unsubscribeCount = 0

    return {
      set(next: T) {
        value = next
        subscribers.forEach(fn => fn(value))
      },
      get() {
        return value
      },
      reset(next: T) {
        value = next
        subscribers.clear()
        subscribeCount = 0
        unsubscribeCount = 0
      },
      subscribe(fn: (value: T) => void) {
        subscribeCount += 1
        subscribers.add(fn)
        fn(value)

        return () => {
          unsubscribeCount += 1
          subscribers.delete(fn)
        }
      },
      stats() {
        return {subscribeCount, unsubscribeCount, subscriberCount: subscribers.size}
      },
    }
  }

  return {
    signer: createStore<any>(null),
    pubkey: createStore<string | null>(null),
  }
})

vi.mock("@welshman/app", () => ({
  signer: mocks.signer,
  pubkey: mocks.pubkey,
}))

beforeEach(() => {
  vi.resetModules()
  mocks.signer.reset(null)
  mocks.pubkey.reset(null)
})

describe("signerContextAdapter", () => {
  it("creates an empty signer context when welshman stores are unset", async () => {
    const {createSignerContext} = await import("./signerContextAdapter")

    expect(createSignerContext()).toEqual({
      signer: null,
      pubkey: null,
      isReady: false,
    })
  })

  it("prefers nip44 encrypt and decrypt methods when available", async () => {
    const nip44Encrypt = vi.fn().mockResolvedValue("nip44-encrypted")
    const nip44Decrypt = vi.fn().mockResolvedValue("nip44-decrypted")

    mocks.signer.set({
      nip44: {
        encrypt: nip44Encrypt,
        decrypt: nip44Decrypt,
      },
      encrypt: vi.fn().mockResolvedValue("legacy-encrypted"),
      decrypt: vi.fn().mockResolvedValue("legacy-decrypted"),
    })
    mocks.pubkey.set("a".repeat(64))

    const {createSignerContext} = await import("./signerContextAdapter")
    const context = createSignerContext()

    expect(context.isReady).toBe(true)
    await expect(context.signer?.encrypt("b".repeat(64), "hello")).resolves.toBe("nip44-encrypted")
    await expect(context.signer?.decrypt("b".repeat(64), "cipher")).resolves.toBe("nip44-decrypted")
    expect(nip44Encrypt).toHaveBeenCalledWith("b".repeat(64), "hello")
    expect(nip44Decrypt).toHaveBeenCalledWith("b".repeat(64), "cipher")
  })

  it("falls back to legacy encrypt and decrypt methods", async () => {
    const encrypt = vi.fn().mockResolvedValue("legacy-encrypted")
    const decrypt = vi.fn().mockResolvedValue("legacy-decrypted")

    mocks.signer.set({encrypt, decrypt})
    mocks.pubkey.set("a".repeat(64))

    const {createSignerContext} = await import("./signerContextAdapter")
    const context = createSignerContext()

    await expect(context.signer?.encrypt("b".repeat(64), "hello")).resolves.toBe("legacy-encrypted")
    await expect(context.signer?.decrypt("b".repeat(64), "cipher")).resolves.toBe(
      "legacy-decrypted",
    )
    expect(encrypt).toHaveBeenCalledWith("b".repeat(64), "hello")
    expect(decrypt).toHaveBeenCalledWith("b".repeat(64), "cipher")
  })

  it("throws a clear error when encrypt or decrypt is unsupported", async () => {
    mocks.signer.set({})
    mocks.pubkey.set("a".repeat(64))

    const {createSignerContext} = await import("./signerContextAdapter")
    const context = createSignerContext()

    await expect(context.signer?.encrypt("b".repeat(64), "hello")).rejects.toThrow(
      "Signer does not support encrypt",
    )
    await expect(context.signer?.decrypt("b".repeat(64), "cipher")).rejects.toThrow(
      "Signer does not support decrypt",
    )
  })

  it("subscribes lazily and tears down welshman listeners after the last subscriber leaves", async () => {
    const {createReactiveSignerContext} = await import("./signerContextAdapter")
    const reactive = createReactiveSignerContext()
    const callback = vi.fn()
    const signerBaseline = mocks.signer.stats()
    const pubkeyBaseline = mocks.pubkey.stats()

    expect(signerBaseline).toEqual({
      subscribeCount: 1,
      unsubscribeCount: 1,
      subscriberCount: 0,
    })
    expect(pubkeyBaseline).toEqual({
      subscribeCount: 1,
      unsubscribeCount: 1,
      subscriberCount: 0,
    })

    const unsubscribe = reactive.subscribe(callback)

    expect(mocks.signer.stats().subscribeCount).toBeGreaterThan(signerBaseline.subscribeCount)
    expect(mocks.pubkey.stats().subscribeCount).toBeGreaterThan(pubkeyBaseline.subscribeCount)
    expect(mocks.signer.stats().subscriberCount).toBe(1)
    expect(mocks.pubkey.stats().subscriberCount).toBe(1)

    const encrypt = vi.fn().mockResolvedValue("cipher")
    const decrypt = vi.fn().mockResolvedValue("plain")
    mocks.signer.set({encrypt, decrypt})
    mocks.pubkey.set("c".repeat(64))

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        pubkey: "c".repeat(64),
        isReady: true,
      }),
    )

    unsubscribe()

    expect(mocks.signer.stats().unsubscribeCount).toBeGreaterThan(signerBaseline.unsubscribeCount)
    expect(mocks.pubkey.stats().unsubscribeCount).toBeGreaterThan(pubkeyBaseline.unsubscribeCount)
    expect(mocks.signer.stats().subscriberCount).toBe(0)
    expect(mocks.pubkey.stats().subscriberCount).toBe(0)
  })
})
