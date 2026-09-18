import {writable, get} from "svelte/store"
import type {Writable} from "svelte/store"
import {
  Manager,
  initializeCoco,
  ConsoleLogger,
  getEncodedToken,
  getTokenMetadata,
} from "@cashu/coco-core"
import type {HistoryEntry, MintQuote, MintOperation} from "@cashu/coco-core"
import {IndexedDbRepositories} from "@cashu/coco-indexeddb"
import * as bip39 from "@scure/bip39"
import {wordlist} from "@scure/bip39/wordlists/english"
import {deleteIndexedDB} from "@lib/util"
import {storageGet, storageRemove, storageSet} from "@app/core/cashu-storage"
import {
  decryptCashuBackupData,
  encryptCashuBackupData,
  validateCashuMnemonic,
} from "@app/util/cashu-backup"
import type {CashuBackupData, CashuEncryptedPayload} from "@app/util/cashu-backup"
import {cashuPositiveSats, cashuSatsNumber} from "@app/util/cashu-amount"
import {cashuSnapshotDatabaseName, prepareCashuStorageUpgrade} from "./cashu-storage-migration"
import {enforceCashuKeysetPolicy} from "./cashu-keyset-policy"

const KEY_MNEMONIC = "budabit_cashu_mnemonic"
const KEY_MNEMONIC_ENCRYPTED = "budabit_cashu_mnemonic_encrypted"
const KEY_BACKUP_CONFIRMED = "budabit_cashu_backup_confirmed"
const KEY_AUTOPAY_WHITELIST = "budabit_cashu_autopay_whitelist"
const KEY_UNLOCKED_MNEMONIC = "budabit/unlocked-cashu-mnemonic"
const DB_NAME = "budabit-coco-wallet"
const HISTORY_PAGE_SIZE = 100

export interface TokenHistoryEntry {
  id: string
  direction: "sent" | "received" | "minted"
  amount: number
  mintUrl: string
  token?: string
  createdAt: number
}

export const cashuInitialized: Writable<boolean> = writable(false)
export const cashuBackupConfirmed: Writable<boolean> = writable(false)
export const cashuTotalBalance: Writable<number> = writable(0)
export const cashuBalancesByMint: Writable<Map<string, number>> = writable(new Map())
export const cashuMints: Writable<string[]> = writable([])
export const cashuTokenHistory: Writable<TokenHistoryEntry[]> = writable([])
export const cashuAutoPayWhitelist: Writable<string[]> = writable([])
export const cashuSetupResolved: Writable<boolean> = writable(false)
export const cashuSetupRequired: Writable<boolean> = writable(false)
export const cashuSeedEncrypted: Writable<boolean> = writable(false)
export const cashuSeedLocked: Writable<boolean> = writable(false)
export const cashuRecoveryInProgress: Writable<boolean> = writable(false)
export const cashuWalletError: Writable<string> = writable("")

export interface CashuTopUpQuote {
  mintUrl: string
  quote: string
  request: string
  amount: number
  expiry: number | null
  operationId?: string
  state: "unpaid" | "pending" | "complete" | "expired" | "failed"
  error?: string
}
export const cashuTopUps: Writable<CashuTopUpQuote[]> = writable([])

// Internal manager reference
let manager: Manager | null = null
let repo: IndexedDbRepositories | null = null
let _mnemonic: string | null = null
let _encryptedMnemonic: CashuEncryptedPayload | null = null

// ─── Initialization ───────────────────────────────────────────────────────────

let _initPromise: Promise<void> | null = null
// Resolves the moment `manager` is assigned, *before* the warmup refresh
// batch. Handler-facing functions wait on this so they don't get stuck
// behind a slow mint roundtrip or IndexedDB seek that's running purely
// for store-warmup purposes.
let _managerReadyPromise: Promise<void> | null = null
let _resolveManagerReady: (() => void) | null = null
let runtimeGeneration = 0
let initializationError: Error | null = null

const canUseBrowserSessionStorage = () => typeof sessionStorage !== "undefined"

const getUnlockedCashuMnemonic = () => {
  if (!canUseBrowserSessionStorage()) return null
  return sessionStorage.getItem(KEY_UNLOCKED_MNEMONIC)
}

