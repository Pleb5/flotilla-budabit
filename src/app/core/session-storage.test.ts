// @vitest-environment jsdom

import {beforeEach, describe, expect, it} from "vitest"
import {makeNip01Session} from "@welshman/app"
import {Nip01Signer} from "@welshman/signer"
import {
  LOCAL_KEY_SECRET_ENCRYPTION,
  canRestoreStoredPubkey,
  encryptLocalKeySessionForStorage,
  prepareSessionsForStorage,
  restoreSessionsFromStorage,
  sessionsStorage,
} from "./session-storage"

const secret = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

describe("session storage", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("encrypts local key session secrets before storage", async () => {
    const session = {...makeNip01Session(secret), label: "local"}
    const stored = await encryptLocalKeySessionForStorage(session)

    expect(stored.pubkey).toBe(session.pubkey)
    expect(stored.secret).toBeUndefined()
    expect(stored.secretEncryption).toBe(LOCAL_KEY_SECRET_ENCRYPTION)
    expect(stored.secretCiphertext).toEqual(expect.any(String))
    expect(JSON.stringify(stored)).not.toContain(secret)

    const signer = new Nip01Signer(secret)
    await expect(signer.nip44.decrypt(stored.pubkey!, stored.secretCiphertext!)).resolves.toBe(
      secret,
    )
  })

  it("does not restore encrypted local key sessions without an in-memory secret", async () => {
    const session = makeNip01Session(secret)
    const storedSessions = await prepareSessionsForStorage({[session.pubkey]: session})

    expect(restoreSessionsFromStorage(storedSessions)).toEqual({})
    expect(canRestoreStoredPubkey(session.pubkey, storedSessions)).toBe(false)
  })

  it("keeps legacy plaintext local key sessions available for one-time migration", () => {
    const session = makeNip01Session(secret)
    const storedSessions = {[session.pubkey]: session}

    expect(restoreSessionsFromStorage(storedSessions)).toEqual(storedSessions)
    expect(canRestoreStoredPubkey(session.pubkey, storedSessions)).toBe(true)
  })

  it("preserves encrypted local key records during the initial sync write only", async () => {
    const session = makeNip01Session(secret)

    await sessionsStorage.set("sessions", {[session.pubkey]: session})
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
