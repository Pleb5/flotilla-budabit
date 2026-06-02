import * as bip39 from "@scure/bip39"
import {wordlist} from "@scure/bip39/wordlists/english"
import {cleanupBackupCopy} from "@app/util/secret-file"

export const CASHU_BACKUP_KIND = "budabit-cashu-seed-backup"
export const CASHU_BACKUP_VERSION = 1
export const CASHU_BACKUP_ENCRYPTION = "pbkdf2-sha256-aes-256-gcm-v1"
export const CASHU_BACKUP_BEGIN = "-----BEGIN BUDABIT CASHU BACKUP-----"
export const CASHU_BACKUP_END = "-----END BUDABIT CASHU BACKUP-----"

const TEXT_ENCODER = new TextEncoder()
const TEXT_DECODER = new TextDecoder()
const ENCRYPTION_ITERATIONS = 250_000

export type CashuBackupData = {
  mnemonic: string
  mints: string[]
}

export type CashuEncryptedPayload = {
  algorithm: typeof CASHU_BACKUP_ENCRYPTION
  iterations: number
  salt: string
  iv: string
  ciphertext: string
}

export type CashuBackupFilePayload = {
  kind: typeof CASHU_BACKUP_KIND
  version: typeof CASHU_BACKUP_VERSION
  mnemonic?: string
  mints?: string[]
  encrypted?: CashuEncryptedPayload
}

export type ParsedCashuBackup =
  | {type: "plain"; data: CashuBackupData}
  | {type: "encrypted"; encrypted: CashuEncryptedPayload}
  | {type: "none"; reason: string}

const getSubtleCrypto = () => {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error("Passphrase encryption is not available in this browser.")
  return subtle
}

const bytesToBase64 = (bytes: Uint8Array) => {
  if (typeof btoa === "function") {
    let binary = ""
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return btoa(binary)
  }

  return Buffer.from(bytes).toString("base64")
}

const base64ToBytes = (value: string) => {
  if (typeof atob === "function") {
    const binary = atob(value)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  }

  return new Uint8Array(Buffer.from(value, "base64"))
}

const randomBytes = (length: number) => {
  const bytes = new Uint8Array(length)
  globalThis.crypto.getRandomValues(bytes)
  return bytes
}

const toArrayBuffer = (bytes: Uint8Array) =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer

const deriveEncryptionKey = async (passphrase: string, salt: Uint8Array, iterations: number) => {
  const subtle = getSubtleCrypto()
  const material = await subtle.importKey("raw", TEXT_ENCODER.encode(passphrase), "PBKDF2", false, [
    "deriveKey",
  ])

  return subtle.deriveKey(
    {name: "PBKDF2", hash: "SHA-256", salt: toArrayBuffer(salt), iterations},
    material,
    {name: "AES-GCM", length: 256},
    false,
    ["encrypt", "decrypt"],
  )
}

const encryptText = async (
  plaintext: string,
  passphrase: string,
): Promise<CashuEncryptedPayload> => {
  const subtle = getSubtleCrypto()
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = await deriveEncryptionKey(passphrase, salt, ENCRYPTION_ITERATIONS)
  const ciphertext = await subtle.encrypt(
    {name: "AES-GCM", iv: toArrayBuffer(iv)},
    key,
    toArrayBuffer(TEXT_ENCODER.encode(plaintext)),
  )

  return {
    algorithm: CASHU_BACKUP_ENCRYPTION,
    iterations: ENCRYPTION_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  }
}

const decryptText = async (encrypted: CashuEncryptedPayload, passphrase: string) => {
  if (encrypted.algorithm !== CASHU_BACKUP_ENCRYPTION) {
    throw new Error("Unsupported Cashu backup encryption format.")
  }

  const subtle = getSubtleCrypto()
  const salt = base64ToBytes(encrypted.salt)
  const iv = base64ToBytes(encrypted.iv)
  const key = await deriveEncryptionKey(passphrase, salt, encrypted.iterations)
  const plaintext = await subtle.decrypt(
    {name: "AES-GCM", iv: toArrayBuffer(iv)},
    key,
    toArrayBuffer(base64ToBytes(encrypted.ciphertext)),
  )

  return TEXT_DECODER.decode(plaintext)
}

export const normalizeCashuMnemonic = (value: string) =>
  value.trim().toLowerCase().split(/\s+/).join(" ")

export const validateCashuMnemonic = (value: string) => {
  const mnemonic = normalizeCashuMnemonic(value)

  if (!bip39.validateMnemonic(mnemonic, wordlist)) {
    throw new Error("The Cashu seed phrase is not valid.")
  }

  return mnemonic
}

const normalizeMints = (mints: unknown) => {
  if (!Array.isArray(mints)) return []

  return Array.from(
    new Set(
      mints
        .filter((mint): mint is string => typeof mint === "string")
        .map(mint => mint.trim())
        .filter(mint => {
          try {
            const url = new URL(mint)
            return url.protocol === "https:" || url.protocol === "http:"
          } catch {
            return false
          }
        }),
    ),
  )
}