const cacheUnlockedCashuMnemonic = (mnemonic: string) => {
  if (!canUseBrowserSessionStorage()) return
  sessionStorage.setItem(KEY_UNLOCKED_MNEMONIC, mnemonic)
}

const clearUnlockedCashuMnemonic = () => {
  if (!canUseBrowserSessionStorage()) return
  sessionStorage.removeItem(KEY_UNLOCKED_MNEMONIC)
}

const resetManagerRuntime = async () => {
  runtimeGeneration++
  const previousManager = manager
  const previousRepo = repo
  const previousInit = _initPromise
  _resolveManagerReady?.()
  manager = null
  repo = null
  cashuInitialized.set(false)
  cashuTotalBalance.set(0)
  cashuBalancesByMint.set(new Map())
  cashuMints.set([])
  cashuTokenHistory.set([])
  cashuTopUps.set([])
  cashuWalletError.set("")
  initializationError = null
  cashuSetupResolved.set(false)
  _initPromise = null
  _managerReadyPromise = null
  _resolveManagerReady = null
  await previousManager?.dispose()
  await previousInit
  previousRepo?.db.close()
}

export const clearCashuWalletStorage = async (): Promise<void> => {
  await resetManagerRuntime()
  _mnemonic = null
  _encryptedMnemonic = null
  clearUnlockedCashuMnemonic()
  cashuBackupConfirmed.set(false)
  cashuAutoPayWhitelist.set([])
  cashuSetupRequired.set(false)
  cashuSeedEncrypted.set(false)
  cashuSeedLocked.set(false)

  await Promise.all([
    storageRemove(KEY_MNEMONIC),
    storageRemove(KEY_MNEMONIC_ENCRYPTED),
    storageRemove(KEY_BACKUP_CONFIRMED),
    storageRemove(KEY_AUTOPAY_WHITELIST),
  ])
  await deleteIndexedDB(DB_NAME)
  await deleteIndexedDB(cashuSnapshotDatabaseName(DB_NAME))
}

const ensureManagerReady = async (): Promise<void> => {
  const generation = runtimeGeneration
  if (!_managerReadyPromise) {
    _managerReadyPromise = new Promise<void>(resolve => {
      _resolveManagerReady = resolve
    })
  }
  // Kick off init if it hasn't started; we don't await the full init
  // promise here, only the manager-ready half.
  if (!_initPromise) initializeCashuWallet()
  await _managerReadyPromise
  if (generation !== runtimeGeneration) throw new Error("Wallet session changed")
  if (initializationError) throw initializationError
}

export const initializeCashuWallet = (): Promise<void> => {
  if (_initPromise) return _initPromise
  if (initializationError) {
    _managerReadyPromise = null
    _resolveManagerReady = null
  }
  if (!_managerReadyPromise) {
    _managerReadyPromise = new Promise<void>(resolve => {
      _resolveManagerReady = resolve
    })
  }
  initializationError = null
  cashuWalletError.set("")
  _initPromise = _doInitialize(runtimeGeneration)
  return _initPromise
}

