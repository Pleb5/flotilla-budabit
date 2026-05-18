import type {StorageProvider} from "@welshman/store"
import {writable} from "svelte/store"
import {bytesToHex} from "@welshman/lib"
import {SessionMethod, makeNip01Session, type Session} from "@welshman/app"
import {decrypt} from "nostr-tools/nip49"
import {kv} from "@app/core/storage"

export const LOCAL_KEY_SECRET_ENCRYPTION = "nip49-v1"
const UNLOCKED_LOCAL_KEY_SECRETS_STORAGE_KEY = "budabit/unlocked-local-key-secrets"

type SessionLike = Record<string, any> & {method?: string; pubkey?: string}

type StoredSession = SessionLike & {
  secret?: string
  secretCiphertext?: string
  secretEncryption?: typeof LOCAL_KEY_SECRET_ENCRYPTION
}

export type LockedLocalKeySession = StoredSession & {
  method: SessionMethod.Nip01
  pubkey: string
  secretCiphertext: string
  secretEncryption: typeof LOCAL_KEY_SECRET_ENCRYPTION
}

type SessionMap = Record<string, Session>
type StoredSessionMap = Record<string, StoredSession>
type UnlockedLocalKeySecretMap = Record<string, string>

let encryptedLocalSessionCache: StoredSessionMap = {}
let preserveEncryptedLocalSessionsOnNextSet = false

export const lockedLocalKeySessions = writable<Record<string, LockedLocalKeySession>>({})

const isNip01Session = (
  session?: SessionLike,
): session is SessionLike & {method: SessionMethod.Nip01} => session?.method === SessionMethod.Nip01

const hasNip49EncryptedLocalSecret = (session?: SessionLike): session is LockedLocalKeySession =>
  isNip01Session(session) &&
  session.secretEncryption === LOCAL_KEY_SECRET_ENCRYPTION &&
  typeof session.pubkey === "string" &&
  session.pubkey.length > 0 &&
  typeof session.secretCiphertext === "string" &&
  session.secretCiphertext.length > 0

const hasEncryptedLocalSecret = hasNip49EncryptedLocalSecret

const canUseBrowserSessionStorage = () => typeof sessionStorage !== "undefined"

const readUnlockedLocalKeySecrets = (): UnlockedLocalKeySecretMap => {
  if (!canUseBrowserSessionStorage()) return {}

  try {
    const value = sessionStorage.getItem(UNLOCKED_LOCAL_KEY_SECRETS_STORAGE_KEY)

    return value ? JSON.parse(value) : {}
  } catch {
    return {}
  }
}

const writeUnlockedLocalKeySecrets = (secrets: UnlockedLocalKeySecretMap) => {
  if (!canUseBrowserSessionStorage()) return

  sessionStorage.setItem(UNLOCKED_LOCAL_KEY_SECRETS_STORAGE_KEY, JSON.stringify(secrets))
}

const getUnlockedLocalKeySecret = (pubkey: string) => readUnlockedLocalKeySecrets()[pubkey]

export const cacheUnlockedLocalKeySecret = (pubkey: string, secret: string) => {
  const session = makeNip01Session(secret)

  if (session.pubkey !== pubkey) {
    throw new Error("Unlocked local key does not match the stored pubkey")
  }

  writeUnlockedLocalKeySecrets({...readUnlockedLocalKeySecrets(), [pubkey]: secret})
}

export const clearUnlockedLocalKeySecrets = () => {
  if (!canUseBrowserSessionStorage()) return

  sessionStorage.removeItem(UNLOCKED_LOCAL_KEY_SECRETS_STORAGE_KEY)
}

const pruneUnlockedLocalKeySecrets = (sessionsToStore: StoredSessionMap) => {
  const secrets = readUnlockedLocalKeySecrets()
  const retainedSecrets = Object.fromEntries(
    Object.entries(secrets).filter(([pubkey]) =>
      hasNip49EncryptedLocalSecret(sessionsToStore[pubkey]),
    ),
  )

  writeUnlockedLocalKeySecrets(retainedSecrets)
}

const restoreUnlockedLocalKeySession = (
  lockedSession: LockedLocalKeySession,
): Session | undefined => {
  const secret = getUnlockedLocalKeySecret(lockedSession.pubkey)
  if (!secret) return undefined

  try {
    const session = makeNip01Session(secret)
    if (session.pubkey !== lockedSession.pubkey) return undefined

    return {
      ...session,
      secretCiphertext: lockedSession.secretCiphertext,
      secretEncryption: LOCAL_KEY_SECRET_ENCRYPTION,
    }
  } catch {
    return undefined
  }
}

