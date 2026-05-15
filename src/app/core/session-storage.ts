import type {StorageProvider} from "@welshman/store"
import type {Session} from "@welshman/app"
import {Nip01Signer} from "@welshman/signer"
import {kv} from "@app/core/storage"

export const LOCAL_KEY_SECRET_ENCRYPTION = "nip44-self-v1"

type SessionLike = Record<string, any> & {method?: string; pubkey?: string}

type StoredSession = SessionLike & {
  secret?: string
  secretCiphertext?: string
  secretEncryption?: typeof LOCAL_KEY_SECRET_ENCRYPTION
}

type SessionMap = Record<string, Session>
type StoredSessionMap = Record<string, StoredSession>

let encryptedLocalSessionCache: StoredSessionMap = {}
let preserveEncryptedLocalSessionsOnNextSet = false

const isNip01Session = (session?: SessionLike): session is SessionLike & {method: "nip01"} =>
  session?.method === "nip01"

const hasPlainLocalSecret = (session?: SessionLike): session is Session & {secret: string} =>
  isNip01Session(session) && typeof session.secret === "string" && session.secret.length > 0

const hasEncryptedLocalSecret = (session?: SessionLike) =>
  isNip01Session(session) &&
  session.secretEncryption === LOCAL_KEY_SECRET_ENCRYPTION &&
  typeof session.secretCiphertext === "string" &&
  session.secretCiphertext.length > 0

export const encryptLocalKeySessionForStorage = async (
  session: Session,
): Promise<StoredSession> => {
  if (!hasPlainLocalSecret(session)) return session

  const signer = new Nip01Signer(session.secret)
  const signerPubkey = await signer.getPubkey()

  if (signerPubkey !== session.pubkey) {
    throw new Error("Local key does not match session pubkey")
  }

  const secretCiphertext = await signer.nip44.encrypt(session.pubkey, session.secret)
  const {secret: _secret, ...storedSession} = session

  return {
    ...storedSession,
    secretCiphertext,
    secretEncryption: LOCAL_KEY_SECRET_ENCRYPTION,
  }
}

export const prepareSessionsForStorage = async (value: SessionMap): Promise<StoredSessionMap> => {
  const entries = await Promise.all(
    Object.entries(value || {}).map(async ([pubkey, session]) => [
      pubkey,
      await encryptLocalKeySessionForStorage(session),
    ]),
  )

  return Object.fromEntries(entries)
}

export const restoreSessionsFromStorage = (value?: StoredSessionMap): SessionMap | undefined => {
  if (!value) return undefined

  return Object.fromEntries(
    Object.entries(value).filter(([, session]) => !hasEncryptedLocalSecret(session)),
  ) as SessionMap
}

const getEncryptedLocalSessions = (value?: StoredSessionMap): StoredSessionMap => {
  if (!value) return {}

  return Object.fromEntries(
    Object.entries(value).filter(([, session]) => hasEncryptedLocalSecret(session)),
  )
}

export const canRestoreStoredPubkey = (pubkey: string | undefined, sessions?: StoredSessionMap) => {
  if (!pubkey || !sessions) return true

  const session = sessions[pubkey]

  return !hasEncryptedLocalSecret(session)
}

export const sessionsStorage: StorageProvider = {
  get: async key => {
    const storedSessions = await kv.get<StoredSessionMap>(key)

    encryptedLocalSessionCache = getEncryptedLocalSessions(storedSessions)
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