const _doInitialize = async (generation: number): Promise<void> => {
  let openingRepo: IndexedDbRepositories | null = null
  let openingManager: Manager | null = null
  try {
    const backupFlag = await storageGet(KEY_BACKUP_CONFIRMED)
    if (generation !== runtimeGeneration) return
    cashuBackupConfirmed.set(backupFlag === "true")

    const encryptedRaw = await storageGet(KEY_MNEMONIC_ENCRYPTED)
    if (generation !== runtimeGeneration) return
    if (encryptedRaw) {
      cashuSeedEncrypted.set(true)
      _encryptedMnemonic = JSON.parse(encryptedRaw)

      const unlocked = getUnlockedCashuMnemonic()
      if (unlocked) {
        try {
          _mnemonic = validateCashuMnemonic(unlocked)
        } catch {
          clearUnlockedCashuMnemonic()
        }
      }

      if (!_mnemonic) {
        cashuSeedLocked.set(true)
        cashuSetupResolved.set(true)
        cashuSetupRequired.set(false)
        _resolveManagerReady?.()
        return
      }

      cashuSeedLocked.set(false)
      cashuSetupResolved.set(true)
      cashuSetupRequired.set(false)
    } else {
      cashuSeedEncrypted.set(false)
      cashuSeedLocked.set(false)

      const existing = await storageGet(KEY_MNEMONIC)
      if (generation !== runtimeGeneration) return
      if (existing) {
        _mnemonic = validateCashuMnemonic(existing)
        cashuSetupResolved.set(true)
        cashuSetupRequired.set(false)
      } else {
        await storageRemove(KEY_BACKUP_CONFIRMED)
        cashuBackupConfirmed.set(false)
        cashuSetupResolved.set(true)
        cashuSetupRequired.set(true)
        _resolveManagerReady?.()
        return
      }
    }

    const whitelistRaw = localStorage.getItem(KEY_AUTOPAY_WHITELIST)
    const whitelist: string[] = whitelistRaw ? JSON.parse(whitelistRaw) : []
    cashuAutoPayWhitelist.set(whitelist)

    await prepareCashuStorageUpgrade(DB_NAME)
    if (generation !== runtimeGeneration) return
    openingRepo = new IndexedDbRepositories({name: DB_NAME})
    await openingRepo.init()
    await openingRepo.db.open()
    enforceCashuKeysetPolicy(openingRepo)
    if (generation !== runtimeGeneration) {
      openingRepo.db.close()
      return
    }

    const seed = bip39.mnemonicToSeedSync(_mnemonic!)
    const seedGetter = async () => seed
    openingManager = await initializeCoco({
      repo: openingRepo,
      seedGetter,
      logger: new ConsoleLogger("coco", {level: "warn"}),
      watchers: {
        // Keep mint issuance and melt settlement/recovery enabled. Only the
        // optional polling of externally spent send proofs remains disabled.
        proofStateWatcher: {disabled: true},
      },
    })
    if (generation !== runtimeGeneration) {
      await openingManager.dispose()
      openingRepo.db.close()
      return
    }
    repo = openingRepo
    manager = openingManager

    manager.on("mint:added", refreshCashuMints)
    manager.on("mint:trusted", refreshCashuMints)
    manager.on("mint:untrusted", refreshCashuMints)
    manager.on("mint:updated", refreshCashuMints)
    manager.on("history:updated", refreshCashuHistory)
    manager.on("proofs:saved", refreshCashuBalances)
    manager.on("proofs:state-changed", refreshCashuBalances)
    manager.on("proofs:reserved", refreshCashuBalances)
    manager.on("proofs:released", refreshCashuBalances)
    manager.on("proofs:deleted", refreshCashuBalances)
    manager.on("proofs:wiped", refreshCashuBalances)
    manager.on("mint-quote:updated", refreshCashuTopUps)
    manager.on("mint-op:pending", refreshCashuTopUps)
    manager.on("mint-op:finalized", refreshCashuTopUps)
    manager.on("mint-op:failed", refreshCashuTopUps)

    cashuInitialized.set(true)
    // Manager is fully wired — unblock any handler-facing callers waiting on
    // ensureManagerReady() before we run the (potentially slow) warmup
    // refresh batch.
    _resolveManagerReady?.()
    await Promise.all([
      refreshCashuMints(),
      refreshCashuHistory(),
      refreshCashuBalances(),
      refreshCashuTopUps(),
    ])
  } catch (e) {
    await openingManager?.dispose()
    openingRepo?.db.close()
    if (generation !== runtimeGeneration) return
    manager = null
    repo = null
    initializationError = e instanceof Error ? e : new Error(String(e))
    cashuWalletError.set(initializationError.message)
    cashuInitialized.set(false)
    _initPromise = null
    // Unblock waiters even on failure so they hit the !manager throw rather
    // than hanging forever.
    cashuSetupResolved.set(true)
    _resolveManagerReady?.()
  }
}

// ─── Mnemonic / Backup ────────────────────────────────────────────────────────

export const getCashuMnemonic = (): string => {
  if (get(cashuSeedLocked)) throw new Error("Cashu wallet is locked")
  if (!_mnemonic) throw new Error("Wallet not initialized")
  return _mnemonic
}