const prepareSessionForStorage = (session: Session): StoredSession => {
  if (!hasNip49EncryptedLocalSecret(session)) return session

  const {secret: _secret, ...storedSession} = session

  return storedSession
}

export const prepareSessionsForStorage = async (value: SessionMap): Promise<StoredSessionMap> => {
  const entries = Object.entries(value || {}).map(([pubkey, session]) => [
    pubkey,
    prepareSessionForStorage(session),
  ])

  return Object.fromEntries(entries)
}

export const restoreSessionsFromStorage = (value?: StoredSessionMap): SessionMap | undefined => {
  if (!value) return undefined

  return Object.fromEntries(
    Object.entries(value).flatMap(([pubkey, session]) => {
      if (!hasEncryptedLocalSecret(session)) return [[pubkey, session]]

      const unlockedSession = restoreUnlockedLocalKeySession(session)

      return unlockedSession ? [[pubkey, unlockedSession]] : []
    }),
  ) as SessionMap
}

const getEncryptedLocalSessions = (value?: StoredSessionMap): StoredSessionMap => {
  if (!value) return {}

  return Object.fromEntries(
    Object.entries(value).filter(([, session]) => hasEncryptedLocalSecret(session)),
  )
}

const getLockedLocalKeySessions = (value?: StoredSessionMap) => {
  if (!value) return {}

  return Object.fromEntries(
    Object.entries(value).filter(
      ([, session]) =>
        hasNip49EncryptedLocalSecret(session) && !restoreUnlockedLocalKeySession(session),
    ),
  ) as Record<string, LockedLocalKeySession>
}

export const unlockEncryptedLocalKeySession = (
  lockedSession: LockedLocalKeySession,
  passphrase: string,
): Session => {
  const secret = bytesToHex(decrypt(lockedSession.secretCiphertext, passphrase))
  const session = makeNip01Session(secret)

  if (session.pubkey !== lockedSession.pubkey) {
    throw new Error("Encrypted local key does not match the stored pubkey")
  }

  cacheUnlockedLocalKeySecret(lockedSession.pubkey, secret)

  return {
    ...session,
    secretCiphertext: lockedSession.secretCiphertext,
    secretEncryption: LOCAL_KEY_SECRET_ENCRYPTION,
  }
}

export const canRestoreStoredPubkey = (pubkey: string | undefined, sessions?: StoredSessionMap) => {
  if (!pubkey || !sessions) return true

  const session = sessions[pubkey]

  if (hasEncryptedLocalSecret(session)) return Boolean(restoreUnlockedLocalKeySession(session))

  return true
}

export const sessionsStorage: StorageProvider = {
  get: async key => {
    const storedSessions = await kv.get<StoredSessionMap>(key)

    encryptedLocalSessionCache = getEncryptedLocalSessions(storedSessions)
    lockedLocalKeySessions.set(getLockedLocalKeySessions(storedSessions))
    preserveEncryptedLocalSessionsOnNextSet = Object.keys(encryptedLocalSessionCache).length > 0

    return restoreSessionsFromStorage(storedSessions)
  },
  set: async (key, value: SessionMap) => {
    const preparedSessions = await prepareSessionsForStorage(value)
    const sessionsToStore = preserveEncryptedLocalSessionsOnNextSet
      ? {...encryptedLocalSessionCache, ...preparedSessions}
      : preparedSessions

    preserveEncryptedLocalSessionsOnNextSet = false
    encryptedLocalSessionCache = getEncryptedLocalSessions(sessionsToStore)
    lockedLocalKeySessions.set(getLockedLocalKeySessions(sessionsToStore))
    pruneUnlockedLocalKeySecrets(sessionsToStore)

    await kv.set(key, sessionsToStore)
  },
}

export const pubkeyStorage: StorageProvider = {
  get: async key => {
    const storedPubkey = await kv.get<string>(key)
    const storedSessions = await kv.get<StoredSessionMap>("sessions")

    return canRestoreStoredPubkey(storedPubkey, storedSessions) ? storedPubkey : undefined
  },
  set: kv.set,
}
