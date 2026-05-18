// @vitest-environment jsdom

import {beforeEach, describe, expect, it} from "vitest"
import {makeNip01Session} from "@welshman/app"
import {hexToBytes} from "@welshman/lib"
import {encrypt} from "nostr-tools/nip49"
import {
  LOCAL_KEY_SECRET_ENCRYPTION,
  cacheUnlockedLocalKeySecret,
  canRestoreStoredPubkey,
  prepareSessionsForStorage,
  pubkeyStorage,
  restoreSessionsFromStorage,
  sessionsStorage,
  unlockEncryptedLocalKeySession,
} from "./session-storage"

const secret = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

describe("session storage", () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it("restores plain local key sessions across reloads", async () => {
    const session = makeNip01Session(secret)

    await sessionsStorage.set("sessions", {[session.pubkey]: session})
    await pubkeyStorage.set("pubkey", session.pubkey)

    expect(await sessionsStorage.get("sessions")).toEqual({[session.pubkey]: session})
    expect(await pubkeyStorage.get("pubkey")).toBe(session.pubkey)
  })

  it("stores encrypted local key sessions without plaintext secrets and keeps them locked", async () => {
    const session = makeNip01Session(secret)
    const encryptedSession = {
      ...session,
      secretCiphertext: encrypt(hexToBytes(secret), "correct horse battery staple", 12),
      secretEncryption: LOCAL_KEY_SECRET_ENCRYPTION as typeof LOCAL_KEY_SECRET_ENCRYPTION,
    }
    const storedSessions = await prepareSessionsForStorage({[session.pubkey]: encryptedSession})

    expect(storedSessions[session.pubkey]?.secret).toBeUndefined()
    expect(storedSessions[session.pubkey]?.secretEncryption).toBe(LOCAL_KEY_SECRET_ENCRYPTION)
    expect(storedSessions[session.pubkey]?.secretCiphertext).toEqual(expect.any(String))
    expect(JSON.stringify(storedSessions)).not.toContain(secret)

    expect(restoreSessionsFromStorage(storedSessions)).toEqual({})
    expect(canRestoreStoredPubkey(session.pubkey, storedSessions)).toBe(false)
  })

  it("restores encrypted local key sessions while the browser session is unlocked", async () => {
    const session = makeNip01Session(secret)
    const encryptedSession = {
      ...session,
      secretCiphertext: encrypt(hexToBytes(secret), "correct horse battery staple", 12),
      secretEncryption: LOCAL_KEY_SECRET_ENCRYPTION as typeof LOCAL_KEY_SECRET_ENCRYPTION,
    }

    await sessionsStorage.set("sessions", {[session.pubkey]: encryptedSession})
    await pubkeyStorage.set("pubkey", session.pubkey)

    expect(await sessionsStorage.get("sessions")).toEqual({})
    expect(await pubkeyStorage.get("pubkey")).toBeUndefined()

    cacheUnlockedLocalKeySecret(session.pubkey, secret)

    expect(await sessionsStorage.get("sessions")).toEqual({
      [session.pubkey]: encryptedSession,
    })
    expect(await pubkeyStorage.get("pubkey")).toBe(session.pubkey)

    sessionStorage.clear()

    expect(await sessionsStorage.get("sessions")).toEqual({})
    expect(await pubkeyStorage.get("pubkey")).toBeUndefined()
  })

  it("unlocks encrypted local key sessions with the passphrase", async () => {
    const session = makeNip01Session(secret)
    const lockedSession = {
      ...session,
      secret: undefined,
      secretCiphertext: encrypt(hexToBytes(secret), "correct horse battery staple", 12),
      secretEncryption: LOCAL_KEY_SECRET_ENCRYPTION as typeof LOCAL_KEY_SECRET_ENCRYPTION,
    }
    const storedSessions = {[session.pubkey]: lockedSession}

    const unlocked = unlockEncryptedLocalKeySession(lockedSession, "correct horse battery staple")

    expect(unlocked).toMatchObject({
      method: session.method,
      pubkey: session.pubkey,
      secret,
      secretCiphertext: lockedSession.secretCiphertext,
      secretEncryption: LOCAL_KEY_SECRET_ENCRYPTION,
    })
    expect(restoreSessionsFromStorage(storedSessions)).toEqual({
      [session.pubkey]: unlocked,
    })

    sessionStorage.clear()

    expect(() => unlockEncryptedLocalKeySession(lockedSession, "wrong passphrase")).toThrow()
  })

  it("preserves encrypted local key records during the initial sync write only", async () => {
    const session = makeNip01Session(secret)
    const encryptedSession = {
      ...session,
      secretCiphertext: encrypt(hexToBytes(secret), "correct horse battery staple", 12),
      secretEncryption: LOCAL_KEY_SECRET_ENCRYPTION as typeof LOCAL_KEY_SECRET_ENCRYPTION,
    }

    await sessionsStorage.set("sessions", {[session.pubkey]: encryptedSession})
    const initiallyStored = JSON.parse(localStorage.getItem("sessions") || "{}")

    expect(await sessionsStorage.get("sessions")).toEqual({})
    await sessionsStorage.set("sessions", {})

    const preserved = JSON.parse(localStorage.getItem("sessions") || "{}")
    expect(preserved[session.pubkey]?.secretCiphertext).toBe(
      initiallyStored[session.pubkey]?.secretCiphertext,
    )

    await sessionsStorage.set("sessions", {})
    const cleared = JSON.parse(localStorage.getItem("sessions") || "{}")
    expect(cleared[session.pubkey]).toBeUndefined()
  })
})