export const reloadCashuWallet = async (): Promise<void> => {
  await resetManagerRuntime()
  await initializeCashuWallet()
}

export const confirmCashuBackup = async (): Promise<void> => {
  await storageSet(KEY_BACKUP_CONFIRMED, "true")
  cashuBackupConfirmed.set(true)
}

const persistCashuMnemonic = async (
  data: CashuBackupData,
  encryptPassphrase?: string,
): Promise<void> => {
  const mnemonic = validateCashuMnemonic(data.mnemonic)

  if (encryptPassphrase) {
    _encryptedMnemonic = await encryptCashuBackupData(
      {mnemonic, mints: data.mints || []},
      encryptPassphrase,
    )
    await storageSet(KEY_MNEMONIC_ENCRYPTED, JSON.stringify(_encryptedMnemonic))
    await storageRemove(KEY_MNEMONIC)
    cacheUnlockedCashuMnemonic(mnemonic)
    cashuSeedEncrypted.set(true)
    cashuSeedLocked.set(false)
  } else {
    _encryptedMnemonic = null
    await storageSet(KEY_MNEMONIC, mnemonic)
    await storageRemove(KEY_MNEMONIC_ENCRYPTED)
    clearUnlockedCashuMnemonic()
    cashuSeedEncrypted.set(false)
    cashuSeedLocked.set(false)
  }

  _mnemonic = mnemonic
  cashuSetupResolved.set(true)
  cashuSetupRequired.set(false)
}

export const createCashuWallet = async (): Promise<void> => {
  const mnemonic = bip39.generateMnemonic(wordlist)

  await resetManagerRuntime()
  await persistCashuMnemonic({mnemonic, mints: []})
  await storageRemove(KEY_BACKUP_CONFIRMED)
  cashuBackupConfirmed.set(false)
  await deleteIndexedDB(DB_NAME)
  await deleteIndexedDB(cashuSnapshotDatabaseName(DB_NAME))
  await initializeCashuWallet()
}

export const encryptCashuSeedAtRest = async (passphrase: string): Promise<void> => {
  if (!_mnemonic) throw new Error("Wallet not initialized")

  await persistCashuMnemonic({mnemonic: _mnemonic, mints: get(cashuMints)}, passphrase)
}

export const unlockEncryptedCashuSeed = async (passphrase: string): Promise<void> => {
  const encryptedRaw = await storageGet(KEY_MNEMONIC_ENCRYPTED)
  const encrypted = encryptedRaw
    ? (JSON.parse(encryptedRaw) as CashuEncryptedPayload)
    : _encryptedMnemonic

  if (!encrypted) throw new Error("No encrypted Cashu seed is stored on this device")

  const data = await decryptCashuBackupData(encrypted, passphrase)
  _mnemonic = data.mnemonic
  _encryptedMnemonic = encrypted
  cacheUnlockedCashuMnemonic(data.mnemonic)
  cashuSeedEncrypted.set(true)
  cashuSeedLocked.set(false)
  await resetManagerRuntime()
  await initializeCashuWallet()

  for (const mintUrl of data.mints) {
    try {
      await trustCashuMint(mintUrl)
    } catch (e) {
      console.warn("[cashu] Failed to trust mint from encrypted seed:", e)
    }
  }
}

export const restoreCashuSeedBackup = async (
  data: CashuBackupData,
  options: {encryptPassphrase?: string} = {},
): Promise<{succeeded: string[]; failed: {mintUrl: string; error: string}[]}> => {
  const mnemonic = validateCashuMnemonic(data.mnemonic)
  const mints = Array.from(new Set((data.mints || []).map(mint => mint.trim()).filter(Boolean)))

  cashuRecoveryInProgress.set(true)
  try {
    await resetManagerRuntime()
    await persistCashuMnemonic({mnemonic, mints}, options.encryptPassphrase)
    await storageRemove(KEY_BACKUP_CONFIRMED)
    cashuBackupConfirmed.set(false)
    await deleteIndexedDB(DB_NAME)
    await deleteIndexedDB(cashuSnapshotDatabaseName(DB_NAME))
    await initializeCashuWallet()

    const failed: {mintUrl: string; error: string}[] = []
    for (const mintUrl of mints) {
      try {
        await trustCashuMint(mintUrl)
      } catch (e: any) {
        failed.push({mintUrl, error: e?.message || String(e)})
      }
    }

    if (mints.length === 0) return {succeeded: [], failed}

    const recovered = await recoverAllTrustedMints()
    return {succeeded: recovered.succeeded, failed: [...failed, ...recovered.failed]}
  } finally {
    cashuRecoveryInProgress.set(false)
  }
}