const makePayload = (data: CashuBackupData): CashuBackupFilePayload => ({
  kind: CASHU_BACKUP_KIND,
  version: CASHU_BACKUP_VERSION,
  mnemonic: validateCashuMnemonic(data.mnemonic),
  mints: normalizeMints(data.mints),
})

const makeEncryptedPayload = (encrypted: CashuEncryptedPayload): CashuBackupFilePayload => ({
  kind: CASHU_BACKUP_KIND,
  version: CASHU_BACKUP_VERSION,
  encrypted,
})

const serializePayload = (payload: CashuBackupFilePayload) =>
  `${CASHU_BACKUP_BEGIN}\n${JSON.stringify(payload, null, 2)}\n${CASHU_BACKUP_END}`

export const createCashuBackupText = (data: CashuBackupData) => {
  const payload = makePayload(data)
  const mints = normalizeMints(data.mints)
  const mintCopy = mints.length > 0 ? mints.map(mint => `- ${mint}`).join("\n") : "- none saved"

  return cleanupBackupCopy(`
    This file contains a backup of your Budabit Cashu wallet seed words.

    Cashu is ecash. These words recreate the seed Budabit uses to recover wallet proofs from trusted mints. Anyone with these words may be able to recover and spend ecash from this wallet, so keep them private.

    Your Cashu wallet recovery words are:

    ${payload.mnemonic}

    Trusted mints included in this backup:

    ${mintCopy}

    Budabit can restore this file from the Cashu wallet backup screen.

    ${serializePayload(payload)}
  `)
}

export const createEncryptedCashuBackupText = async (data: CashuBackupData, passphrase: string) => {
  const encrypted = await encryptCashuBackupData(data, passphrase)

  return cleanupBackupCopy(`
    This file contains an encrypted backup of your Budabit Cashu wallet seed words.

    Cashu is ecash. The recovery words inside this file recreate the seed Budabit uses to recover wallet proofs from trusted mints. The words are encrypted with the passphrase you chose when downloading this file.

    Keep both this file and the passphrase safe. Budabit cannot recover the passphrase for you.

    Budabit can restore this file from the Cashu wallet backup screen.

    ${serializePayload(makeEncryptedPayload(encrypted))}
  `)
}

export const encryptCashuBackupData = async (
  data: CashuBackupData,
  passphrase: string,
): Promise<CashuEncryptedPayload> => {
  const payload = {
    mnemonic: validateCashuMnemonic(data.mnemonic),
    mints: normalizeMints(data.mints),
  }

  return encryptText(JSON.stringify(payload), passphrase)
}

export const decryptCashuBackupData = async (
  encrypted: CashuEncryptedPayload,
  passphrase: string,
): Promise<CashuBackupData> => {
  const plaintext = await decryptText(encrypted, passphrase)
  const parsed = JSON.parse(plaintext)

  return {
    mnemonic: validateCashuMnemonic(parsed.mnemonic || ""),
    mints: normalizeMints(parsed.mints),
  }
}

const parsePayload = (raw: unknown): ParsedCashuBackup => {
  const payload = raw as Partial<CashuBackupFilePayload>

  if (payload.kind !== CASHU_BACKUP_KIND || payload.version !== CASHU_BACKUP_VERSION) {
    return {type: "none", reason: "This is not a Budabit Cashu backup file."}
  }

  if (payload.encrypted) {
    return {type: "encrypted", encrypted: payload.encrypted}
  }

  if (typeof payload.mnemonic === "string") {
    return {
      type: "plain",
      data: {
        mnemonic: validateCashuMnemonic(payload.mnemonic),
        mints: normalizeMints(payload.mints),
      },
    }
  }

  return {type: "none", reason: "The Cashu backup file is missing recovery words."}
}

const extractPayloadJson = (text: string) => {
  const markerMatch = text.match(
    new RegExp(`${CASHU_BACKUP_BEGIN}\\s*([\\s\\S]+?)\\s*${CASHU_BACKUP_END}`),
  )

  if (markerMatch?.[1]) return markerMatch[1]

  const trimmed = text.trim()
  return trimmed.startsWith("{") ? trimmed : ""
}

export const parseCashuBackupText = (text: string): ParsedCashuBackup => {
  const payloadJson = extractPayloadJson(text)

  if (payloadJson) {
    try {
      return parsePayload(JSON.parse(payloadJson))
    } catch (e: any) {
      return {
        type: "none",
        reason:
          e instanceof SyntaxError
            ? "The Cashu backup file is not valid JSON."
            : e?.message || "The Cashu backup file is invalid.",
      }
    }
  }

  return {
    type: "none",
    reason: "This is not a Budabit Cashu backup file. Use manual seed restore for seed words.",
  }
}