// ─── Mint Management ──────────────────────────────────────────────────────────

const refreshCashuMints = async (): Promise<void> => {
  if (!manager) return
  const active = manager
  try {
    const mints = await active.mint.getAllTrustedMints()
    if (manager === active) cashuMints.set(mints.map(m => m.mintUrl))
  } catch (e) {
    console.error("[cashu] Failed to refresh mints:", e)
  }
}

export const addCashuMint = async (url: string): Promise<void> => {
  await ensureManagerReady()
  if (!manager) throw new Error("Wallet not initialized")

  await manager.mint.addMint(url, {trusted: true})
  // mint:added / mint:trusted events drive the store refresh
}

export class UntrustedMintError extends Error {
  readonly code = "untrusted_mint" as const
  constructor(public readonly mintUrl: string) {
    super(`Mint ${mintUrl} is not trusted`)
    this.name = "UntrustedMintError"
  }
}

/**
 * Reconciles in-flight receives using their saved outputs, then runs a
 * deterministic restore for the mint's sat keysets.
 */
export const recoverCashuMint = async (mintUrl: string): Promise<void> => {
  await ensureManagerReady()
  if (!manager) throw new Error("Wallet not initialized")

  const active = manager
  // Executing receives own persisted output data. Recover them rather than
  // discarding it or treating a failed cancellation as successful recovery.
  for (const op of await active.ops.receive.listInFlight()) {
    if (op.mintUrl === mintUrl) await active.ops.receive.refresh(op.id)
  }
  await active.wallet.restore(mintUrl, {units: ["sat"]})
  await refreshCashuBalances()
}

/**
 * Run `recoverCashuMint` over every trusted mint. Per-mint failures are
 * collected and returned alongside successes; the caller decides how to
 * surface the partial result.
 */
export const recoverAllTrustedMints = async (): Promise<{
  succeeded: string[]
  failed: {mintUrl: string; error: string}[]
}> => {
  await ensureManagerReady()
  if (!manager) throw new Error("Wallet not initialized")

  const trusted = await manager.mint.getAllTrustedMints()
  const succeeded: string[] = []
  const failed: {mintUrl: string; error: string}[] = []
  for (const {mintUrl} of trusted) {
    try {
      await recoverCashuMint(mintUrl)
      succeeded.push(mintUrl)
    } catch (e: any) {
      failed.push({mintUrl, error: e?.message || String(e)})
    }
  }
  return {succeeded, failed}
}

export const trustCashuMint = async (url: string): Promise<void> => {
  await ensureManagerReady()
  if (!manager) throw new Error("Wallet not initialized")

  await manager.mint.addMint(url, {trusted: true})
  // mint:added / mint:trusted events drive the store refresh
}

export const removeCashuMint = async (url: string): Promise<void> => {
  await ensureManagerReady()
  if (!manager) throw new Error("Wallet not initialized")

  await manager.mint.untrustMint(url)
  // mint:untrusted event drops it from the trusted-mints store
}

// ─── Balance ──────────────────────────────────────────────────────────────────

export const refreshCashuBalances = async (): Promise<void> => {
  if (!manager) return
  const active = manager
  try {
    await refreshCashuBalancesStrict()
  } catch (e) {
    if (manager === active) cashuWalletError.set(e instanceof Error ? e.message : String(e))
  }
}

const refreshCashuBalancesStrict = async (): Promise<number> => {
  if (!manager) throw new Error("Wallet not initialized")

  const active = manager
  const byMint = await active.wallet.balances.byMint()
  const map = new Map(
    Object.entries(byMint).map(([url, snap]) => [url, cashuSatsNumber(snap.total)]),
  )
  const {total} = await active.wallet.balances.total()
  const sats = cashuSatsNumber(total)
  if (manager !== active) throw new Error("Wallet session changed")
  cashuBalancesByMint.set(map)
  cashuTotalBalance.set(sats)
  return sats
}

// ─── Token Operations ─────────────────────────────────────────────────────────

export const receiveCashuToken = async (token: string): Promise<number> => {
  await ensureManagerReady()
  if (!manager) throw new Error("Wallet not initialized")
  const active = manager

  const metadata = getTokenMetadata(token)
  const mintUrl = metadata.mint
  if (metadata.unit !== "sat") throw new Error("Only sat-denominated Cashu tokens are supported")
  cashuSatsNumber(metadata.amount)

  if (mintUrl && !(await active.mint.isTrustedMint(mintUrl))) {
    throw new UntrustedMintError(mintUrl)
  }
  const decoded = await active.wallet.decodeToken(token, mintUrl)
  if (decoded.proofs.some(proof => !/^(00|01)[0-9a-f]+$/i.test(proof.id))) {
    throw new Error("Unsupported Cashu keyset: BLS tokens are not enabled")
  }

  if (manager !== active) throw new Error("Wallet session changed")
  const prepared = await active.ops.receive.prepare({token: decoded})
  const received = await active.ops.receive.execute(prepared)
  if (manager !== active) throw new Error("Wallet session changed")
  const amount = cashuSatsNumber(received.amount.subtract(received.fee))
  await refreshCashuBalancesStrict()
  await refreshCashuHistoryStrict()
  return amount
}

export const createCashuToken = async (amount: number, mintUrl: string): Promise<string> => {
  const sats = cashuPositiveSats(amount)
  await ensureManagerReady()
  if (!manager) throw new Error("Wallet not initialized")

  if (!get(cashuBackupConfirmed)) {
    throw new Error("backup_required")
  }
  const active = manager
  const prepared = await active.ops.send.prepare({mintUrl, amount: {amount: sats, unit: "sat"}})
  const {token: tokenData} = await active.ops.send.execute(prepared)
  if (manager !== active) throw new Error("Wallet session changed")
  await refreshCashuBalancesStrict()
  await refreshCashuHistoryStrict()
  return getEncodedToken(tokenData)
}

// ─── Lightning Top-up ─────────────────────────────────────────────────────────

export const requestMintQuote = async (
  mintUrl: string,
  amount: number,
): Promise<CashuTopUpQuote> => {
  const sats = cashuPositiveSats(amount)
  await ensureManagerReady()
  if (!manager) throw new Error("Wallet not initialized")
  if (!get(cashuBackupConfirmed)) throw new Error("backup_required")
  const active = manager
  if (!(await active.mint.isTrustedMint(mintUrl))) throw new UntrustedMintError(mintUrl)
  const quote = await active.quotes.mint.create({
    mintUrl,
    method: "bolt11",
    amount: sats,
    unit: "sat",
    locked: true,
  })
  if (quote.method !== "bolt11" || quote.unit !== "sat" || !quote.amount.equals(sats)) {
    throw new Error("Mint returned an unexpected quote amount or unit")
  }
  const operation = await active.ops.mint.prepare({quote, amount: sats})
  if (manager !== active) throw new Error("Wallet session changed")
  await refreshCashuTopUps()
  return topUpFromQuote(quote, operation)
}

export const checkMintQuote = async (
  mintUrl: string,
  quote: string,
): Promise<"paid" | "unpaid" | "expired"> => {
  await ensureManagerReady()
  if (!manager) throw new Error("Wallet not initialized")
  const status = await manager.quotes.mint.refresh({mintUrl, quoteId: quote})
  if (status.state === "PAID" || status.state === "ISSUED" || status.amountPaid.greaterThan(0))
    return "paid"
  if (status.expiry !== null && status.expiry <= Date.now() / 1000) return "expired"
  return "unpaid"
}

export const mintTokensFromQuote = async (
  mintUrl: string,
  quote: string,
  amount: number,
): Promise<void> => {
  await ensureManagerReady()
  if (!manager) throw new Error("Wallet not initialized")

  if (!get(cashuBackupConfirmed)) {
    throw new Error("backup_required")
  }
  const active = manager
  const stored = await active.quotes.mint.get({mintUrl, quoteId: quote})
  if (!stored || stored.method !== "bolt11" || stored.unit !== "sat")
    throw new Error("Top-up quote not found")
  if (!stored.amount.equals(cashuPositiveSats(amount)))
    throw new Error("Top-up amount does not match its stored quote")
  const operations = await active.ops.mint.listByQuote({mintUrl, quoteId: quote})
  // Reuse original outputs even if the mint already issued them before a reload.
  const operation =
    operations[0] ?? (await active.ops.mint.prepare({quote: stored, amount: stored.amount}))
  await active.quotes.mint.refresh(stored)
  const result = await active.ops.mint.execute(operation.id)
  if (result.state === "failed" || result.error)
    throw new Error(result.terminalFailure?.reason || result.error || "Minting failed")
  if (result.state !== "finalized")
    throw new Error("Top-up is still pending; its recovery data is saved")
  if (manager !== active) throw new Error("Wallet session changed")
  await Promise.all([refreshCashuBalances(), refreshCashuHistory(), refreshCashuTopUps()])
}

const topUpFromQuote = (quote: MintQuote, operation?: MintOperation): CashuTopUpQuote => {
  if (quote.method !== "bolt11" || quote.unit !== "sat") throw new Error("Unsupported top-up quote")
  const paid = quote.amountPaid.greaterThan(0) || quote.state === "PAID" || quote.state === "ISSUED"
  return {
    mintUrl: quote.mintUrl,
    quote: quote.quoteId,
    request: quote.request,
    amount: cashuSatsNumber(quote.amount),
    expiry: quote.expiry,
    operationId: operation?.id,
    state:
      operation?.state === "finalized"
        ? operation.error
          ? "failed"
          : "complete"
        : operation?.state === "failed"
          ? "failed"
          : paid || operation?.state === "executing"
            ? "pending"
            : quote.expiry !== null && quote.expiry <= Date.now() / 1000
              ? "expired"
              : "unpaid",
    error: operation?.terminalFailure?.reason || operation?.error,
  }
}

export const getCashuTopUp = async (mintUrl: string, quoteId: string): Promise<CashuTopUpQuote> => {
  await ensureManagerReady()
  if (!manager) throw new Error("Wallet not initialized")
  const active = manager
  const quote = await active.quotes.mint.get({mintUrl, quoteId})
  if (!quote) throw new Error("Top-up quote not found")
  const operations = await active.ops.mint.listByQuote({mintUrl, quoteId})
  return topUpFromQuote(quote, operations[0])
}

export const refreshCashuTopUps = async (): Promise<void> => {
  if (!manager) return
  const active = manager
  try {
    const quotes = await active.quotes.mint.listPending({method: "bolt11"})
    // An ISSUED quote can still have local outputs awaiting NUT-09 recovery.
    for (const operation of await active.ops.mint.listInFlight()) {
      if (!quotes.some(q => q.mintUrl === operation.mintUrl && q.quoteId === operation.quoteId)) {
        const quote = await active.quotes.mint.get(operation)
        if (quote) quotes.push(quote)
      }
    }
    const topUps = await Promise.all(
      quotes
        .filter(q => q.method === "bolt11" && q.unit === "sat")
        .map(async quote => {
          const operations = await active.ops.mint.listByQuote({
            mintUrl: quote.mintUrl,
            quoteId: quote.quoteId,
          })
          return topUpFromQuote(quote, operations[0])
        }),
    )
    if (manager === active)
      cashuTopUps.set(topUps.filter(q => q.state !== "complete" && q.state !== "expired"))
  } catch (error) {
    console.warn("[cashu] Could not refresh saved top-ups:", error)
  }
}

// ─── Auto-pay Whitelist ───────────────────────────────────────────────────────

export const addAutoPayWhitelist = (extensionId: string): void => {
  const current = get(cashuAutoPayWhitelist)
  if (!current.includes(extensionId)) {
    const updated = [...current, extensionId]
    cashuAutoPayWhitelist.set(updated)
    localStorage.setItem(KEY_AUTOPAY_WHITELIST, JSON.stringify(updated))
  }
}

export const removeAutoPayWhitelist = (extensionId: string): void => {
  const updated = get(cashuAutoPayWhitelist).filter(id => id !== extensionId)
  cashuAutoPayWhitelist.set(updated)
  localStorage.setItem(KEY_AUTOPAY_WHITELIST, JSON.stringify(updated))
}

// ─── History ──────────────────────────────────────────────────────────────────

const mapHistoryEntry = (entry: HistoryEntry): TokenHistoryEntry | null => {
  if (entry.unit !== "sat") return null
  const stableId = getHistoryEntryKey(entry)
  const base = {
    id: stableId,
    mintUrl: entry.mintUrl,
    amount: cashuSatsNumber(entry.amount ?? 0),
    createdAt: entry.createdAt,
  }
  switch (entry.type) {
    case "send":
      return {
        ...base,
        direction: "sent",
        token: entry.token ? getEncodedToken(entry.token) : undefined,
      }
    case "receive":
      return {...base, direction: "received"}
    case "mint":
      return {...base, direction: "minted"}
    case "melt":
      return {...base, direction: "sent"}
    default:
      return null
  }
}

const getHistoryEntryKey = (entry: HistoryEntry): string => {
  const receivedTokenKey = getReceivedTokenHistoryKey(entry)
  if (receivedTokenKey) return receivedTokenKey

  const operationId = (entry as any).operationId
  const quoteId = (entry as any).quoteId
  return [entry.type, entry.mintUrl, operationId || quoteId || entry.id].join(":")
}

const getReceivedTokenHistoryKey = (entry: HistoryEntry): string => {
  if (entry.type !== "receive" || !entry.token?.proofs?.length) return ""

  const proofKey = entry.token.proofs
    .map(proof => [proof.id, proof.amount, proof.secret, proof.C].join("|"))
    .sort()
    .join(";")

  return [entry.type, entry.mintUrl, proofKey].join(":")
}

const getHistoryStateRank = (entry: HistoryEntry): number => {
  const state = `${(entry as any).state || ""}`.toLowerCase()
  if (["finalized", "paid", "issued"].includes(state)) return 4
  if (["pending"].includes(state)) return 3
  if (["prepared", "unpaid"].includes(state)) return 2
  if (["rolledback", "rolled_back", "failed"].includes(state)) return 1
  return 0
}

const shouldReplaceHistoryEntry = (current: HistoryEntry, next: HistoryEntry): boolean => {
  const currentRank = getHistoryStateRank(current)
  const nextRank = getHistoryStateRank(next)
  if (nextRank !== currentRank) return nextRank > currentRank

  const currentUpdatedAt = (current as any).updatedAt || current.createdAt || 0
  const nextUpdatedAt = (next as any).updatedAt || next.createdAt || 0
  return nextUpdatedAt > currentUpdatedAt
}

const dedupeHistoryEntries = (entries: HistoryEntry[]): HistoryEntry[] => {
  const byKey = new Map<string, HistoryEntry>()

  for (const entry of entries) {
    const key = getHistoryEntryKey(entry)
    const current = byKey.get(key)
    if (!current || shouldReplaceHistoryEntry(current, entry)) {
      byKey.set(key, entry)
    }
  }

  return Array.from(byKey.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
}

const refreshCashuHistory = async (): Promise<void> => {
  if (!manager) return
  try {
    await refreshCashuHistoryStrict()
  } catch (e) {
    console.error("[cashu] Failed to refresh history:", e)
  }
}

const refreshCashuHistoryStrict = async (): Promise<void> => {
  if (!manager) throw new Error("Wallet not initialized")

  const active = manager
  const entries = await active.history.getPaginatedHistory(0, HISTORY_PAGE_SIZE)
  if (manager !== active) return
  cashuTokenHistory.set(
    dedupeHistoryEntries(entries)
      .map(mapHistoryEntry)
      .filter((e): e is TokenHistoryEntry => !!e),
  )
}
